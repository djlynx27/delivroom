// One-off admin script to provision a new zone (e.g. a hospital or CEGEP
// POI) with a neutral prior. See
// docs/superpowers/specs/2026-09-21-bayesian-exploration-and-temporal-zones-design.md.
//
// Deliberately inserts NO zone_beliefs row: a missing belief already means
// "default prior, max uncertainty" to computeExplorationBonus (see
// scoringEngine.ts), so the first real trip through this zone creates the
// belief naturally via learningEngine.ts's existing updateBayesianBelief
// path. No separate seeding mechanism needed.
//
// Usage:
//   tsx --env-file=.env.local src/scripts/addZone.ts \
//     --name "Hôpital Example" --lat 45.51 --lng -73.55 \
//     --type médical --city-id mtl [--territory mtl] \
//     [--temporal] [--window "days=1,2,3,4,5;start=14:30;end=16:30;mult=1.3"]
//
// --window may be repeated to add multiple active windows. Omit --window
// while passing --temporal to provision a temporal zone with no windows yet
// (always off-window-penalized until windows are added later via SQL).
//
// Node-only script (run via tsx, never bundled by Vite) — see
// seedSyntheticTrips.ts's identical header note on tsconfig.app.json.
/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';
import type { Database, Json } from '../integrations/supabase/types';

const VALID_ZONE_TYPES = [
  'métro',
  'commercial',
  'résidentiel',
  'nightlife',
  'aéroport',
  'transport',
  'médical',
  'université',
  'événements',
  'tourisme',
] as const;
type ZoneType = (typeof VALID_ZONE_TYPES)[number];

// Matches the generic BASE_SCORES fallback already used in scoringEngine.ts
// for any type with no explicit entry — a genuinely neutral starting point.
const NEUTRAL_SCORE = 40;

interface ActiveWindowInput {
  days: number[];
  startHour: number;
  startMin: number;
  endHour: number;
  endMin: number;
  weight_multiplier: number;
}

interface ParsedArgs {
  name: string;
  lat: number;
  lng: number;
  type: ZoneType;
  cityId: string;
  territory: string | null;
  temporal: boolean;
  windows: ActiveWindowInput[];
}

function isZoneType(value: string): value is ZoneType {
  return (VALID_ZONE_TYPES as readonly string[]).includes(value);
}

function slugify(cityId: string, name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  return `${cityId}-${base}`;
}

function parseTime(value: string): { hour: number; min: number } {
  const [hourStr, minStr] = value.split(':');
  const hour = Number(hourStr);
  const min = Number(minStr ?? '0');
  if (!Number.isInteger(hour) || !Number.isInteger(min)) {
    throw new Error(`Heure invalide dans --window: "${value}" (attendu HH:MM)`);
  }
  return { hour, min };
}

function parseWindowArg(raw: string): ActiveWindowInput {
  const fields = new Map(
    raw.split(';').map((pair) => {
      const [key, value] = pair.split('=');
      return [key?.trim(), value?.trim() ?? ''];
    })
  );
  const daysRaw = fields.get('days') ?? '';
  const days = daysRaw
    ? daysRaw.split(',').map((d) => Number(d.trim()))
    : [];
  const start = parseTime(fields.get('start') ?? '');
  const end = parseTime(fields.get('end') ?? '');
  const mult = Number(fields.get('mult') ?? '1.3');
  if (days.some((d) => Number.isNaN(d)) || Number.isNaN(mult)) {
    throw new Error(`--window malformé: "${raw}"`);
  }
  return {
    days,
    startHour: start.hour,
    startMin: start.min,
    endHour: end.hour,
    endMin: end.min,
    weight_multiplier: mult,
  };
}

function parseCoordinates(latRaw: string, lngRaw: string): { lat: number; lng: number } {
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    throw new Error('--lat/--lng doivent être des nombres.');
  }
  return { lat, lng };
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const getAll = (flag: string): string[] => {
    const values: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const value = args[i + 1];
      if (args[i] === flag && value) values.push(value);
    }
    return values;
  };

  const name = get('--name');
  const latRaw = get('--lat');
  const lngRaw = get('--lng');
  const typeRaw = get('--type');
  const cityId = get('--city-id');
  const territory = get('--territory') ?? null;
  const temporal = args.includes('--temporal');
  const windowArgs = getAll('--window');

  if (!name || !latRaw || !lngRaw || !typeRaw || !cityId) {
    console.error(
      'Usage: tsx src/scripts/addZone.ts --name <name> --lat <lat> --lng <lng> ' +
        '--type <type> --city-id <city> [--territory <territory>] [--temporal] ' +
        '[--window "days=1,2,3,4,5;start=14:30;end=16:30;mult=1.3"]'
    );
    console.error(`Types valides: ${VALID_ZONE_TYPES.join(', ')}`);
    process.exit(1);
  }
  if (!isZoneType(typeRaw)) {
    throw new Error(`Type de zone invalide: "${typeRaw}". Valides: ${VALID_ZONE_TYPES.join(', ')}`);
  }
  const { lat, lng } = parseCoordinates(latRaw, lngRaw);
  if (!temporal && windowArgs.length > 0) {
    throw new Error('--window nécessite --temporal.');
  }

  return {
    name,
    lat,
    lng,
    type: typeRaw,
    cityId,
    territory,
    temporal,
    windows: windowArgs.map(parseWindowArg),
  };
}

async function main(): Promise<void> {
  const parsed = parseArgs();

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

  const zoneId = slugify(parsed.cityId, parsed.name);

  const { error } = await supabase.from('zones').insert({
    id: zoneId,
    city_id: parsed.cityId,
    name: parsed.name,
    type: parsed.type,
    latitude: parsed.lat,
    longitude: parsed.lng,
    base_score: NEUTRAL_SCORE,
    current_score: NEUTRAL_SCORE,
    territory: parsed.territory,
    is_temporal: parsed.temporal,
    active_windows: parsed.windows as unknown as Json,
  });
  if (error) throw error;

  console.log(`[add-zone] zone "${parsed.name}" créée (id: ${zoneId}).`);
  if (parsed.temporal) {
    console.log(
      `[add-zone] temporelle, ${parsed.windows.length} fenêtre(s) active(s).`
    );
  }
  console.log(
    '[add-zone] aucun prior zone_beliefs pré-seedé -- la première vraie ' +
      'course dans cette zone créera la croyance Bayésienne.'
  );
}

main().catch((err) => {
  console.error('[add-zone] échec:', err instanceof Error ? err.message : err);
  process.exit(1);
});
