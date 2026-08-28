/**
 * Real-time demand scoring engine.
 * Deterministic scores based on zone type, name, time, day-of-week, weather, and events.
 * Calibrated for realistic Montreal taxi demand patterns.
 */

import type { Zone } from '@/hooks/useSupabase';
import { haversineKm } from '@/hooks/useUserLocation';
import { applyLearningAgents, type ZoneHistory } from '@/lib/aiAgents';
import {
  selectProspectionWaypoints,
  type RouteCandidateZone,
  type RoutePoint,
} from '@/services/routing';
import { HOTSPOTS } from './hotspots';

export interface ActiveEventBoost {
  latitude: number;
  longitude: number;
  boost_multiplier: number;
  boost_radius_km: number;
  boost_zone_types: string[]; // empty = all zones
}

export interface DemandFactors {
  timeOfDay: number;
  dayOfWeek: number;
  weather: number;
  events: number;
  historicalEarnings: number;
  transitDisruption: number;
  trafficCongestion: number;
  winterConditions: number;
}

export interface WeightConfig {
  timeOfDay: number;
  dayOfWeek: number;
  weather: number;
  events: number;
  historicalEarnings: number;
  transitDisruption: number;
  trafficCongestion: number;
  winterConditions: number;
}

export interface ScoringContext {
  history?: ZoneHistory[];
  weights?: Partial<WeightConfig>;
  transitDisruption?: number;
  trafficCongestion?: number;
  winterConditions?: number;
}

export const DEFAULT_WEIGHTS: WeightConfig = {
  timeOfDay: 0.25,
  dayOfWeek: 0.15,
  weather: 0.15,
  events: 0.15,
  historicalEarnings: 0.1,
  transitDisruption: 0.08,
  trafficCongestion: 0.07,
  winterConditions: 0.05,
};

// ── Base scores by zone type (conservative baseline, boosted by time rules) ──
const BASE_SCORES: Record<string, number> = {
  aéroport: 50,
  métro: 35,
  nightlife: 40,
  transport: 40,
  événements: 45,
  commercial: 40,
  université: 35,
  médical: 40,
  tourisme: 45,
  résidentiel: 35,
  achalandage: 40,
};

// ── Time-of-day rules with realistic multipliers ─────────────────────
// Multipliers are calibrated so base × multiplier hits realistic demand ranges:
//   00:00–05:00: metro 30-45, nightlife 60-80, airport 50-65
//   06:00–08:00: metro 55-70, gare centrale 75, airport 60
//   08:00–11:00: metro 50-65, commercial 55-65
//   11:00–14:00: commercial 65-75, residential 55
//   14:00–17:00: mixed 55-70
//   17:00–19:00: metro 70-85, gare centrale 80
//   19:00–23:00: nightlife 75-90, events 80-95
//   23:00–00:00: nightlife 70-85, airport 55
interface TimeRule {
  days: number[]; // 0=Sun..6=Sat, empty = any day
  startHour: number;
  startMin: number;
  endHour: number;
  endMin: number;
  multipliers: Record<string, number>;
}

const TIME_RULES: TimeRule[] = [
  // 00:00–05:00: nightlife stays high, metro dead, airport early flights
  {
    days: [],
    startHour: 0,
    startMin: 0,
    endHour: 5,
    endMin: 0,
    multipliers: {
      métro: 1.0,
      nightlife: 1.7,
      aéroport: 1.1,
      résidentiel: 0.9,
      commercial: 0.8,
    },
  },
  // 06:00–08:00: morning commute peak
  {
    days: [1, 2, 3, 4, 5],
    startHour: 6,
    startMin: 0,
    endHour: 8,
    endMin: 0,
    multipliers: { métro: 1.7, transport: 1.85, aéroport: 1.2 },
  },
  // 08:00–11:00: post-rush, moderate metro, commercial opening
  {
    days: [1, 2, 3, 4, 5],
    startHour: 8,
    startMin: 0,
    endHour: 11,
    endMin: 0,
    multipliers: { métro: 1.6, commercial: 1.5, université: 1.4 },
  },
  // 11:00–14:00: lunch hour, commercial peak, residential pickup
  {
    days: [1, 2, 3, 4, 5],
    startHour: 11,
    startMin: 0,
    endHour: 14,
    endMin: 0,
    multipliers: { commercial: 1.7, résidentiel: 1.55, tourisme: 1.3 },
  },
  // 14:00–17:00: afternoon mixed demand
  {
    days: [1, 2, 3, 4, 5],
    startHour: 14,
    startMin: 0,
    endHour: 17,
    endMin: 0,
    multipliers: {
      métro: 1.5,
      commercial: 1.5,
      université: 1.4,
      tourisme: 1.3,
    },
  },
  // 17:00–19:00: evening commute peak (strongest metro demand)
  {
    days: [1, 2, 3, 4, 5],
    startHour: 17,
    startMin: 0,
    endHour: 19,
    endMin: 0,
    multipliers: { métro: 2.1, transport: 2.0, aéroport: 1.2 },
  },
  // 19:00–23:00: nightlife + events prime time
  {
    days: [],
    startHour: 19,
    startMin: 0,
    endHour: 23,
    endMin: 0,
    multipliers: { nightlife: 2.0, événements: 1.9, tourisme: 1.2 },
  },
  // 23:00–00:00: late night transition
  {
    days: [],
    startHour: 23,
    startMin: 0,
    endHour: 0,
    endMin: 0,
    multipliers: { nightlife: 1.9, aéroport: 1.1 },
  },
  // Fri/Sat late night extra boost
  {
    days: [5, 6],
    startHour: 22,
    startMin: 0,
    endHour: 3,
    endMin: 0,
    multipliers: { nightlife: 2.2, aéroport: 1.2 },
  },
  // Bar closing surge 02:00–03:30
  {
    days: [],
    startHour: 2,
    startMin: 0,
    endHour: 3,
    endMin: 30,
    multipliers: { nightlife: 2.0 },
  },
  // Sundays 10:00–14:00 brunch/shopping
  {
    days: [0],
    startHour: 10,
    startMin: 0,
    endHour: 14,
    endMin: 0,
    multipliers: { commercial: 1.5, tourisme: 1.3 },
  },
  // Weekend daytime: lower metro, higher tourism/commercial
  {
    days: [0, 6],
    startHour: 10,
    startMin: 0,
    endHour: 18,
    endMin: 0,
    multipliers: { métro: 1.2, tourisme: 1.4, commercial: 1.4 },
  },
];

// Medical shift changes - special handling
const MEDICAL_SHIFT_HOURS = [7, 15, 19, 23];

function timeInRange(hour: number, min: number, rule: TimeRule): boolean {
  const t = hour * 60 + min;
  const s = rule.startHour * 60 + rule.startMin;
  const e = rule.endHour * 60 + rule.endMin;
  // Wraps midnight
  if (s > e) return t >= s || t < e;
  return t >= s && t < e;
}

function dayMatches(dayOfWeek: number, rule: TimeRule): boolean {
  if (rule.days.length === 0) return true;
  if (rule.days.includes(dayOfWeek)) return true;
  // Midnight-crossing rules (e.g. Fri/Sat 22:00–03:00) logically belong to the
  // night that started on the earlier day. When it is 01:00 Sunday the rule's
  // "days" should still match Saturday (6). Check whether the previous calendar
  // day satisfies the rule whenever the time window wraps past midnight.
  const s = rule.startHour * 60 + rule.startMin;
  const e = rule.endHour * 60 + rule.endMin;
  if (s > e) {
    const previousDay = (dayOfWeek + 6) % 7;
    return rule.days.includes(previousDay);
  }
  return false;
}

// ── City-specific zone profiles ───────────────────────────────────────
// Returns a demand curve value 0-10 for named zones at a given hour
interface ZoneProfile {
  pattern: (hour: number, dayOfWeek: number) => number; // 0-10
}

const ZONE_PROFILES: Record<string, ZoneProfile> = {
  // MONTRÉAL
  'Centre Bell': {
    pattern: (h) => {
      if (h >= 21 && h <= 23) return 9;
      if (h >= 18 && h <= 20) return 6;
      return 3;
    },
  },
  'Crescent Sainte-Catherine': {
    pattern: (h, d) => {
      if ((d === 4 || d === 5 || d === 6) && (h >= 23 || h < 3)) return 9;
      if (h >= 18 && h <= 22) return 6;
      return 3;
    },
  },
  'Vieux-Port': {
    pattern: (h) => {
      if (h >= 10 && h <= 17) return 6;
      return 2;
    },
  },
  'Aéroport Trudeau (YUL)': {
    pattern: (h) => {
      if (h >= 3 && h <= 5) return 8;
      if (h >= 18 && h <= 22) return 7;
      if (h >= 6 && h <= 9) return 6;
      return 4;
    },
  },
  CHUM: {
    pattern: (h) => {
      if (MEDICAL_SHIFT_HOURS.includes(h)) return 7;
      return 3;
    },
  },
  'Casino de Montréal': {
    pattern: (h) => {
      if (h >= 22 || h < 4) return 7;
      return 2;
    },
  },
  'Station Berri-UQAM': {
    pattern: (h, d) => {
      if (d >= 1 && d <= 5 && ((h >= 7 && h <= 9) || (h >= 17 && h <= 19)))
        return 8;
      if (d >= 1 && d <= 5 && h >= 10 && h <= 16) return 5;
      return 3;
    },
  },
  'Gare Centrale': {
    pattern: (h, d) => {
      if (d >= 1 && d <= 5 && h >= 6 && h <= 8) return 8;
      if (d >= 1 && d <= 5 && h >= 17 && h <= 19) return 8;
      return 3;
    },
  },
  // LAVAL
  'Place Bell': {
    pattern: (h) => {
      if (h >= 21 && h <= 23) return 9;
      return 2;
    },
  },
  'Station Montmorency': {
    pattern: (h, d) => {
      if (d >= 1 && d <= 5 && ((h >= 7 && h <= 9) || (h >= 17 && h <= 19)))
        return 7;
      return 3;
    },
  },
  'CF Carrefour Laval': {
    pattern: (h, d) => {
      if ((d === 0 || d === 6) && h >= 12 && h <= 20) return 6;
      return 3;
    },
  },
  Centropolis: {
    pattern: (h, d) => {
      if ((d === 5 || d === 6) && h >= 20 && (h <= 23 || h < 1)) return 7;
      return 3;
    },
  },
  'Hôpital de la Cité-de-la-Santé': {
    pattern: (h) => {
      if (MEDICAL_SHIFT_HOURS.includes(h)) return 7;
      return 3;
    },
  },
  'Gare Sainte-Rose': {
    pattern: (h, d) => {
      if (d >= 1 && d <= 5 && ((h >= 6 && h <= 8) || (h >= 16 && h <= 18)))
        return 7;
      return 2;
    },
  },
  // LONGUEUIL
  'Longueuil–Université-de-Sherbrooke': {
    pattern: (h, d) => {
      if (d >= 1 && d <= 5 && ((h >= 7 && h <= 9) || (h >= 17 && h <= 19)))
        return 7;
      return 3;
    },
  },
  'Quartier DIX30': {
    pattern: (h, d) => {
      if ((d === 0 || d === 6) && h >= 11 && h <= 21) return 7;
      return 3;
    },
  },
  'Vieux-Longueuil': {
    pattern: (h, d) => {
      if ((d === 5 || d === 6) && (h >= 20 || h < 2)) return 6;
      return 3;
    },
  },
};

// ── Weather modifier ──────────────────────────────────────────────────
export interface WeatherCondition {
  weatherId: number;
  temp: number;
  /** Additive demand boost points from weather (0-30) */
  demandBoostPoints?: number;
}

export interface ScoreFactors {
  hasWeatherBoost: boolean;
  hasEventBoost: boolean;
  weatherBoostPoints: number;
  eventBoostPoints: number;
  /** Points ajoutés par l'IA d'apprentissage contextuel */
  learningBoostPoints?: number;
  /** 0..1 — score de similarité avec des contextes passés similaires */
  learningSimilarity?: number;
  /** Revenu moyen/h historique sur des contextes similaires */
  learningAvgEarningsPerHour?: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeWeights(partial?: Partial<WeightConfig>): WeightConfig {
  const merged: WeightConfig = {
    ...DEFAULT_WEIGHTS,
    ...partial,
  };
  const entries = Object.entries(merged) as Array<[keyof WeightConfig, number]>;
  const sum = entries.reduce((total, [, value]) => total + Math.abs(value), 0);

  if (sum <= 0) {
    return DEFAULT_WEIGHTS;
  }

  return entries.reduce((acc, [key, value]) => {
    acc[key] = Math.abs(value) / sum;
    return acc;
  }, {} as WeightConfig);
}

function getMaxMultiplierForType(zoneType: string): number {
  const multipliers = TIME_RULES.flatMap((rule) =>
    rule.multipliers[zoneType] ? [rule.multipliers[zoneType]] : []
  );
  return multipliers.length > 0 ? Math.max(...multipliers) : 1;
}

function computeTimePatternBase(
  zone: { name: string; type: string },
  now: Date
): number {
  const hour = now.getHours();
  const min = now.getMinutes();
  const dayOfWeek = now.getDay();

  let baseScore = BASE_SCORES[zone.type] ?? 40;
  let bestMultiplier = 1.0;

  for (const rule of TIME_RULES) {
    if (dayMatches(dayOfWeek, rule) && timeInRange(hour, min, rule)) {
      const multiplier = rule.multipliers[zone.type];
      if (multiplier && multiplier > bestMultiplier)
        bestMultiplier = multiplier;
    }
  }

  baseScore *= bestMultiplier;

  if (zone.type === 'médical') {
    for (const shiftHour of MEDICAL_SHIFT_HOURS) {
      const diff = Math.abs(hour - shiftHour);
      if (
        diff === 0 ||
        (diff === 1 && (shiftHour > hour ? min >= 30 : min <= 30))
      ) {
        baseScore *= 1.3;
        break;
      }
    }
  }

  const profile = ZONE_PROFILES[zone.name];
  if (profile) {
    const curveValue = profile.pattern(hour, dayOfWeek);
    baseScore = baseScore * 0.6 + (curveValue / 10) * 100 * 0.4;
  }

  return Math.min(100, baseScore);
}

function computeEventBoostPoints(
  zone: { type: string; latitude?: number; longitude?: number },
  eventBoosts?: ActiveEventBoost[]
): number {
  if (
    !eventBoosts ||
    eventBoosts.length === 0 ||
    zone.latitude == null ||
    zone.longitude == null
  ) {
    return 0;
  }

  let eventBoostPoints = 0;
  for (const eventBoost of eventBoosts) {
    const dist = haversineKm(
      zone.latitude,
      zone.longitude,
      eventBoost.latitude,
      eventBoost.longitude
    );
    if (dist > eventBoost.boost_radius_km) continue;

    const typeMatch =
      eventBoost.boost_zone_types.length === 0 ||
      eventBoost.boost_zone_types.includes(zone.type);
    if (!typeMatch) continue;

    const proximity = 1 - dist / Math.max(eventBoost.boost_radius_km, 0.25);
    const scaled = Math.round(
      Math.max(0, (eventBoost.boost_multiplier - 1) * 18 * proximity)
    );
    if (scaled > eventBoostPoints) {
      eventBoostPoints = Math.min(30, scaled);
    }
  }

  return eventBoostPoints;
}

function getDayOfWeekFactor(zoneType: string, now: Date): number {
  const day = now.getDay();
  const hour = now.getHours();
  const weekend = day === 0 || day === 6;
  const fridayOrSaturday = day === 5 || day === 6;

  if (zoneType === 'nightlife' || zoneType === 'événements') {
    if (fridayOrSaturday && (hour >= 20 || hour < 3)) return 0.95;
    if (weekend) return 0.75;
  }

  if (zoneType === 'métro' || zoneType === 'transport') {
    if (!weekend && ((hour >= 6 && hour <= 9) || (hour >= 16 && hour <= 19))) {
      return 0.9;
    }
    if (weekend) return 0.45;
  }

  if (zoneType === 'commercial' || zoneType === 'tourisme') {
    if (weekend && hour >= 10 && hour <= 19) return 0.8;
  }

  if (zoneType === 'université') {
    if (day >= 1 && day <= 5 && hour >= 8 && hour <= 18) return 0.72;
    return 0.35;
  }

  return weekend ? 0.6 : 0.55;
}

function getHistoricalFactor(
  zone: { id?: string | null; current_score?: number | null },
  history: ZoneHistory[] = []
): number {
  const zoneId = zone.id;
  if (!zoneId) {
    return clamp01((zone.current_score ?? 50) / 100);
  }

  const matching = history
    .filter((entry) => entry.zoneId === zoneId)
    .sort(
      (left, right) =>
        new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
    )
    .slice(0, 12);

  if (matching.length === 0) {
    return clamp01((zone.current_score ?? 50) / 100);
  }

  const weightedAverage =
    matching.reduce((sum, entry, index) => {
      const weight = Math.max(1, matching.length - index);
      return sum + entry.observedScore * weight;
    }, 0) /
    matching.reduce(
      (sum, _, index) => sum + Math.max(1, matching.length - index),
      0
    );

  return clamp01(weightedAverage / 100);
}

function getWeatherFactor(weather: WeatherCondition | null): number {
  if (!weather) return 0.25;
  const multiplierBoost = clamp01((getWeatherMultiplier(weather) - 1) / 0.4);
  const pointsBoost = clamp01((weather.demandBoostPoints ?? 0) / 30);
  return clamp01(0.2 + Math.max(multiplierBoost, pointsBoost) * 0.8);
}

function getWinterFactor(weather: WeatherCondition | null): number {
  if (!weather) return 0;
  const isSnow = weather.weatherId >= 600 && weather.weatherId <= 622;
  const isThunder = weather.weatherId >= 200 && weather.weatherId <= 232;
  const deepCold = weather.temp <= -15;
  if (isSnow) return 0.9;
  if (isThunder) return 0.55;
  if (deepCold) return 0.45;
  return 0;
}

export function calculateDemandFactors(
  zone: {
    id?: string | null;
    name: string;
    type: string;
    latitude?: number;
    longitude?: number;
    current_score?: number | null;
  },
  now: Date,
  weather: WeatherCondition | null,
  eventBoosts?: ActiveEventBoost[],
  context?: ScoringContext
): {
  demandFactors: DemandFactors;
  weatherBoostPoints: number;
  eventBoostPoints: number;
} {
  const timePatternBase = computeTimePatternBase(zone, now);
  const weatherBoostPoints = weather?.demandBoostPoints ?? 0;
  const eventBoostPoints = computeEventBoostPoints(zone, eventBoosts);
  const maxMultiplier = getMaxMultiplierForType(zone.type);

  const demandFactors: DemandFactors = {
    timeOfDay: clamp01(
      timePatternBase /
        ((BASE_SCORES[zone.type] ?? 40) * Math.max(maxMultiplier, 1))
    ),
    dayOfWeek: getDayOfWeekFactor(zone.type, now),
    weather: getWeatherFactor(weather),
    events: clamp01(eventBoostPoints / 30),
    historicalEarnings: getHistoricalFactor(zone, context?.history),
    transitDisruption: clamp01(context?.transitDisruption ?? 0),
    trafficCongestion: clamp01(context?.trafficCongestion ?? 0),
    winterConditions: clamp01(
      context?.winterConditions ?? getWinterFactor(weather)
    ),
  };

  return { demandFactors, weatherBoostPoints, eventBoostPoints };
}

export function calculateWeightedDemandScore(
  demandFactors: DemandFactors,
  weights?: Partial<WeightConfig>
): number {
  const normalizedWeights = normalizeWeights(weights);
  return clamp01(
    (
      Object.entries(demandFactors) as Array<[keyof DemandFactors, number]>
    ).reduce((score, [key, value]) => score + value * normalizedWeights[key], 0)
  );
}

export function getWeatherMultiplier(weather: WeatherCondition | null): number {
  if (!weather) return 1.0;
  const { weatherId, temp } = weather;
  if (
    (weatherId >= 502 && weatherId <= 531) ||
    (weatherId >= 600 && weatherId <= 622) ||
    (weatherId >= 200 && weatherId <= 232)
  ) {
    return 1.4;
  }
  if (weatherId >= 300 && weatherId <= 501) {
    return 1.15;
  }
  if (temp < -15) return 1.25;
  return 1.0;
}

// ── Main scoring function ─────────────────────────────────────────────
export function computeDemandScore(
  zone: {
    id?: string | null;
    name: string;
    type: string;
    latitude?: number;
    longitude?: number;
    current_score?: number | null;
  },
  now: Date,
  weather: WeatherCondition | null,
  eventBoosts?: ActiveEventBoost[],
  context?: ScoringContext
): { score: number; factors: ScoreFactors } {
  const legacyBaseScore = computeTimePatternBase(zone, now);
  const { demandFactors, weatherBoostPoints, eventBoostPoints } =
    calculateDemandFactors(zone, now, weather, eventBoosts, context);
  const weightedScore = calculateWeightedDemandScore(
    demandFactors,
    context?.weights
  );

  const legacyNormalized = clamp01(
    (legacyBaseScore + weatherBoostPoints * 0.6 + eventBoostPoints * 0.6) / 100
  );
  let finalScore =
    clamp01(legacyNormalized * 0.35 + weightedScore * 0.65) * 100;

  // ── Boost scoring for strategic hotspots ──
  const hotspot = HOTSPOTS.find(
    (h) =>
      h.id === zone.id ||
      (h.name && zone.name && h.name.toLowerCase() === zone.name.toLowerCase())
  );
  if (hotspot) {
    // Bonus de base pour hotspot stratégique
    finalScore *= 1.12;
    // Modulation selon la rapidité de sortie (egressVelocity)
    finalScore *=
      0.98 + 0.02 * Math.min(10, Math.max(1, hotspot.egressVelocity));
    // Clamp pour éviter de dépasser 100
    finalScore = Math.min(100, finalScore);
  }

  const factors: ScoreFactors = {
    hasWeatherBoost:
      weatherBoostPoints > 0 || getWeatherMultiplier(weather) > 1.0,
    hasEventBoost: eventBoostPoints > 0,
    weatherBoostPoints,
    eventBoostPoints,
    ...(hotspot
      ? { hotspotId: hotspot.id, egressVelocity: hotspot.egressVelocity }
      : {}),
  };

  return {
    score: Math.max(0, Math.min(100, Math.round(finalScore))),
    factors,
  };
}

// ── Batch scoring for all zones ───────────────────────────────────────
export function scoreAllZones(
  zones: Zone[],
  now: Date,
  weather: WeatherCondition | null,
  eventBoosts?: ActiveEventBoost[],
  context?: ScoringContext | ((zone: Zone) => ScoringContext | undefined)
): { scores: Map<string, number>; factors: Map<string, ScoreFactors> } {
  const scores = new Map<string, number>();
  const factors = new Map<string, ScoreFactors>();
  for (const zone of zones) {
    const resolvedContext =
      typeof context === 'function' ? context(zone) : context;
    const result = computeDemandScore(
      zone,
      now,
      weather,
      eventBoosts,
      resolvedContext
    );
    scores.set(zone.id, result.score);
    factors.set(zone.id, result.factors);
  }
  return { scores, factors };
}

export function scoreAllZonesWithLearning(
  zones: Zone[],
  now: Date,
  weather: WeatherCondition | null,
  eventBoosts?: ActiveEventBoost[],
  history: ZoneHistory[] = [],
  context?: ScoringContext | ((zone: Zone) => ScoringContext | undefined)
): { scores: Map<string, number>; factors: Map<string, ScoreFactors> } {
  const mergedContext =
    typeof context === 'function'
      ? (zone: Zone) => ({
          ...(context(zone) ?? {}),
          history,
        })
      : {
          ...(context ?? {}),
          history,
        };

  const base = scoreAllZones(zones, now, weather, eventBoosts, mergedContext);
  const adjustedScores = applyLearningAgents(zones, base.scores, history);
  return { scores: adjustedScores, factors: base.factors };
}

// ── Driver-mode reweighting ──────────────────────────────────────────────────
// A rideshare passenger and a delivery order favor different zone types
// (rideshare: airports/transit; delivery: dense residential/commercial), so
// the same underlying demand score gets reweighted per mode before ranking.
export type DriverMode = 'all' | 'rideshare' | 'delivery';

const RIDESHARE_BOOST: Record<string, number> = {
  aéroport: 1.2,
  université: 1.15,
  transport: 1.1,
  commercial: 1.05,
  médical: 1.05,
  métro: 1.05,
  résidentiel: 0.75,
};

const DELIVERY_BOOST: Record<string, number> = {
  commercial: 1.3,
  résidentiel: 1.2,
  métro: 0.95,
  transport: 0.85,
  université: 0.8,
  médical: 0.75,
  tourisme: 0.75,
  nightlife: 0.7,
  événements: 0.7,
  aéroport: 0.65,
};

export function reweightZonesByDriverMode<T extends { type: string; score: number }>(
  rankedZones: T[],
  driverMode: DriverMode
): T[] {
  if (driverMode === 'all') return rankedZones;
  const boostMap = driverMode === 'rideshare' ? RIDESHARE_BOOST : DELIVERY_BOOST;
  return [...rankedZones]
    .map((z) => ({
      ...z,
      score: Math.min(Math.round(z.score * (boostMap[z.type] ?? 1.0)), 100),
    }))
    .sort((a, b) => b.score - a.score);
}

// ── Return Corridor Routing (Anti-Deadhead) ───────────────────────────────
// After a drop-off in a dead zone (see useAntiDeadhead's LOW_SCORE_THRESHOLD),
// a single far-away "hot" zone can cost more in gas/wear than it's worth
// chasing directly. This breaks a long return trip into 2-3 intermediate
// step zones instead, prospecting on the way rather than deadheading.
//
// Deliberately reuses selectProspectionWaypoints (services/routing) for the
// corridor-buffer geometry instead of re-deriving it here — same algorithm
// already powers the Drive nav map's Prospection mode and is unit-tested.
// This layer only adds the two things that are genuinely new: the $/km cost
// adjustment before ranking candidates, and the >6km gate that decides
// whether a corridor is worth building at all.

/** $/km fuel + wear used to discount a candidate zone's score by distance. */
export const DEADHEAD_COST_PER_KM = 0.35;

/** Below this direct distance, just drive there -- no corridor needed. */
const RETURN_CORRIDOR_DIRECT_THRESHOLD_KM = 6;

export interface ReturnCorridorZone {
  id: string;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  score: number;
}

export interface ReturnCorridorStep extends ReturnCorridorZone {
  /** Cost-adjusted score used to pick this step (score - distanceKm * costPerKm). */
  effectiveScore: number;
}

export interface ReturnCorridorResult {
  /** True when a multi-step corridor was generated (direct distance > threshold). */
  active: boolean;
  directDistanceKm: number;
  steps: ReturnCorridorStep[];
}

/**
 * EffectiveScore = BaseScore - (DistanceToZoneKm * CostPerKmFactor) -- a zone
 * that scores high but sits far away can net out worse than a closer,
 * slightly-lower-scored one once the deadhead cost is priced in.
 */
export function computeEffectiveScore(
  baseScore: number,
  distanceKm: number,
  costPerKm: number = DEADHEAD_COST_PER_KM
): number {
  return baseScore - distanceKm * costPerKm;
}

/**
 * Builds a return corridor from `currentCoords` toward `targetHubCoords`:
 * empty/inactive when the direct distance is short enough to just drive,
 * otherwise up to 3 intermediate zones along the way, ranked by cost-
 * adjusted score so a costly detour to a distant "hot" zone loses to a
 * cheaper nearby one with a comparable raw score.
 */
export function getReturnCorridor(
  currentCoords: RoutePoint,
  targetHubCoords: RoutePoint,
  candidateZones: ReturnCorridorZone[],
  maxDetourKm = 2.5
): ReturnCorridorResult {
  const directDistanceKm = haversineKm(
    currentCoords.lat,
    currentCoords.lng,
    targetHubCoords.lat,
    targetHubCoords.lng
  );

  if (directDistanceKm <= RETURN_CORRIDOR_DIRECT_THRESHOLD_KM) {
    return { active: false, directDistanceKm, steps: [] };
  }

  const costAdjustedCandidates: RouteCandidateZone[] = candidateZones.map(
    (zone) => ({
      ...zone,
      score: computeEffectiveScore(
        zone.score,
        haversineKm(
          currentCoords.lat,
          currentCoords.lng,
          zone.latitude,
          zone.longitude
        )
      ),
    })
  );

  const waypoints = selectProspectionWaypoints(
    currentCoords,
    targetHubCoords,
    costAdjustedCandidates,
    { maxWaypoints: 3, corridorBufferKm: maxDetourKm }
  );

  const steps: ReturnCorridorStep[] = waypoints.map((wp) => {
    const original = candidateZones.find((z) => z.id === wp.id);
    return {
      id: wp.id,
      name: wp.name,
      type: original?.type ?? 'zone',
      latitude: wp.latitude,
      longitude: wp.longitude,
      score: original?.score ?? wp.score,
      effectiveScore: wp.score,
    };
  });

  return { active: steps.length > 0, directDistanceKm, steps };
}
