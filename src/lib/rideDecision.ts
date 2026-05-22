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

  // Score is summed from each rule (positive = take, negative = skip)
  let score = 0;

  // $/km signal
  const dpk = metrics.dollarsPerKm;
  if (dpk !== null) {
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

  // Effective hourly rate (including pickup deadhead)
  const eff = metrics.effectiveHourlyRate;
  if (eff !== null) {
    if (eff >= TAKE_HOURLY) {
      score += 2;
      reasoning.push(`Taux horaire effectif : $${eff.toFixed(0)}/h ✓`);
    } else if (eff <= SKIP_HOURLY) {
      score -= 3;
      reasoning.push(`Taux horaire effectif : $${eff.toFixed(0)}/h (sous le seuil $${SKIP_HOURLY}/h)`);
    } else {
      reasoning.push(`Taux horaire effectif : $${eff.toFixed(0)}/h (acceptable)`);
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
