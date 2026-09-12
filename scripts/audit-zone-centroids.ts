// Cross-checks each zone's DB centroid against taxiStands.ts addresses that
// name-match the zone (same method used to catch mtl-anjou: a stand address
// citing the zone's own landmark is better ground truth than the centroid).
// Flags any zone whose best-matching stand sits >300m from the centroid.
//
// Usage: npx tsx scripts/audit-zone-centroids.ts
import { TAXI_STANDS } from '../src/data/taxiStands';

interface Zone {
  id: string;
  name: string;
  city_id: string;
  latitude: number;
  longitude: number;
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://hibzhsjgipybfihhzpxr.supabase.co';

const STOP = new Set([
  'boul', 'boulevard', 'rue', 'avenue', 'av', 'chemin', 'ch', 'place', 'pl',
  'de', 'des', 'du', 'la', 'le', 'les', 'et', 'au', 'aux', 'en', 'sur',
  'saint', 'sainte', 'st', 'ste', 'station', 'gare', 'centre', 'exo',
  'the', 'and', 'of',
]);

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ');
}

function significantWords(text: string): string[] {
  return normalize(text)
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function fetchZones(): Promise<Zone[]> {
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!key) throw new Error('Set VITE_SUPABASE_ANON_KEY in env (see .env.local)');
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/zones?select=id,name,city_id,latitude,longitude`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) throw new Error(`Zones fetch failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const zones = await fetchZones();
  const threshold = 300;
  const confirmed: string[] = [];
  const noMatch: string[] = [];

  for (const zone of zones) {
    const nameWords = significantWords(zone.name);
    if (nameWords.length === 0) {
      noMatch.push(`${zone.id} ("${zone.name}") — nom sans mot significatif à matcher`);
      continue;
    }

    const matches = TAXI_STANDS.filter(
      (s) =>
        s.zoneId === zone.id &&
        nameWords.some((w) => normalize(s.address).includes(w)),
    );

    if (matches.length === 0) {
      noMatch.push(`${zone.id} ("${zone.name}") — aucun poste taxi ne cite ce nom`);
      continue;
    }

    let best = matches[0]!;
    let bestDist = haversineM(zone.latitude, zone.longitude, best.latitude, best.longitude);
    for (const m of matches.slice(1)) {
      const d = haversineM(zone.latitude, zone.longitude, m.latitude, m.longitude);
      if (d < bestDist) {
        best = m;
        bestDist = d;
      }
    }

    if (bestDist > threshold) {
      confirmed.push(
        `${zone.id} ("${zone.name}") — ${(bestDist / 1000).toFixed(2)} km du poste ` +
          `"${best.address}" (${best.latitude}, ${best.longitude})`,
      );
    }
  }

  console.log(`\n=== Zones à >300m d'un poste taxi qui cite leur propre nom (${confirmed.length}) ===`);
  confirmed.forEach((l) => console.log('  ' + l));

  console.log(`\n=== Zones sans preuve croisée disponible (${noMatch.length}) — à vérifier manuellement ===`);
  noMatch.forEach((l) => console.log('  ' + l));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
