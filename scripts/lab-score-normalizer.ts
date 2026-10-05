// Lab experiment — compares 4 ways to display zone scores when peak-hour raw
// scores exceed 100 (see src/lib/scoreNormalization.ts). READ-ONLY: only GETs on
// public tables (zones, scores); nothing is written to the DB or to the app.
//
// Usage (anon key + URL come from .env.local, like the other tsx scripts):
//   npx tsx --env-file=.env.local scripts/lab-score-normalizer.ts
//       -> simulates peak/off-peak hours on the live zones.base_score
//   npx tsx --env-file=.env.local scripts/lab-score-normalizer.ts --snapshot [out.json]
//       -> saves zones + the last 24h of `scores` to artifacts/ (gitignored). Run it on a
//          Friday/Saturday evening 18h-23h: `scores` is purged after 24h.
//   npx tsx --env-file=.env.local scripts/lab-score-normalizer.ts --from artifacts/<file>.json
//       -> evaluates the methods on the busiest REAL runs of a snapshot
/// <reference types="node" />
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  NORMALIZATION_METHODS,
  PEAK_FACTOR,
  computeMetrics,
  normalizeAll,
  rawScore,
  type NormalizationMethod,
} from '../src/lib/scoreNormalization';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://hibzhsjgipybfihhzpxr.supabase.co';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const PAGE = 1000;

interface ZoneRow {
  id: string;
  name: string;
  type: string | null;
  base_score: number;
}

interface ScoreRow {
  id: string;
  zone_id: string;
  score: number;
  weather_boost: number;
  event_boost: number;
  final_score: number;
  calculated_at: string;
}

interface Snapshot {
  fetchedAt: string;
  zones: ZoneRow[];
  scores: ScoreRow[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown): number => Number(v);

function toZone(v: unknown): ZoneRow | null {
  if (!isRecord(v) || typeof v.id !== 'string' || v.base_score == null) return null;
  return { id: v.id, name: String(v.name ?? v.id), type: typeof v.type === 'string' ? v.type : null, base_score: num(v.base_score) };
}

function toScore(v: unknown): ScoreRow | null {
  if (!isRecord(v) || typeof v.id !== 'string' || typeof v.zone_id !== 'string' || typeof v.calculated_at !== 'string') return null;
  return {
    id: v.id,
    zone_id: v.zone_id,
    score: num(v.score),
    weather_boost: num(v.weather_boost ?? 0),
    event_boost: num(v.event_boost ?? 0),
    final_score: num(v.final_score),
    calculated_at: v.calculated_at,
  };
}

async function rest(pathAndQuery: string): Promise<unknown[]> {
  if (!ANON_KEY) throw new Error('VITE_SUPABASE_ANON_KEY manquante — lance avec --env-file=.env.local');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`GET ${pathAndQuery} -> HTTP ${res.status}`);
  const json: unknown = await res.json();
  return Array.isArray(json) ? json : [];
}

async function fetchZones(): Promise<ZoneRow[]> {
  const rows = await rest('zones?select=id,name,type,base_score&base_score=not.is.null&order=id.asc&limit=1000');
  return rows.map(toZone).filter((z): z is ZoneRow => z !== null);
}

async function fetchAllScores(): Promise<ScoreRow[]> {
  const out: ScoreRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await rest(
      `scores?select=id,zone_id,score,weather_boost,event_boost,final_score,calculated_at&order=calculated_at.asc,id.asc&limit=${PAGE}&offset=${offset}`
    );
    out.push(...rows.map(toScore).filter((s): s is ScoreRow => s !== null));
    if (rows.length < PAGE) return out;
  }
}

// ── Reporting ─────────────────────────────────────────────────────────────────

const LABELS: Record<NormalizationMethod, string> = {
  clamp: 'Plafond actuel',
  softKnee: 'Coude doux (≥80)',
  fixedRescale: 'Rééchelle fixe',
  percentileRank: 'Rang percentile',
};

function printTable(title: string, raws: number[], maxPossibleRaw: number): void {
  const normalized = normalizeAll(raws, { maxPossibleRaw });
  const sorted = [...raws].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  console.log(`\n### ${title}`);
  console.log(`${raws.length} zones — brut: médiane ${median.toFixed(1)}, max ${Math.max(...raws).toFixed(1)}, ≥100: ${raws.filter((r) => r >= 100).length}`);
  console.log('\n| Méthode | Zones à 100 | Valeurs distinctes | Min–Max affichés | Kendall τ | Inversions |');
  console.log('|---|---:|---:|---|---:|---:|');
  for (const method of NORMALIZATION_METHODS) {
    const m = computeMetrics(raws, normalized[method]);
    console.log(
      `| ${LABELS[method]} | ${m.at100} | ${m.distinctValues} | ${m.min.toFixed(0)}–${m.max.toFixed(0)} | ${m.tau.toFixed(3)} | ${m.inversions} |`
    );
  }
}

const SCENARIOS = [
  { label: 'Vendredi 18h (pointe max, ×1.69)', dow: 5, hour: 18 },
  { label: 'Samedi 23h (nuit de fin de semaine)', dow: 6, hour: 23 },
  { label: 'Jeudi 12h (jour normal)', dow: 4, hour: 12 },
  { label: 'Dimanche 04h (creux)', dow: 0, hour: 4 },
] as const;

function simulate(zones: ZoneRow[]): void {
  const maxBase = Math.max(...zones.map((z) => z.base_score));
  const maxPossibleRaw = maxBase * PEAK_FACTOR;
  console.log(`Simulation sur ${zones.length} zones réelles (base_score ${Math.min(...zones.map((z) => z.base_score))}–${maxBase}).`);
  console.log(`Hypothèses: formule SQL recalculate_zone_scores sans boosts météo/événements; rééchelle fixe = base max × ${PEAK_FACTOR.toFixed(2)} = ${maxPossibleRaw.toFixed(1)}.`);
  for (const s of SCENARIOS) {
    printTable(s.label, zones.map((z) => rawScore(z.base_score, z.type, s.dow, s.hour)), maxPossibleRaw);
  }
}

function evaluateSnapshot(snap: Snapshot): void {
  const runs = new Map<string, ScoreRow[]>();
  for (const row of snap.scores) runs.set(row.calculated_at, [...(runs.get(row.calculated_at) ?? []), row]);
  const busiest = [...runs.entries()]
    .map(([at, rows]) => ({ at, rows, raws: rows.map((r) => r.score + r.weather_boost + r.event_boost) }))
    .sort((a, b) => b.raws.filter((r) => r >= 100).length - a.raws.filter((r) => r >= 100).length)
    .slice(0, 2);
  const maxBase = Math.max(...snap.zones.map((z) => z.base_score));
  console.log(`Snapshot du ${snap.fetchedAt}: ${runs.size} passages, ${snap.scores.length} lignes.`);
  console.log('Limite: `score` est déjà plafonné à 100 en base, donc le "brut" ci-dessous = score + météo + événements, sous-estimé au pic.');
  for (const run of busiest) printTable(`Passage réel ${run.at}`, run.raws, maxBase * PEAK_FACTOR);
}

// ── Entry point ───────────────────────────────────────────────────────────────

function parseSnapshot(file: string): Snapshot {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf-8'));
  if (!isRecord(parsed) || !Array.isArray(parsed.zones) || !Array.isArray(parsed.scores)) throw new Error('Snapshot invalide');
  return {
    fetchedAt: String(parsed.fetchedAt ?? '?'),
    zones: parsed.zones.map(toZone).filter((z): z is ZoneRow => z !== null),
    scores: parsed.scores.map(toScore).filter((s): s is ScoreRow => s !== null),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fromIdx = args.indexOf('--from');
  if (fromIdx >= 0) return evaluateSnapshot(parseSnapshot(args[fromIdx + 1] ?? ''));

  const zones = await fetchZones();
  if (args.includes('--snapshot')) {
    const scores = await fetchAllScores();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    const custom = args[args.indexOf('--snapshot') + 1];
    const out = custom && !custom.startsWith('--') ? custom : path.join('artifacts', `score-snapshot-${stamp}.json`);
    mkdirSync(path.dirname(out), { recursive: true });
    const snap: Snapshot = { fetchedAt: new Date().toISOString(), zones, scores };
    writeFileSync(out, JSON.stringify(snap));
    console.log(`Snapshot écrit: ${out} (${zones.length} zones, ${scores.length} lignes de scores).`);
    return;
  }
  simulate(zones);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
