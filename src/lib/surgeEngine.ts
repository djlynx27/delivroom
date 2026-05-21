/**
 * surgeEngine.ts — Delivroom
 *
 * Détecte les surges de demande relative à un baseline 4-semaines,
 * calcule un multiplicateur de prime (1.0–2.5×) et produit un vecteur
 * de contexte 8D utilisé par pgvector pour la recherche de similarité.
 *
 * Calibré pour l'écosystème de transport montréalais :
 *   - Saisons (hiver = prime chauffeur, juillet = Grand Prix)
 *   - Bar closing surge (02:00–03:30 toutes les nuits)
 *   - Centre Bell / Osheaga / GP de Montréal
 *   - Blizzards STM perturbations
 *
 * Architecture: déterministe côté client, stockage vecteur côté serveur.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SurgeContext {
  /** Heure locale 0–23 */
  hour: number;
  /** Jour de la semaine 0=Dim…6=Sam */
  dayOfWeek: number;
  /** Score météo 0–100 (0=ciel clair, 100=blizzard) */
  weatherScore: number;
  /** Impact d'événement à proximité 0–100 */
  eventProximity: number;
  /** Indice de trafic 0–100 (0=fluide, 100=paralysé) */
  trafficIndex: number;
  /** Score de demande actuel de la zone 0–100 */
  currentScore: number;
  /** Score de référence de la zone (moyenne glissante 4 sem. même créneau) */
  baselineScore: number;
  /** Distance à vide estimée pour atteindre la zone (km) */
  deadheadKm: number;
  /** Mois courant 0–11 */
  month: number;
}

export interface SurgeResult {
  /** Multiplicateur de prime 1.00 – 2.50 */
  surgeMultiplier: number;
  /** Score de demande amplifié 0–100 */
  surgeScore: number;
  /** Classe de surge */
  surgeClass: 'normal' | 'elevated' | 'high' | 'peak';
  /**
   * Vecteur de contexte 8D normalisé [0, 1] pour pgvector.
   * [hour, dow, weather, events, traffic, surge_ratio, deadhead_inv, seasonal]
   */
  contextVector: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  /** Explication lisible (FR) */
  reasoning: string;
  /** Gain $/h estimé vs baseline (%) */
  estimatedBoostPct: number;
}

export interface SurgeDisplay {
  label: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  pulseClass: string;
}

// ── Constants calibrés Montréal ───────────────────────────────────────────────

/**
 * Index saisonnier Montréal (Jan=0 … Déc=11).
 * Jan–Fév : hiver, prime chauffeur (moins de conducteurs, conditions difficiles).
 * Juil–Août : GP de Montréal, Osheaga, touristes.
 * Déc : fêtes, partys corporatifs.
 */
const SEASONAL_INDEX = [
  1.15, // Jan — hiver + Nouvel An
  1.12, // Fév — hiver, Fête nationale QC
  1.05, // Mar — redoux timide
  0.95, // Avr — low season pré-touriste
  0.9, // Mai — saison creuse
  1.02, // Juin — début Grand Prix
  1.1, // Juil — GP Montréal, festivals
  1.08, // Août — Osheaga, pic touristique
  1.0, // Sep — rentrée scolaire
  0.95, // Oct — épaulette
  0.98, // Nov — grisaille
  1.18, // Déc — fêtes, partys
] as const;

/**
 * Baseline multiplicateur par jour de la semaine.
 * Normalisé sur vendredi = 1.00 (meilleur jour).
 */
const DOW_BASELINE = [
  0.8, // Dim
  0.82, // Lun
  0.85, // Mar
  0.87, // Mer
  0.92, // Jeu
  1.0, // Ven ← référence
  0.98, // Sam
] as const;

/** Seuils du ratio (currentScore / adjustedBaseline) → classe de surge */
const SURGE_THRESHOLDS = {
  elevated: 1.18,
  high: 1.45,
  peak: 1.8,
} as const;

const MULTIPLIER_MIN = 1.0;
const MULTIPLIER_MAX = 2.5;

// ── Fonctions internes ────────────────────────────────────────────────────────

/** Normalise [min, max] → [0, 1] avec clamping. */
function norm(value: number, min: number, max: number): number {
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/**
 * Construit le vecteur 8D pour pgvector.
 *
 * Dimensions :
 *   [0] hour_norm        → hour / 23
 *   [1] dow_norm         → dayOfWeek / 6
 *   [2] weather_norm     → weatherScore / 100
 *   [3] event_norm       → eventProximity / 100
 *   [4] traffic_norm     → trafficIndex / 100
 *   [5] surge_ratio_norm → clamp(currentScore / baselineScore, 0, 3) / 3
 *   [6] deadhead_inv     → 1 − clamp(deadheadKm / 30, 0, 1)
 *   [7] seasonal_norm    → (seasonalIndex − 0.85) / 0.35
 *
 * Toutes les dimensions sont dans [0, 1].
 * Similarité cosinus dans pgvector : <=> opérateur (IVFFlat index).
 */
function buildContextVector(ctx: SurgeContext): SurgeResult['contextVector'] {
  const seasonal = SEASONAL_INDEX[ctx.month] ?? 1.0;
  const surgeRatio =
    ctx.baselineScore > 0 ? ctx.currentScore / ctx.baselineScore : 1.0;

  return [
    norm(ctx.hour, 0, 23),
    norm(ctx.dayOfWeek, 0, 6),
    norm(ctx.weatherScore, 0, 100),
    norm(ctx.eventProximity, 0, 100),
    norm(ctx.trafficIndex, 0, 100),
    norm(surgeRatio, 0, 3),
    1 - norm(ctx.deadheadKm, 0, 30),
    norm(seasonal, 0.85, 1.2),
  ] as const;
}

/**
 * Calcule le multiplicateur de prime.
 *
 * Formule :
 *   adjustedBaseline = baselineScore × dow_multiplier × seasonal_index
 *   ratio            = currentScore / adjustedBaseline
 *   rawMulti         = 1 + (MAX − 1) × sigmoid(4 × (ratio − 1))
 *                      ← sigmoid lisse, ratio=1 → multi=1.25, ratio=2 → multi≈2.4
 *   weatherBoost     = weatherScore > 50 ? (ws − 50) / 100 × 0.30 : 0
 *   eventBoost       = eventProximity / 100 × 0.25
 *   trafficBoost     = trafficIndex   / 100 × 0.15
 *   final            = clamp(rawMulti + boosts, 1.0, 2.5)
 */
function computeSurgeMultiplier(ctx: SurgeContext): number {
  const dow = DOW_BASELINE[ctx.dayOfWeek] ?? 1.0;
  const seasonal = SEASONAL_INDEX[ctx.month] ?? 1.0;
  const adjustedBaseline = ctx.baselineScore * dow * seasonal;

  if (adjustedBaseline <= 0) return MULTIPLIER_MIN;

  const ratio = ctx.currentScore / adjustedBaseline;
  const demandExcess = Math.max(0, ratio - 1.05);
  const demandBoost =
    demandExcess <= 0
      ? 0
      : (MULTIPLIER_MAX - MULTIPLIER_MIN) * (1 - Math.exp(-1.8 * demandExcess));

  const weatherBoost =
    ctx.weatherScore > 50 ? ((ctx.weatherScore - 50) / 100) * 0.3 : 0;
  const eventBoost = (ctx.eventProximity / 100) * 0.25;
  const trafficBoost = (ctx.trafficIndex / 100) * 0.15;

  return Math.min(
    MULTIPLIER_MAX,
    Math.max(
      MULTIPLIER_MIN,
      MULTIPLIER_MIN + demandBoost + weatherBoost + eventBoost + trafficBoost
    )
  );
}

function classifySurge(multiplier: number): SurgeResult['surgeClass'] {
  if (multiplier >= SURGE_THRESHOLDS.peak) return 'peak';
  if (multiplier >= SURGE_THRESHOLDS.high) return 'high';
  if (multiplier >= SURGE_THRESHOLDS.elevated) return 'elevated';
  return 'normal';
}

// eslint-disable-next-line complexity
function buildReasoning(
  surgeClass: SurgeResult['surgeClass'],
  ctx: SurgeContext,
  multiplier: number
): string {
  const ratio =
    ctx.baselineScore > 0
      ? (ctx.currentScore / ctx.baselineScore).toFixed(2)
      : 'N/A';
  const parts: string[] = [];

  switch (surgeClass) {
    case 'peak':
      parts.push(
        `🔴 PEAK — demande exceptionnelle ×${multiplier.toFixed(2)} (ratio: ${ratio})`
      );
      break;
    case 'high':
      parts.push(`🟠 SURGE — forte prime ×${multiplier.toFixed(2)}`);
      break;
    case 'elevated':
      parts.push(`🟡 Élevé × ${multiplier.toFixed(2)}`);
      break;
    default:
      parts.push('🟢 Demande normale');
  }

  if (ctx.weatherScore > 60) parts.push('météo dégradée (+prime)');
  if (ctx.eventProximity > 50) parts.push('événement actif');
  if (ctx.trafficIndex > 60) parts.push('trafic dense');
  if (ctx.deadheadKm < 2)
    parts.push(`zone très proche (${ctx.deadheadKm.toFixed(1)} km)`);
  if (ctx.hour >= 2 && ctx.hour < 4) parts.push('bar closing surge');

  return parts.join(' · ');
}

// ── API publique ──────────────────────────────────────────────────────────────

/**
 * Calcule le surge complet pour un contexte de zone donné.
 *
 * @example
 * const result = computeSurge({
 *   hour: 23, dayOfWeek: 5, weatherScore: 70, eventProximity: 80,
 *   trafficIndex: 55, currentScore: 82, baselineScore: 50,
 *   deadheadKm: 1.5, month: 6,
 * })
 * // → { surgeMultiplier: 2.1, surgeClass: 'peak', estimatedBoostPct: 110, ... }
 */
export function computeSurge(ctx: SurgeContext): SurgeResult {
  const surgeMultiplier = computeSurgeMultiplier(ctx);
  const surgeClass = classifySurge(surgeMultiplier);
  const contextVector = buildContextVector(ctx);

  // Score amplifié : demand × surge signal, plafonné à 100
  const surgeScore = Math.min(
    100,
    Math.round(ctx.currentScore * Math.min(surgeMultiplier, 1.6))
  );

  const estimatedBoostPct = Math.round((surgeMultiplier - 1) * 100);
  const reasoning = buildReasoning(surgeClass, ctx, surgeMultiplier);

  return {
    surgeMultiplier: Math.round(surgeMultiplier * 100) / 100,
    surgeScore,
    surgeClass,
    contextVector,
    reasoning,
    estimatedBoostPct,
  };
}

/**
 * Construit un SurgeContext depuis les données disponibles dans l'app.
 * Utilisé dans useDemandScores pour intégrer le surge au pipeline existant.
 */
export function buildSurgeContext(params: {
  now: Date;
  currentScore: number;
  baselineScore: number;
  weatherScore: number;
  eventProximity: number;
  trafficIndex: number;
  deadheadKm: number;
}): SurgeContext {
  return {
    hour: params.now.getHours(),
    dayOfWeek: params.now.getDay(),
    weatherScore: params.weatherScore,
    eventProximity: params.eventProximity,
    trafficIndex: params.trafficIndex,
    currentScore: params.currentScore,
    baselineScore: params.baselineScore,
    deadheadKm: params.deadheadKm,
    month: params.now.getMonth(),
  };
}

/**
 * Propriétés d'affichage Tailwind pour chaque classe de surge.
 */
export function getSurgeDisplay(
  surgeClass: SurgeResult['surgeClass']
): SurgeDisplay {
  switch (surgeClass) {
    case 'peak':
      return {
        label: '🔴 PEAK',
        bgClass: 'bg-red-500/20',
        textClass: 'text-red-400',
        borderClass: 'border-red-500',
        pulseClass: 'animate-pulse',
      };
    case 'high':
      return {
        label: '🟠 SURGE',
        bgClass: 'bg-orange-500/20',
        textClass: 'text-orange-400',
        borderClass: 'border-orange-500',
        pulseClass: 'animate-pulse',
      };
    case 'elevated':
      return {
        label: '🟡 Élevé',
        bgClass: 'bg-yellow-500/20',
        textClass: 'text-yellow-400',
        borderClass: 'border-yellow-500',
        pulseClass: '',
      };
    default:
      return {
        label: '🟢 Normal',
        bgClass: 'bg-green-500/20',
        textClass: 'text-green-400',
        borderClass: 'border-green-500',
        pulseClass: '',
      };
  }
}

/**
 * Similarité cosinus entre deux vecteurs de dimensionalité identique.
 * Utilisation côté client pour comparer le contexte actuel avec un cache local
 * de vecteurs historiques (avant de requêter pgvector via Edge Function).
 */
export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[]
): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Interpolation linéaire. Utilisée par les tests unitaires.
 * @internal
 */
export function _lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}
