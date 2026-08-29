// Data-bootstrap: injects synthetic trips as a Bayesian prior for
// learningEngine.ts while the real trip volume is too low to train the
// scoring engine's 61-zone EMA/Bayesian model. Run once (or re-run to
// replace the batch) with: npm run seed:synthetic
//
// Real courses always win: synthetic rows get `source = 'synthetic'` and
// a wider observationVariance in learningEngine.ts, so the Bayesian
// posterior swings toward real data as soon as a few real trips land in
// the same zone/day/slot bucket. See supabase/migrations/
// 20260826000008_trips_source_and_synthetic_read.sql for the schema side.
//
// Node-only script (run via `tsx`, never bundled by Vite) — tsconfig.app.json
// targets the browser (no `node` in `types`), so this needs its own reference
// for `process`/`node:url` rather than widening the app-wide config.
/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';
import type { Database } from '../integrations/supabase/types';

type Platform = 'lyft' | 'hypra' | 'imoove';
type ZoneRow = Pick<
  Database['public']['Tables']['zones']['Row'],
  'id' | 'city_id' | 'type'
>;
type TripInsert = Database['public']['Tables']['trips']['Insert'];
type Period = 'rush_am' | 'rush_pm' | 'nightlife' | 'daytime' | 'off_peak';

const TOTAL_TRIPS = 5000;
const DAYS_BACK = 90;
const BATCH_SIZE = 500;
// mtl holds every "centre" zone type (métro, commercial, nightlife...);
// the other 7 city_ids (blv, lvl, lng, rsm, sth, trb, bsb) are the banlieue.
const CENTRE_CITY_ID = 'mtl';

const PLATFORM_WEIGHTS: ReadonlyArray<readonly [Platform, number]> = [
  ['lyft', 0.55],
  ['hypra', 0.35],
  ['imoove', 0.1],
];

// Relative pickup-volume weight per zone type outside rush/nightlife windows.
const ZONE_TYPE_WEIGHTS: Record<string, number> = {
  commercial: 3,
  métro: 3,
  résidentiel: 2,
  transport: 2,
  université: 2,
  nightlife: 1.5,
  médical: 1,
  événements: 1,
  aéroport: 1,
  tourisme: 1,
};

interface PeriodParams {
  distanceKm: readonly [number, number];
  durationMin: readonly [number, number];
  surge: readonly [number, number];
}

// Calibrated against the real fleet baseline (~13.77$ CAD avg over 125
// trips) so the synthetic prior doesn't skew learningEngine.ts toward
// suburban-length trips. Distances are short/urban (MTL/Laval density),
// not the 12-25km highway-commute range a literal "banlieue -> centre"
// reading would suggest -- that combination overshoots to ~19-23$/trip
// once run through base+$/km+$/min. See computeFare's weighted-average
// derivation in the PR description if these ever need re-tuning.
const PERIOD_PARAMS: Record<Period, PeriodParams> = {
  // Banlieue pickup -> trip toward the centre, morning demand premium.
  rush_am: { distanceKm: [2, 6], durationMin: [5, 13], surge: [1.05, 1.15] },
  // Centre pickup -> trip toward the banlieue, evening demand premium.
  rush_pm: { distanceKm: [2, 6], durationMin: [5, 13], surge: [1.05, 1.15] },
  nightlife: { distanceKm: [2, 5], durationMin: [5, 11], surge: [1.1, 1.2] },
  daytime: { distanceKm: [2, 6], durationMin: [5, 13], surge: [1, 1] },
  off_peak: { distanceKm: [1.5, 4.5], durationMin: [4, 10], surge: [1, 1] },
};

const PERIOD_HOUR_RANGES: Record<Period, readonly [number, number]> = {
  rush_am: [6 * 60 + 30, 9 * 60 + 30],
  rush_pm: [15 * 60 + 30, 18 * 60 + 30],
  nightlife: [22 * 60, 27 * 60], // wraps past midnight, folded back below
  daytime: [9 * 60 + 30, 21 * 60],
  off_peak: [0, 6 * 60 + 30],
};

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number): number {
  return Math.floor(randomBetween(min, max + 1));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Box-Muller transform -- stdlib Math only, no RNG dependency needed.
function gaussianNoise(mean: number, stdDev: number): number {
  const u1 = Math.random() || Number.EPSILON;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

function pickWeighted<T>(items: readonly T[], weight: (item: T) => number): T {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= weight(item);
    if (roll <= 0) return item;
  }
  return items[items.length - 1]!; // caller guarantees a non-empty list
}

export function pickPlatform(): Platform {
  return pickWeighted(PLATFORM_WEIGHTS, ([, weight]) => weight)[0];
}

// AM/PM rush hours are weekday-only; nightlife runs Thu-Sat. Whatever's left
// (daytime vs. quiet off-peak) is split 80/20. Exported, with both rolls
// injectable, so the distribution can be sanity-checked in a test without
// hitting Supabase or relying on Math.random().
export function pickPeriod(
  dayOfWeek: number,
  roll: number,
  daytimeRoll: number = Math.random()
): Period {
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  const isNightlifeDay = dayOfWeek === 4 || dayOfWeek === 5 || dayOfWeek === 6;

  if (isWeekday && roll < 0.25) return 'rush_am';
  if (isWeekday && roll < 0.5) return 'rush_pm';
  if (isNightlifeDay && roll < 0.65) return 'nightlife';
  return daytimeRoll < 0.8 ? 'daytime' : 'off_peak';
}

function pickZoneForPeriod(zones: readonly ZoneRow[], period: Period): ZoneRow {
  if (period === 'rush_am') {
    return pickWeighted(zones, (zone) =>
      zone.city_id === CENTRE_CITY_ID ? 1 : 3
    );
  }
  if (period === 'rush_pm') {
    return pickWeighted(zones, (zone) =>
      zone.city_id === CENTRE_CITY_ID ? 3 : 1
    );
  }
  if (period === 'nightlife') {
    return pickWeighted(zones, (zone) => (zone.type === 'nightlife' ? 6 : 1));
  }
  return pickWeighted(zones, (zone) => ZONE_TYPE_WEIGHTS[zone.type] ?? 1);
}

// base + $/km + $/min, +/-15% noise, surge applied on top for rush/nightlife.
export function computeFare(
  distanceKm: number,
  durationMin: number,
  surge: number
): number {
  const metered = 3.5 + 1.75 * distanceKm + 0.35 * durationMin;
  const noiseFactor = clamp(gaussianNoise(1, 0.15), 0.7, 1.3);
  return round2(metered * surge * noiseFactor);
}

function randomStartedAt(now: Date): { startedAt: Date; period: Period } {
  const dayOffset = randomInt(0, DAYS_BACK - 1);
  const day = new Date(now);
  day.setDate(day.getDate() - dayOffset);
  const period = pickPeriod(day.getDay(), Math.random());

  const [minMinute, maxMinute] = PERIOD_HOUR_RANGES[period];
  const minutesOfDay = randomInt(minMinute, maxMinute) % (24 * 60);
  day.setHours(Math.floor(minutesOfDay / 60), minutesOfDay % 60, 0, 0);

  return { startedAt: day, period };
}

export function buildSyntheticTrip(
  zones: readonly ZoneRow[],
  now = new Date()
): TripInsert {
  const { startedAt, period } = randomStartedAt(now);
  const zone = pickZoneForPeriod(zones, period);
  const params = PERIOD_PARAMS[period];

  const distanceKm = round2(randomBetween(...params.distanceKm));
  const durationMin = randomInt(...params.durationMin);
  const surge = randomBetween(...params.surge);
  const fare = computeFare(distanceKm, durationMin, surge);
  const tip = round2(fare * randomBetween(0, 0.2));
  const endedAt = new Date(startedAt.getTime() + durationMin * 60_000);

  return {
    zone_id: zone.id,
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    earnings: fare,
    tips: tip,
    distance_km: distanceKm,
    platform: pickPlatform(),
    experiment: false,
    source: 'synthetic',
  };
}

async function main(): Promise<void> {
  const url = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définies ' +
        '(.env local, jamais commitées -- la clé service_role bypass RLS).'
    );
  }

  const supabase = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: zones, error: zonesError } = await supabase
    .from('zones')
    .select('id, city_id, type');
  if (zonesError) throw zonesError;
  if (!zones || zones.length === 0) {
    throw new Error('Aucune zone trouvée -- seed les zones avant les trips.');
  }

  console.log('Suppression des courses synthétiques existantes...');
  const { error: deleteError } = await supabase
    .from('trips')
    .delete()
    .eq('source', 'synthetic');
  if (deleteError) throw deleteError;

  const now = new Date();
  let inserted = 0;
  let earningsSum = 0;

  for (let offset = 0; offset < TOTAL_TRIPS; offset += BATCH_SIZE) {
    const batchSize = Math.min(BATCH_SIZE, TOTAL_TRIPS - offset);
    const batch = Array.from({ length: batchSize }, () =>
      buildSyntheticTrip(zones, now)
    );
    const { error } = await supabase.from('trips').insert(batch);
    if (error) throw error;

    inserted += batchSize;
    earningsSum += batch.reduce((sum, trip) => sum + (trip.earnings ?? 0), 0);
    console.log(`${inserted}/${TOTAL_TRIPS} courses synthétiques insérées`);
  }

  const avgFare = round2(earningsSum / inserted);
  console.log(
    `\nRésumé: ${inserted} courses synthétiques, fare moyen = ${avgFare}$ CAD ` +
      '(cible ~14.50$, baseline réelle ~13.77$).'
  );
}

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((error: unknown) => {
    console.error('[seedSyntheticTrips] échec:', error);
    process.exitCode = 1;
  });
}
