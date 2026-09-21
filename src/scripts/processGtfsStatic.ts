// Étape 3 du pipeline d'ingestion transport : parse les archives GTFS
// statiques (stops.txt/agency.txt) de la Ville de Montréal / exo pour
// extraire les gares et terminus majeurs, les mapper aux 66 zones
// Delivroom, et générer src/data/gtfsStops.ts — la table de référence
// stop_id -> zone_id que gtfs-alerts-sync (Edge Function Chrono SAEIV)
// pourra utiliser pour attribuer une alerte à une zone sans dépendre du
// text-matching sur le nom du terminus.
//
// Seules les agences du périmètre Delivroom sont traitées (TARGET_AGENCY_IDS
// ci-dessous) — tout fichier dont l'agency_id n'y figure pas est ignoré
// (Rimouski/Sherbrooke n'existent même pas en tant que .zip GTFS dans ce
// dataset : ce sont des .json "CitéBus" à part, donc déjà hors scope par le
// simple filtre "fichiers .zip avec agency.txt").
//
// Node-only script (run via `tsx`, jamais bundlé par Vite) — voir la note
// dans seedSyntheticTrips.ts sur pourquoi ce fichier a sa propre référence
// node plutôt qu'un tsconfig élargi.
/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fromBuffer as zipFromBuffer } from 'yauzl';
import type { Database } from '../integrations/supabase/types';
import { nearestZone, type ZoneRow } from './lib/geo';

const DEFAULT_DATASET_DIR = 'D:/Documents/Transport Dataset';
const OUTPUT_PATH = new URL('../data/gtfsStops.ts', import.meta.url);
const MAX_ZONE_DISTANCE_M = 2000;

// Exo trains (exo1-6 sont des lignes à l'intérieur de ce seul agency_id),
// CITLA (Laurentides), MRCLM (Terrebonne-Mascouche), RTL (Longueuil),
// LRRS (Le Richelain / Roussillon), CITCRC (Chambly-Richelieu-Carignan).
const TARGET_AGENCY_IDS = new Set(['TRAINS', 'CITLA', 'MRCLM', 'RTL', 'LRRS', 'CITCRC']);

// Some exo GTFS exports carry stray trailing byte(s) after the ZIP's
// end-of-central-directory record (verified on google_transit(11).zip/LRRS:
// the EOCD's comment-length field says 0 but 1 extra byte follows it).
// yauzl validates this strictly and throws "Invalid comment length";
// Python's zipfile tolerates it silently. Rather than skip an entire
// target agency over one stray byte, locate the EOCD signature from the
// end and trim the buffer to its declared length before handing it to
// yauzl.
function repairTrailingGarbage(buf: Buffer): Buffer {
  const EOCD_SIG = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocdOffset = buf.lastIndexOf(EOCD_SIG);
  if (eocdOffset === -1) return buf; // not a recognizable zip at all — let yauzl report the real error
  const commentLen = buf.readUInt16LE(eocdOffset + 20);
  const expectedLength = eocdOffset + 22 + commentLen;
  return expectedLength < buf.length ? buf.subarray(0, expectedLength) : buf;
}

async function readZipTextEntries(
  zipPath: string,
  wanted: ReadonlySet<string>
): Promise<Map<string, string>> {
  const buf = repairTrailingGarbage(readFileSync(zipPath));
  const zipfile = await new Promise<import('yauzl').ZipFile>((resolve, reject) => {
    zipFromBuffer(buf, { lazyEntries: true, autoClose: true }, (err, zf) => (err ? reject(err) : resolve(zf)));
  });

  const result = new Map<string, string>();
  for await (const entry of zipfile.eachEntry()) {
    if (!wanted.has(entry.fileName)) continue;
    const stream = await new Promise<import('node:stream').Readable>((resolve, reject) => {
      zipfile.openReadStream(entry, (err, s) => (err ? reject(err) : resolve(s)));
    });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    // Verified byte-for-byte against every target zip: all are genuine
    // UTF-8 (zero raw 0xE9 bytes; every accented char is a proper 2-byte
    // UTF-8 sequence) — this is Node's toString() default, spelled out
    // explicitly since an earlier (wrong) assumption here was Latin-1.
    result.set(entry.fileName, Buffer.concat(chunks).toString('utf-8'));
  }
  return result;
}

// Minimal CSV parser — safe here because every target feed's stops.txt has
// no quoted/embedded-comma fields (verified against the actual files this
// script targets). A generic CSV library would be overkill for a plain
// comma-split.
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.length > 0);
  const headerLine = lines[0];
  if (headerLine === undefined) return [];
  const headers = headerLine.split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

// A real terminus/gare stop_name always STARTS with "Terminus"/"Gare" in
// these feeds. Merely containing the word doesn't work: bus-stop names like
// "de la Grande-Côte / devant la gare Rosemère" or "Saint-Pierre / Gare
// Saint-Constant" reference a nearby terminus without being it — verified
// against every target agency's stops.txt.
const MAJOR_STOP_PATTERN = /^\s*(terminus|gare)\b/i;

// Quais/portes of the same physical terminus are separate stop_ids with
// near-identical names ("Terminus Sainte-Thérèse - Quai 5", "... - Quai 7",
// "Terminus Longueuil Porte C23") — strip the suffix to group them under
// one canonical station name before averaging their coordinates.
function canonicalStopName(name: string): string {
  // Quai labels are numeric ("Quai 12"), lettered ("Quai E"), or "Quai taxi"
  // (verified: Terminus Saint-Jérôme uses letters C, E-J while most others
  // use numbers) — accept any alphanumeric identifier, not just digits.
  return name.replace(/\s*-?\s*(quai(\s+taxi)?\s*\w*|porte\s+\w+)\s*$/i, '').trim();
}

interface RawStop {
  stopId: string;
  name: string;
  latitude: number;
  longitude: number;
}

function parseAgencyId(agencyCsv: string | undefined): string | null {
  if (!agencyCsv) return null;
  const rows = parseCsv(agencyCsv);
  return rows[0]?.agency_id ?? null;
}

function parseMajorStops(stopsCsv: string): RawStop[] {
  return parseCsv(stopsCsv)
    .filter((row) => MAJOR_STOP_PATTERN.test(row.stop_name ?? ''))
    .flatMap((row): RawStop[] => {
      if (!row.stop_id || !row.stop_name) return [];
      return [
        {
          stopId: row.stop_id,
          name: row.stop_name,
          latitude: Number.parseFloat(row.stop_lat ?? ''),
          longitude: Number.parseFloat(row.stop_lon ?? ''),
        },
      ];
    })
    .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
}

interface GtfsStopRow {
  stopId: string;
  /** Every raw GTFS stop_id folded into this canonical station (all quais/
   *  portes) — this is what a real-time alert's informedEntity.stopId
   *  actually references, not the single representative `stopId` above. */
  stopIds: string[];
  name: string;
  agencyId: string;
  latitude: number;
  longitude: number;
  zoneId: string | null;
  cityId: string | null;
  distanceToZoneM: number | null;
}

function groupAndMapStops(agencyId: string, stops: readonly RawStop[], zones: readonly ZoneRow[]): GtfsStopRow[] {
  const byCanonicalName = new Map<string, RawStop[]>();
  for (const stop of stops) {
    const key = canonicalStopName(stop.name);
    const group = byCanonicalName.get(key) ?? [];
    group.push(stop);
    byCanonicalName.set(key, group);
  }

  const rows: GtfsStopRow[] = [];
  for (const [canonicalName, group] of byCanonicalName) {
    const latitude = group.reduce((sum, s) => sum + s.latitude, 0) / group.length;
    const longitude = group.reduce((sum, s) => sum + s.longitude, 0) / group.length;
    const match = nearestZone(latitude, longitude, zones);
    const inRange = match && match.distanceM <= MAX_ZONE_DISTANCE_M;

    // group is never empty: byCanonicalName only ever holds groups that
    // received at least one push (see the loop above).
    rows.push({
      stopId: group[0]!.stopId,
      stopIds: group.map((s) => s.stopId),
      name: canonicalName,
      agencyId,
      latitude,
      longitude,
      zoneId: inRange ? match!.zone.id : null,
      cityId: inRange ? match!.zone.city_id : null,
      distanceToZoneM: match ? Math.round(match.distanceM) : null,
    });
  }
  return rows;
}

async function processZipFile(
  datasetDir: string,
  file: string,
  zones: readonly ZoneRow[]
): Promise<{ agencyId: string | null; stops: GtfsStopRow[] }> {
  const entries = await readZipTextEntries(`${datasetDir}/${file}`, new Set(['agency.txt', 'stops.txt']));
  const agencyId = parseAgencyId(entries.get('agency.txt'));
  if (!agencyId || !TARGET_AGENCY_IDS.has(agencyId)) {
    return { agencyId, stops: [] };
  }

  const stopsCsv = entries.get('stops.txt');
  if (!stopsCsv) return { agencyId, stops: [] };

  const majorStops = parseMajorStops(stopsCsv);
  return { agencyId, stops: groupAndMapStops(agencyId, majorStops, zones) };
}

async function collectStops(
  datasetDir: string,
  zones: readonly ZoneRow[]
): Promise<{ allStops: GtfsStopRow[]; seenAgencyIds: Set<string>; skippedCount: number }> {
  const zipFiles = readdirSync(datasetDir).filter((f) => f.toLowerCase().endsWith('.zip'));

  const allStops: GtfsStopRow[] = [];
  const seenAgencyIds = new Set<string>();
  let skippedCount = 0;

  for (const file of zipFiles) {
    const { agencyId, stops } = await processZipFile(datasetDir, file, zones);
    if (!agencyId || !TARGET_AGENCY_IDS.has(agencyId)) {
      skippedCount++;
      continue;
    }
    seenAgencyIds.add(agencyId);
    allStops.push(...stops);
  }

  return { allStops, seenAgencyIds, skippedCount };
}

function buildOutput(
  datasetDir: string,
  allStops: readonly GtfsStopRow[],
  seenAgencyIds: ReadonlySet<string>
): string {
  const missingAgencies = [...TARGET_AGENCY_IDS].filter((id) => !seenAgencyIds.has(id));
  const unmatched = allStops.filter((s) => s.zoneId === null).length;

  return `// Généré par \`tsx src/scripts/processGtfsStatic.ts\` depuis les archives
// GTFS statiques exo/RTL dans ${datasetDir}. Ne pas éditer à la main —
// re-lancer le script pour rafraîchir. ${allStops.length} gares/terminus
// majeurs, ${allStops.length - unmatched} mappés à une zone (seuil
// ${MAX_ZONE_DISTANCE_M}m), ${unmatched} hors territoire.
// Agences traitées: ${[...seenAgencyIds].sort().join(', ')}.${
    missingAgencies.length > 0
      ? `\n// [À VÉRIFIER] agences ciblées absentes du dataset: ${missingAgencies.join(', ')}.`
      : ''
  }
export type GtfsStop = {
  stopId: string
  stopIds: string[]
  name: string
  agencyId: string
  latitude: number
  longitude: number
  zoneId: string | null
  cityId: string | null
  distanceToZoneM: number | null
}

export const GTFS_STOPS: readonly GtfsStop[] = ${JSON.stringify(allStops, null, 2)} as const
`;
}

async function main() {
  const datasetDir = process.argv[2] ?? DEFAULT_DATASET_DIR;

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis (voir .env.local)');
  }
  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);
  const { data: zones, error } = await supabase.from('zones').select('id, city_id, latitude, longitude');
  if (error) throw error;
  if (!zones || zones.length === 0) throw new Error('Aucune zone trouvée dans public.zones');

  const { allStops, seenAgencyIds, skippedCount } = await collectStops(datasetDir, zones);
  const missingAgencies = [...TARGET_AGENCY_IDS].filter((id) => !seenAgencyIds.has(id));
  const unmatched = allStops.filter((s) => s.zoneId === null).length;

  writeFileSync(OUTPUT_PATH, buildOutput(datasetDir, allStops, seenAgencyIds));

  console.log(`${allStops.length} gares/terminus majeurs → src/data/gtfsStops.ts`);
  console.log(`  mappés à une zone: ${allStops.length - unmatched}, hors territoire: ${unmatched}`);
  console.log(`  agences traitées: ${[...seenAgencyIds].sort().join(', ')}`);
  if (missingAgencies.length > 0) {
    console.log(`  [À VÉRIFIER] agences ciblées absentes du dataset: ${missingAgencies.join(', ')}`);
  }
  console.log(`  fichiers ignorés (hors périmètre): ${skippedCount}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
