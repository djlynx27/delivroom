// Decision agent for Lyft / Uber ride offers.
//
// Given the extracted_data from a ride card screenshot + the current city
// zone scores, decides whether the driver should TAKE the ride, SKIP it,
// or that the data is too thin to call (MEH).
//
// Calibrated for Montréal taxi market (Hypra plan + Lyft):
// - Average paying ride is ~$1.80/km
// - Time spent on the road has an opportunity cost of ~$30/h while
//   waiting and ~$50/h actively driving (so we need >$35/h to make the
//   offer worth doing vs. a counterfactual better ride).
// - Pickup ratio: if pickup distance > 50% of the ride distance, it's
//   typically not worth it (huge deadhead).
//
// Units: km throughout, matching what the Lyft Driver screenshot actually
// shows in Québec (the analyze-screenshot edge function already converts
// mi → km on ingest). The $/mi Maxymo floor below is a separate driver
// tool configured in miles to mirror Lyft's own summary screen — it's
// converted to $/km here so both stay in sync without mixing units.
//
// Lyft Upfront Pay is a fixed fare: it does not get recalculated if
// traffic makes the trip take longer, so ETA/time estimates from the
// screenshot are the only lever on effectiveHourlyRate — there's no
// "actual vs. estimated" data available at accept-time to penalize
// further.

export interface RideOfferContext {
  earnings: number | null;
  pickupTimeMin: number | null;
  pickupDistKm: number | null;
  rideTimeMin: number | null;
  rideDistKm: number | null;
  /** Optional — the current best zone score (0..100) of the dropoff zone */
  dropoffZoneScore?: number | null;
  /** Optional — pickup zone score */
  pickupZoneScore?: number | null;
  /** 'rideshare' (Lyft/Uber, default) or 'delivery' (SkipTheDishes/DoorDash) — changes the floor thresholds below */
  platform?: 'rideshare' | 'delivery';
  /** Minutes since the last ride ended (no active ride) — drives the elastic
   * $/h floor below. Null/undefined = treated as not idle (no decay). */
  idleMinutes?: number | null;
  /** True during a peak/high-demand window (rush hour, weekend nightlife,
   * an active event) — raises the elastic $/h floor's base. */
  isPeakHour?: boolean;
}

export type Verdict = 'take' | 'skip' | 'meh';

export interface Decision {
  verdict: Verdict;
  // 0..100 confidence in the verdict (0 = no idea, 100 = obvious)
  confidence: number;
  reasoning: string[];
  // Key metrics surfaced for the driver
  metrics: {
    dollarsPerKm: number | null;
    dollarsPerMin: number | null;
    effectiveHourlyRate: number | null;  // total time including pickup
    paidHourlyRate: number | null;       // only the paid ride leg
    pickupRatio: number | null;          // pickup_km / ride_km
    totalTimeMin: number | null;
    totalDistKm: number | null;
  };
}

// Thresholds — opinionated defaults the driver can tune later in settings
const TAKE_HOURLY = 50;       // ≥$50/h effective → take
const SKIP_HOURLY = 25;       // ≤$25/h effective → skip
const TAKE_PER_KM = 2.0;      // ≥$2/km → take
const SKIP_PER_KM = 1.0;      // ≤$1/km → skip
const SKIP_PICKUP_RATIO = 0.5; // pickup_km > 50% of ride_km → skip
const STRATEGIC_DROPOFF_THRESHOLD = 70; // dropoff zone score ≥70 → strategic boost

// Delivery keeps its own fixed floor (unaffected by idle-time decay below —
// SkipTheDishes/DoorDash payouts don't have the same "wait it out" dynamic
// as a rideshare queue).
const FLOOR_PER_KM_DELIVERY = 0.85; // already in km
const FLOOR_HOURLY_DELIVERY = 28;

// Elastic $/h floor (rideshare only) — the required rate a driver will
// accept decays the longer they've been idle, since the opportunity cost of
// continuing to wait rises with idle time. Never AND'd with the $/km floor
// below: each is checked independently, so a ride can't slip through on a
// good number in the other metric.
const ELASTIC_HOURLY_OFFPEAK = 23;
const ELASTIC_HOURLY_PEAK = 29;
const ELASTIC_HOURLY_DECAY_GRACE_MIN = 15; // no decay before this much idle time
const ELASTIC_HOURLY_DECAY_STEP_MIN = 10;  // one decay step per this many minutes past the grace period
const ELASTIC_HOURLY_DECAY_PER_STEP = 2;   // $/h shaved off per step
const ELASTIC_HOURLY_FLOOR = 20;           // hard minimum — never decays below this

/**
 * The $/h a ride must clear right now to not be a forced skip: starts at the
 * peak/off-peak base and steps down $2/h every 10 minutes once idle time
 * passes the 15-minute grace period, bottoming out at $20/h.
 */
export function computeElasticHourlyFloor(isPeakHour: boolean, idleMinutes: number | null | undefined): number {
  const base = isPeakHour ? ELASTIC_HOURLY_PEAK : ELASTIC_HOURLY_OFFPEAK;
  if (idleMinutes == null || idleMinutes <= ELASTIC_HOURLY_DECAY_GRACE_MIN) return base;
  const steps = Math.floor((idleMinutes - ELASTIC_HOURLY_DECAY_GRACE_MIN) / ELASTIC_HOURLY_DECAY_STEP_MIN);
  return Math.max(ELASTIC_HOURLY_FLOOR, base - steps * ELASTIC_HOURLY_DECAY_PER_STEP);
}

// Strict $/km floor (rideshare only) — never crossed regardless of how good
// $/h looks or how long the driver has been idle: a short, fast, cheap ride
// can post a great effective hourly rate while still under-compensating the
// vehicle's real per-km cost (fuel/wear). $0.70/km is deliberately above the
// Santa Fe 2018's measured ~$0.55-0.60/mi operating cost — a safety margin,
// not just a break-even line.
const STRICT_PER_KM_FLOOR_RIDESHARE = 0.7;

type ForcedFloorMetrics = { dollarsPerKm: number | null; effectiveHourlyRate: number | null };

/** Hard-floor gate, checked before any of the scored take/skip rules. Returns
 * the forced-skip reasoning line, or null when nothing below-floor applies. */
function checkForcedFloorSkip(
  ctx: RideOfferContext,
  metrics: ForcedFloorMetrics,
  platform: 'rideshare' | 'delivery',
): string | null {
  const { dollarsPerKm: dpk, effectiveHourlyRate: eff } = metrics;

  if (platform === 'delivery') {
    // Delivery keeps the original combined floor (both metrics bad at once).
    if (dpk !== null && eff !== null && dpk < FLOOR_PER_KM_DELIVERY && eff < FLOOR_HOURLY_DELIVERY) {
      return `Floor absolu franchi : $${dpk.toFixed(2)}/km ET $${eff.toFixed(0)}/h sous les seuils ($${FLOOR_PER_KM_DELIVERY.toFixed(2)}/km, $${FLOOR_HOURLY_DELIVERY}/h) — perte nette`;
    }
    return null;
  }

  // Rideshare: two independent, unconditional floors — either one alone
  // forces a skip, since a great number on the other metric doesn't
  // compensate for undercutting vehicle cost or wasting idle time.
  if (dpk !== null && dpk < STRICT_PER_KM_FLOOR_RIDESHARE) {
    return `$/km sous le plancher strict : $${dpk.toFixed(2)}/km < $${STRICT_PER_KM_FLOOR_RIDESHARE.toFixed(2)}/km — coûts véhicule non couverts`;
  }
  const elasticFloor = computeElasticHourlyFloor(ctx.isPeakHour ?? false, ctx.idleMinutes);
  if (eff !== null && eff < elasticFloor) {
    const idleNote = ctx.idleMinutes != null ? `, idle ${ctx.idleMinutes} min` : '';
    return (
      `Taux horaire sous le seuil élastique : $${eff.toFixed(0)}/h < $${elasticFloor.toFixed(0)}/h ` +
      `(${ctx.isPeakHour ? 'heure de pointe' : 'hors pointe'}${idleNote})`
    );
  }
  return null;
}

export function decideRideOffer(ctx: RideOfferContext): Decision {
  const reasoning: string[] = [];

  const earnings = ctx.earnings ?? 0;
  const pickupTime = ctx.pickupTimeMin ?? 0;
  const pickupDist = ctx.pickupDistKm ?? 0;
  const rideTime = ctx.rideTimeMin ?? 0;
  const rideDist = ctx.rideDistKm ?? 0;
  const totalTime = pickupTime + rideTime;
  const totalDist = pickupDist + rideDist;

  const metrics = {
    dollarsPerKm: rideDist > 0 ? round2(earnings / rideDist) : null,
    dollarsPerMin: totalTime > 0 ? round2(earnings / totalTime) : null,
    effectiveHourlyRate: totalTime > 0 ? round2((earnings / totalTime) * 60) : null,
    paidHourlyRate: rideTime > 0 ? round2((earnings / rideTime) * 60) : null,
    pickupRatio: rideDist > 0 ? round2(pickupDist / rideDist) : null,
    totalTimeMin: totalTime || null,
    totalDistKm: totalDist > 0 ? round2(totalDist) : null,
  };

  // Need at minimum earnings + ride distance OR time to decide
  if (!earnings || (rideDist === 0 && rideTime === 0)) {
    return {
      verdict: 'meh',
      confidence: 0,
      reasoning: ['Données insuffisantes pour décider (prix ou trajet manquant)'],
      metrics,
    };
  }

  const dpk = metrics.dollarsPerKm;
  const eff = metrics.effectiveHourlyRate;
  const platform = ctx.platform ?? 'rideshare';

  const forcedFloorReason = checkForcedFloorSkip(ctx, metrics, platform);
  if (forcedFloorReason) {
    return { verdict: 'skip', confidence: 100, reasoning: [forcedFloorReason], metrics };
  }

  // Score is summed from each rule (positive = take, negative = skip)
  let score = 0;

  // $/hr prime sur $/km : un $/hr vert valide la course même si $/km est faible.
  if (eff !== null && eff >= TAKE_HOURLY) {
    score += 2;
    reasoning.push(`Taux horaire effectif : $${eff.toFixed(0)}/h ✓ (prime sur $/km)`);
  } else if (eff !== null && eff <= SKIP_HOURLY) {
    score -= 3;
    reasoning.push(`Taux horaire effectif : $${eff.toFixed(0)}/h (sous le seuil $${SKIP_HOURLY}/h)`);
  } else if (eff !== null) {
    reasoning.push(`Taux horaire effectif : $${eff.toFixed(0)}/h (acceptable)`);
  }

  // $/km signal — ignoré si le $/hr est déjà vert (règle de hiérarchie ci-dessus)
  if (dpk !== null && !(eff !== null && eff >= TAKE_HOURLY)) {
    if (dpk >= TAKE_PER_KM) {
      score += 2;
      reasoning.push(`$/km excellent : $${dpk.toFixed(2)}/km (cible ≥$${TAKE_PER_KM})`);
    } else if (dpk <= SKIP_PER_KM) {
      score -= 2;
      reasoning.push(`$/km trop bas : $${dpk.toFixed(2)}/km (seuil $${SKIP_PER_KM})`);
    } else {
      reasoning.push(`$/km moyen : $${dpk.toFixed(2)}/km`);
    }
  }

  // Pickup deadhead ratio
  if (metrics.pickupRatio !== null) {
    if (metrics.pickupRatio > SKIP_PICKUP_RATIO) {
      score -= 2;
      reasoning.push(
        `Pickup deadhead trop long : ${(metrics.pickupRatio * 100).toFixed(0)}% du trajet`,
      );
    } else if (metrics.pickupRatio < 0.15) {
      score += 1;
      reasoning.push(`Pickup minimal (${(metrics.pickupRatio * 100).toFixed(0)}% du trajet)`);
    }
  }

  // Strategic dropoff — does the ride end in a hot zone?
  if (ctx.dropoffZoneScore != null && ctx.dropoffZoneScore >= STRATEGIC_DROPOFF_THRESHOLD) {
    score += 1;
    reasoning.push(
      `Dropoff dans une zone forte (score ${ctx.dropoffZoneScore}) → bon repositionnement`,
    );
  } else if (ctx.dropoffZoneScore != null && ctx.dropoffZoneScore < 40) {
    score -= 1;
    reasoning.push(
      `Dropoff dans une zone faible (score ${ctx.dropoffZoneScore}) → ride retour dead`,
    );
  }

  // Final verdict
  let verdict: Verdict;
  if (score >= 3) verdict = 'take';
  else if (score <= -2) verdict = 'skip';
  else verdict = 'meh';

  const confidence = Math.min(100, Math.abs(score) * 20);

  return { verdict, confidence, reasoning, metrics };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
