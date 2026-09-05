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

// Floor absolu — sous ces deux seuils SIMULTANÉMENT, la course est un skip
// forcé quel que soit le reste du scoring (perte nette pour la Santa Fe 2018,
// ~$0.55-0.60/mi de coût d'opération réel). $0.65/mi converti en $/km.
const MILE_TO_KM = 1.60934;
const FLOOR_PER_KM_RIDESHARE = round2(0.65 / MILE_TO_KM); // ≈ $0.40/km
const FLOOR_HOURLY_RIDESHARE = 18;
const FLOOR_PER_KM_DELIVERY = 0.85; // déjà en km (SkipTheDishes/DoorDash)
const FLOOR_HOURLY_DELIVERY = 28;

function floorThresholds(platform: 'rideshare' | 'delivery') {
  return platform === 'delivery'
    ? { perKm: FLOOR_PER_KM_DELIVERY, hourly: FLOOR_HOURLY_DELIVERY }
    : { perKm: FLOOR_PER_KM_RIDESHARE, hourly: FLOOR_HOURLY_RIDESHARE };
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

  const { perKm: floorPerKm, hourly: floorHourly } = floorThresholds(ctx.platform ?? 'rideshare');
  const dpk = metrics.dollarsPerKm;
  const eff = metrics.effectiveHourlyRate;

  // Floor absolu : sous les DEUX seuils en même temps → skip forcé, perte nette.
  if (dpk !== null && eff !== null && dpk < floorPerKm && eff < floorHourly) {
    return {
      verdict: 'skip',
      confidence: 100,
      reasoning: [
        `Floor absolu franchi : $${dpk.toFixed(2)}/km ET $${eff.toFixed(0)}/h sous les seuils ($${floorPerKm.toFixed(2)}/km, $${floorHourly}/h) — perte nette`,
      ],
      metrics,
    };
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
