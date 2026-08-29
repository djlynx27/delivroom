/**
 * Classement des stations-service de l'onglet Essence.
 *
 * Règles demandées (dans l'ordre d'affichage) :
 *   1. Dans MA ville : le meilleur compromis prix / distance (station ouverte)
 *   2. Dans MA ville : le moins cher en absolu, peu importe la distance
 *   3-5. Le moins cher en absolu dans chacune des 3 villes les plus proches
 *
 * Une station n'est jamais placée dans un slot si elle est confirmée fermée.
 * Les stations dont l'horaire est inconnu ne peuvent occuper un slot qu'en
 * dernier recours (aucune station confirmée ouverte parmi les candidates).
 */
import { haversineKm } from '@/hooks/useUserLocation';
import type { OpenStatus } from '@/lib/gasHours';

export type FuelKind = 'regular' | 'super' | 'diesel';

export interface GasStation {
  name: string;
  brand: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
  regular: number | null;
  super: number | null;
  diesel: number | null;
}

export interface RankedStation extends GasStation {
  key: string;
  price: number;
  distance_km: number;
  /** Prix + coût estimé du détour — plus bas = meilleur. */
  cost_score: number;
  cityKey: string;
}

export type SlotKind =
  | 'nearest-cheapest'
  | 'city-cheapest'
  | 'other-city-cheapest';

export interface GasSlot {
  kind: SlotKind;
  /** Nom de ville affichable. */
  city: string;
  cityKey: string;
  station: RankedStation;
  status: OpenStatus;
  /** Vrai quand le slot 1 est aussi le moins cher de la ville (slots fusionnés). */
  alsoCheapestInCity: boolean;
}

/** Surcoût carburant estimé du détour, en $/km parcouru. */
export const DETOUR_FUEL_COST_PER_KM = 0.18;
/** Rayon de recherche pour le compromis « proche + pas cher ». */
export const NEARBY_RADIUS_KM = 15;
/** Au-delà, une ville n'est plus proposée comme destination. */
export const MAX_CITY_DISTANCE_KM = 35;
/** Nombre de villes « autres » affichées après la ville courante. */
export const OTHER_CITIES_COUNT = 3;
/**
 * Nombre de stations qu'une ville doit compter pour être proposée comme
 * destination.
 *
 * Sans ce filtre, « les villes les plus proches » renvoie des enclaves
 * minuscules — depuis Laval on obtenait Mont-Royal (6 stations) et
 * Côte-Saint-Luc (1) avant Montréal, ce qui n'a aucun sens pour un
 * déplacement. Le nombre de stations est un bon proxy de la taille réelle :
 * ce seuil garde Montréal, Laval, Longueuil, Terrebonne… et écarte les
 * villes enclavées. Si trop peu de villes qualifient (secteur rural), on
 * complète avec les plus proches quelle que soit leur taille.
 */
export const MIN_CITY_STATIONS = 25;
/** Candidates par ville dont on va chercher l'horaire. */
export const CANDIDATES_PER_CITY = 8;

export function stationKey(s: { lat: number; lng: number }): string {
  return `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
}

/**
 * Clé de comparaison insensible à la casse et aux accents.
 * EQC publie indifféremment « Laval » et « LAVAL ».
 */
export function cityKeyOf(city: string): string {
  return city
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Extrait la ville d'une adresse EQC (« 1454 boul. X, Laval »). */
export function cityFromAddress(address: string): string {
  const tail = address.includes(',')
    ? address.slice(address.lastIndexOf(',') + 1)
    : address;
  return tail.replace(/\s*\(.*?\)\s*/g, '').trim();
}

/** Choisit la graphie la plus lisible parmi les variantes EQC (évite le TOUT-MAJUSCULE). */
function preferredCityLabel(variants: string[]): string {
  const mixed = variants.find((v) => v !== v.toUpperCase());
  if (mixed) return mixed;
  const upper = variants[0] ?? '';
  return upper
    .toLocaleLowerCase('fr-CA')
    .replace(/(^|[\s'\-–])([a-zà-ÿ])/g, (_, sep: string, c: string) => sep + c.toLocaleUpperCase('fr-CA'));
}

export interface CityGroup {
  cityKey: string;
  city: string;
  stations: RankedStation[];
  /** Distance utilisateur → centroïde des stations de la ville. */
  distance_km: number;
}

/** Normalise les stations brutes en stations classées pour un carburant donné. */
export function toRankedStations(
  stations: GasStation[],
  userLat: number,
  userLng: number,
  fuel: FuelKind
): RankedStation[] {
  const ranked: RankedStation[] = [];
  for (const s of stations) {
    const price = s[fuel];
    if (price == null || price <= 0) continue;
    const city = s.city || cityFromAddress(s.address);
    if (!city) continue;
    const distance_km = haversineKm(userLat, userLng, s.lat, s.lng);
    ranked.push({
      ...s,
      city,
      key: stationKey(s),
      price,
      distance_km,
      cost_score: price + distance_km * DETOUR_FUEL_COST_PER_KM,
      cityKey: cityKeyOf(city),
    });
  }
  return ranked;
}

/** Regroupe par ville et trie les villes par proximité du centroïde. */
export function groupByCity(
  stations: RankedStation[],
  userLat: number,
  userLng: number
): CityGroup[] {
  const buckets = new Map<string, RankedStation[]>();
  for (const s of stations) {
    const bucket = buckets.get(s.cityKey);
    if (bucket) bucket.push(s);
    else buckets.set(s.cityKey, [s]);
  }

  const groups: CityGroup[] = [];
  for (const [cityKey, list] of buckets) {
    const lat = list.reduce((acc, s) => acc + s.lat, 0) / list.length;
    const lng = list.reduce((acc, s) => acc + s.lng, 0) / list.length;
    groups.push({
      cityKey,
      city: preferredCityLabel(list.map((s) => s.city)),
      stations: list.slice().sort((a, b) => a.price - b.price),
      distance_km: haversineKm(userLat, userLng, lat, lng),
    });
  }

  return groups.sort((a, b) => a.distance_km - b.distance_km);
}

/**
 * Ville où se trouve l'utilisateur : vote pondéré par l'inverse de la distance
 * sur les stations les plus proches. Plus robuste qu'un simple « station la
 * plus proche » quand on roule près d'une limite municipale.
 */
export function detectUserCityKey(
  stations: RankedStation[],
  sampleSize = 7
): string | null {
  if (stations.length === 0) return null;
  const nearest = stations
    .slice()
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, sampleSize);

  const weights = new Map<string, number>();
  for (const s of nearest) {
    const weight = 1 / Math.max(s.distance_km, 0.2);
    weights.set(s.cityKey, (weights.get(s.cityKey) ?? 0) + weight);
  }

  let bestKey: string | null = null;
  let bestWeight = -1;
  for (const [key, weight] of weights) {
    if (weight > bestWeight) {
      bestWeight = weight;
      bestKey = key;
    }
  }
  return bestKey;
}

/**
 * Villes proposées en destination après la ville courante : les vraies villes
 * les plus proches d'abord, complétées par les plus proches tout court si le
 * seuil de taille en écarte trop.
 */
export function selectOtherCityGroups(
  groups: CityGroup[],
  userCityKey: string | null
): CityGroup[] {
  const eligible = groups.filter(
    (g) => g.cityKey !== userCityKey && g.distance_km <= MAX_CITY_DISTANCE_KM
  );
  const major = eligible.filter((g) => g.stations.length >= MIN_CITY_STATIONS);
  const selected = major.slice(0, OTHER_CITIES_COUNT);

  if (selected.length < OTHER_CITIES_COUNT) {
    // Les villes retenues au seuil restent devant : re-trier l'ensemble par
    // distance ferait remonter les enclaves qu'on vient justement d'écarter.
    // `eligible` est déjà trié par distance, donc les bouche-trous le sont aussi.
    const taken = new Set(selected.map((g) => g.cityKey));
    for (const group of eligible) {
      if (selected.length >= OTHER_CITIES_COUNT) break;
      if (taken.has(group.cityKey)) continue;
      selected.push(group);
      taken.add(group.cityKey);
    }
  }

  return selected;
}

/**
 * Stations dont il faut connaître l'horaire avant de pouvoir classer.
 * Volontairement borné : on ne résout pas 2400 stations, seulement les
 * candidates crédibles pour chaque slot.
 */
export function candidatesNeedingHours(
  stations: RankedStation[],
  userLat: number,
  userLng: number
): RankedStation[] {
  const groups = groupByCity(stations, userLat, userLng);
  const userCityKey = detectUserCityKey(stations);
  const userGroup = groups.find((g) => g.cityKey === userCityKey);
  const others = selectOtherCityGroups(groups, userCityKey);

  const picked = new Map<string, RankedStation>();
  const add = (s: RankedStation) => {
    if (!picked.has(s.key)) picked.set(s.key, s);
  };

  if (userGroup) {
    // Slot 1 : meilleur compromis prix/distance dans un rayon utile.
    userGroup.stations
      .filter((s) => s.distance_km <= NEARBY_RADIUS_KM)
      .sort((a, b) => a.cost_score - b.cost_score)
      .slice(0, CANDIDATES_PER_CITY)
      .forEach(add);
    // Slot 2 : moins cher en absolu dans la ville.
    userGroup.stations.slice(0, CANDIDATES_PER_CITY).forEach(add);
  }

  for (const group of others) {
    group.stations.slice(0, CANDIDATES_PER_CITY).forEach(add);
  }

  return [...picked.values()];
}

type StatusLookup = (station: RankedStation) => OpenStatus;

/**
 * Première station utilisable de la liste : une station confirmée ouverte
 * l'emporte toujours ; une station à l'horaire inconnu ne sert que de repli.
 */
function pickUsable(
  stations: RankedStation[],
  statusOf: StatusLookup,
  used: Set<string>
): { station: RankedStation; status: OpenStatus } | null {
  let fallback: { station: RankedStation; status: OpenStatus } | null = null;

  for (const station of stations) {
    if (used.has(station.key)) continue;
    const status = statusOf(station);
    if (status.state === 'open') return { station, status };
    if (status.state === 'unknown' && !fallback) fallback = { station, status };
  }

  return fallback;
}

export interface GasBoard {
  userCity: string | null;
  userCityKey: string | null;
  slots: GasSlot[];
  /** Reste de la liste dans la ville courante, triée par compromis prix/distance. */
  nearbyRest: Array<{ station: RankedStation; status: OpenStatus }>;
  /** Vrai si au moins un slot repose sur un horaire inconnu. */
  hasUnknownHours: boolean;
}

export function buildGasBoard(params: {
  stations: RankedStation[];
  userLat: number;
  userLng: number;
  statusOf: StatusLookup;
  restLimit?: number;
}): GasBoard {
  const { stations, userLat, userLng, statusOf, restLimit = 8 } = params;

  const groups = groupByCity(stations, userLat, userLng);
  const userCityKey = detectUserCityKey(stations);
  const userGroup = groups.find((g) => g.cityKey === userCityKey) ?? null;

  const slots: GasSlot[] = [];
  const used = new Set<string>();

  if (userGroup) {
    const byCompromise = userGroup.stations
      .filter((s) => s.distance_km <= NEARBY_RADIUS_KM)
      .slice()
      .sort((a, b) => a.cost_score - b.cost_score);

    const nearest = pickUsable(byCompromise, statusOf, used);
    if (nearest) {
      used.add(nearest.station.key);
      slots.push({
        kind: 'nearest-cheapest',
        city: userGroup.city,
        cityKey: userGroup.cityKey,
        station: nearest.station,
        status: nearest.status,
        alsoCheapestInCity: false,
      });
    }

    const cheapest = pickUsable(userGroup.stations, statusOf, used);
    if (cheapest) {
      used.add(cheapest.station.key);
      slots.push({
        kind: 'city-cheapest',
        city: userGroup.city,
        cityKey: userGroup.cityKey,
        station: cheapest.station,
        status: cheapest.status,
        alsoCheapestInCity: false,
      });
    } else if (nearest) {
      // Le compromis EST déjà le moins cher de la ville : on fusionne les slots.
      slots[0]!.alsoCheapestInCity = true;
    }
  }

  const others = selectOtherCityGroups(groups, userCityKey);

  for (const group of others) {
    const pick = pickUsable(group.stations, statusOf, used);
    if (!pick) continue;
    used.add(pick.station.key);
    slots.push({
      kind: 'other-city-cheapest',
      city: group.city,
      cityKey: group.cityKey,
      station: pick.station,
      status: pick.status,
      alsoCheapestInCity: false,
    });
  }

  const nearbyRest = (userGroup?.stations ?? [])
    .filter((s) => !used.has(s.key) && s.distance_km <= NEARBY_RADIUS_KM)
    .map((station) => ({ station, status: statusOf(station) }))
    .filter((entry) => entry.status.state !== 'closed')
    .sort((a, b) => a.station.cost_score - b.station.cost_score)
    .slice(0, restLimit);

  return {
    userCity: userGroup?.city ?? null,
    userCityKey,
    slots,
    nearbyRest,
    hasUnknownHours: slots.some((s) => s.status.state === 'unknown'),
  };
}
