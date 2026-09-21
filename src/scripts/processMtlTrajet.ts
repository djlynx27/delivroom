// Étape 2 du pipeline d'ingestion Ville de Montréal : stream-lit
// trajets_mtl_trajet_2017.zip (139 MB zippé / ~822 MB de GeoJSON une fois
// décompressé) sans jamais matérialiser le fichier ou le tableau `features`
// en mémoire — dézippage en flux (yauzl) → parsing JSON en flux
// (stream-json, `pick` + `streamArray`) → un `Feature` à la fois. Seuls des
// compteurs agrégés zone × heure (66 zones × 24 slots, quelques Ko) vivent
// dans le heap Node du début à la fin, peu importe la taille du fichier
// source.
//
// Node-only script (run via `tsx`, jamais bundlé par Vite) — voir la note
// dans seedSyntheticTrips.ts sur pourquoi ce fichier a sa propre référence
// node plutôt qu'un tsconfig élargi.
/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { open as openZip } from 'yauzl';
import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/pick.js';
import { streamArray } from 'stream-json/streamers/stream-array.js';
import chain from 'stream-chain';
import type { Database } from '../integrations/supabase/types';
import { nearestZone, type ZoneRow } from './lib/geo';

type TrajetFeature = {
  properties: { id_trip: number; starttime: string; endtime: string };
  geometry: { type: string; coordinates: unknown };
};

const MAX_ZONE_DISTANCE_M = 3000;
const DEFAULT_ZIP_PATH = 'D:/documents/Transport dataset/trajets_mtl_trajet_2017.zip';
const OUTPUT_PATH = new URL('../data/zoneDemandWeights.json', import.meta.url);
const PROGRESS_EVERY = 200_000;

// MultiLineString/LineString coordinates nest arbitrarily deep before
// reaching a [lng, lat] pair; descend into [0] until we hit one.
function firstPoint(coordinates: unknown): [number, number] | null {
  let node = coordinates;
  while (Array.isArray(node)) {
    if (node.length === 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
      return [node[0], node[1]];
    }
    node = node[0];
  }
  return null;
}

// "2017-09-18 04:16:58UTC" — parsed by slice, not `Date`, to sidestep the
// ambiguous non-standard "UTC" suffix (no space, no offset) that `Date`
// would otherwise mis-parse or silently accept inconsistently across
// Node/V8 versions.
function departureHour(starttime: string): number | null {
  const hour = Number.parseInt(starttime.slice(11, 13), 10);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

type ZoneAgg = { cityId: string; hourlyDepartures: number[]; totalDepartures: number };

function makeAggregator(zones: readonly ZoneRow[]) {
  const byZone = new Map<string, ZoneAgg>();
  for (const zone of zones) {
    byZone.set(zone.id, { cityId: zone.city_id, hourlyDepartures: new Array(24).fill(0), totalDepartures: 0 });
  }
  let processed = 0;
  let matched = 0;
  let skippedOutsideZones = 0;
  let skippedUnparseable = 0;

  function add(feature: TrajetFeature) {
    processed++;
    if (processed % PROGRESS_EVERY === 0) {
      console.log(`... ${processed.toLocaleString('fr-CA')} trajets traités`);
    }

    const origin = firstPoint(feature.geometry?.coordinates);
    const hour = departureHour(feature.properties?.starttime ?? '');
    if (!origin || hour === null) {
      skippedUnparseable++;
      return;
    }

    const [lng, lat] = origin;
    const match = nearestZone(lat, lng, zones);
    if (!match || match.distanceM > MAX_ZONE_DISTANCE_M) {
      skippedOutsideZones++;
      return;
    }

    const agg = byZone.get(match.zone.id);
    if (!agg) return; // unreachable: byZone is seeded from the same `zones` list nearestZone matches against
    agg.hourlyDepartures[hour] = (agg.hourlyDepartures[hour] ?? 0) + 1;
    agg.totalDepartures++;
    matched++;
  }

  function finish() {
    return { byZone, processed, matched, skippedOutsideZones, skippedUnparseable };
  }

  return { add, finish };
}

async function streamZipEntry(zipPath: string, entryNameSuffix: string) {
  const zipfile = await new Promise<import('yauzl').ZipFile>((resolve, reject) => {
    openZip(zipPath, { lazyEntries: true, autoClose: true }, (err, zf) => (err ? reject(err) : resolve(zf)));
  });

  for await (const entry of zipfile.eachEntry()) {
    if (!entry.fileName.endsWith(entryNameSuffix)) continue;
    return await new Promise<import('node:stream').Readable>((resolve, reject) => {
      zipfile.openReadStream(entry, (err, stream) => (err ? reject(err) : resolve(stream)));
    });
  }
  throw new Error(`Aucune entrée *${entryNameSuffix} trouvée dans ${zipPath}`);
}

async function main() {
  const zipPath = process.argv[2] ?? DEFAULT_ZIP_PATH;

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis (voir .env.local)');
  }
  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

  const { data: zones, error } = await supabase
    .from('zones')
    .select('id, city_id, latitude, longitude');
  if (error) throw error;
  if (!zones || zones.length === 0) throw new Error('Aucune zone trouvée dans public.zones');

  console.log(`Ouverture de ${zipPath}...`);
  const entryStream = await streamZipEntry(zipPath, '.geojson');

  const { add, finish } = makeAggregator(zones);
  const pipeline = chain([entryStream, parser(), pick({ filter: 'features' }), streamArray()]);

  await new Promise<void>((resolve, reject) => {
    pipeline.on('data', ({ value }: { value: TrajetFeature }) => add(value));
    pipeline.on('error', reject);
    pipeline.on('end', resolve);
  });

  const { byZone, processed, matched, skippedOutsideZones, skippedUnparseable } = finish();

  const output = {
    generatedAt: new Date().toISOString(),
    sourceFile: zipPath,
    maxZoneDistanceM: MAX_ZONE_DISTANCE_M,
    totalFeaturesProcessed: processed,
    totalMatchedToZone: matched,
    skippedOutsideZones,
    skippedUnparseable,
    zones: Object.fromEntries(byZone),
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  console.log(
    `${matched.toLocaleString('fr-CA')}/${processed.toLocaleString('fr-CA')} trajets mappés → src/data/zoneDemandWeights.json ` +
      `(${skippedOutsideZones} hors zone, ${skippedUnparseable} non-parsables)`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
