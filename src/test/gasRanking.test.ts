import { describe, expect, it } from 'vitest';
import type { OpenStatus } from '@/lib/gasHours';
import {
  buildGasBoard,
  candidatesNeedingHours,
  cityFromAddress,
  cityKeyOf,
  detectUserCityKey,
  formatGasPriceFreshness,
  groupByCity,
  MIN_CITY_STATIONS,
  OTHER_CITIES_COUNT,
  selectOtherCityGroups,
  toRankedStations,
  type GasStation,
  type RankedStation,
} from '@/lib/gasRanking';

const OPEN: OpenStatus = {
  state: 'open',
  alwaysOpen: true,
  minutesUntilClose: null,
  minutesUntilOpen: null,
  closesAt: null,
  opensAt: null,
};
const CLOSED: OpenStatus = { ...OPEN, state: 'closed', alwaysOpen: false };
const UNKNOWN: OpenStatus = { ...OPEN, state: 'unknown', alwaysOpen: false };

// Repères réels : Laval ≈ 45.57/-73.72, Montréal ≈ 45.51/-73.57,
// Longueuil ≈ 45.53/-73.51, Terrebonne ≈ 45.70/-73.65.
function station(
  brand: string,
  city: string,
  lat: number,
  lng: number,
  regular: number
): GasStation {
  return {
    name: brand,
    brand,
    address: `1 rue Test, ${city}`,
    city,
    lat,
    lng,
    regular,
    super: regular + 0.2,
    diesel: regular + 0.1,
  };
}

const LAVAL_USER = { lat: 45.5586, lng: -73.7192 };

const FLEET: GasStation[] = [
  // Laval — la plus proche de l'utilisateur mais pas la moins chère.
  station('Shell', 'Laval', 45.5599, -73.7273, 1.629),
  // Laval — la moins chère de la ville, mais à l'autre bout.
  station('Costco', 'LAVAL', 45.5702, -73.7519, 1.529),
  station('Esso', 'Laval', 45.5645, -73.779, 1.699),
  // Montréal
  station('Petro-Canada', 'Montréal', 45.5111, -73.5647, 1.649),
  station('Ultramar', 'MONTRÉAL', 45.5048, -73.5772, 1.499),
  // Longueuil
  station('Crevier', 'Longueuil', 45.5312, -73.5181, 1.559),
  station('Harnois', 'Longueuil', 45.5243, -73.5215, 1.679),
  // Terrebonne — plus loin, ne doit pas passer devant Montréal/Longueuil.
  station('Sonic', 'Terrebonne', 45.7003, -73.6469, 1.459),
];

function rank(stations: GasStation[] = FLEET): RankedStation[] {
  return toRankedStations(stations, LAVAL_USER.lat, LAVAL_USER.lng, 'regular');
}

describe('cityFromAddress / cityKeyOf', () => {
  it('extrait la municipalité de l’adresse EQC', () => {
    expect(cityFromAddress('1454 boul. Le Corbusier, Laval')).toBe('Laval');
    expect(cityFromAddress('560 rue 6 ouest, Senneterre (ville & paroisse)')).toBe(
      'Senneterre'
    );
  });

  it('normalise casse et accents pour comparer les villes', () => {
    expect(cityKeyOf('LAVAL')).toBe(cityKeyOf('Laval'));
    expect(cityKeyOf('MONTRÉAL')).toBe(cityKeyOf('Montréal'));
    expect(cityKeyOf('Saint-Lin–Laurentides')).toBe(cityKeyOf('SAINT-LIN–LAURENTIDES'));
  });
});

describe('toRankedStations', () => {
  it('écarte les stations sans prix pour le carburant choisi', () => {
    const noDiesel: GasStation = { ...station('X', 'Laval', 45.56, -73.72, 1.6), diesel: null };
    const ranked = toRankedStations([noDiesel], LAVAL_USER.lat, LAVAL_USER.lng, 'diesel');
    expect(ranked).toHaveLength(0);
  });

  it('calcule distance et score de compromis', () => {
    const ranked = rank([FLEET[0]!]);
    expect(ranked[0]!.distance_km).toBeGreaterThan(0);
    expect(ranked[0]!.cost_score).toBeGreaterThan(ranked[0]!.price);
  });
});

describe('groupByCity', () => {
  it('fusionne les graphies et préfère un libellé lisible', () => {
    const groups = groupByCity(rank(), LAVAL_USER.lat, LAVAL_USER.lng);
    const laval = groups.find((g) => g.cityKey === 'laval');
    expect(laval?.stations).toHaveLength(3);
    expect(laval?.city).toBe('Laval');
    const mtl = groups.find((g) => g.cityKey === 'montreal');
    expect(mtl?.city).toBe('Montréal');
  });

  it('remet en casse lisible une ville qu’EQC ne publie qu’en majuscules', () => {
    const shouty = [
      station('Esso', 'SAINT-LIN–LAURENTIDES', 45.56, -73.72, 1.6),
      station('Shell', 'SAINT-LIN–LAURENTIDES', 45.561, -73.721, 1.7),
    ];
    const groups = groupByCity(
      toRankedStations(shouty, LAVAL_USER.lat, LAVAL_USER.lng, 'regular'),
      LAVAL_USER.lat,
      LAVAL_USER.lng
    );
    expect(groups[0]!.city).toBe('Saint-Lin–Laurentides');
  });

  it('trie les villes par proximité', () => {
    const groups = groupByCity(rank(), LAVAL_USER.lat, LAVAL_USER.lng);
    expect(groups.map((g) => g.cityKey)[0]).toBe('laval');
    expect(groups.map((g) => g.cityKey)).toContain('terrebonne');
    expect(groups.findIndex((g) => g.cityKey === 'montreal')).toBeLessThan(
      groups.findIndex((g) => g.cityKey === 'terrebonne')
    );
  });
});

describe('detectUserCityKey', () => {
  it('détecte Laval depuis une position lavalloise', () => {
    expect(detectUserCityKey(rank())).toBe('laval');
  });

  it('détecte Montréal depuis le centre-ville', () => {
    const ranked = toRankedStations(FLEET, 45.5088, -73.5678, 'regular');
    expect(detectUserCityKey(ranked)).toBe('montreal');
  });

  it('retourne null sans station', () => {
    expect(detectUserCityKey([])).toBeNull();
  });
});

describe('buildGasBoard', () => {
  const allOpen = () => OPEN;

  it('respecte l’ordre demandé : proche+pas cher, puis moins cher en ville, puis autres villes', () => {
    const board = buildGasBoard({
      stations: rank(),
      userLat: LAVAL_USER.lat,
      userLng: LAVAL_USER.lng,
      statusOf: allOpen,
    });

    expect(board.userCity).toBe('Laval');
    expect(board.slots[0]!.kind).toBe('nearest-cheapest');
    expect(board.slots[0]!.city).toBe('Laval');
    expect(board.slots[0]!.station.brand).toBe('Shell');

    expect(board.slots[1]!.kind).toBe('city-cheapest');
    expect(board.slots[1]!.city).toBe('Laval');
    expect(board.slots[1]!.station.brand).toBe('Costco');

    const others = board.slots.slice(2);
    expect(others.every((s) => s.kind === 'other-city-cheapest')).toBe(true);
    expect(others.map((s) => s.city)).toEqual(['Montréal', 'Longueuil', 'Terrebonne']);
    // Dans chaque autre ville, c'est bien le prix le plus bas.
    expect(others[0]!.station.brand).toBe('Ultramar');
    expect(others[1]!.station.brand).toBe('Crevier');
  });

  it('inverse l’ordre des villes quand on part de Montréal', () => {
    const ranked = toRankedStations(FLEET, 45.5088, -73.5678, 'regular');
    const board = buildGasBoard({
      stations: ranked,
      userLat: 45.5088,
      userLng: -73.5678,
      statusOf: allOpen,
    });
    expect(board.userCity).toBe('Montréal');
    expect(board.slots.slice(2).map((s) => s.city)).toEqual([
      'Longueuil',
      'Laval',
      'Terrebonne',
    ]);
  });

  it('n’affiche jamais une station confirmée fermée', () => {
    const statusOf = (s: RankedStation): OpenStatus =>
      s.brand === 'Costco' || s.brand === 'Shell' ? CLOSED : OPEN;

    const board = buildGasBoard({
      stations: rank(),
      userLat: LAVAL_USER.lat,
      userLng: LAVAL_USER.lng,
      statusOf,
    });

    const brands = [
      ...board.slots.map((s) => s.station.brand),
      ...board.nearbyRest.map((r) => r.station.brand),
    ];
    expect(brands).not.toContain('Costco');
    expect(brands).not.toContain('Shell');
    expect(board.slots[0]!.station.brand).toBe('Esso');
  });

  it('préfère une station ouverte à une station d’horaire inconnu, même moins chère', () => {
    const statusOf = (s: RankedStation): OpenStatus =>
      s.brand === 'Costco' ? UNKNOWN : OPEN;

    const board = buildGasBoard({
      stations: rank(),
      userLat: LAVAL_USER.lat,
      userLng: LAVAL_USER.lng,
      statusOf,
    });

    const citySlot = board.slots.find((s) => s.kind === 'city-cheapest');
    expect(citySlot?.station.brand).toBe('Esso');
    expect(citySlot?.status.state).toBe('open');
  });

  it('retombe sur une station d’horaire inconnu quand rien n’est confirmé ouvert', () => {
    const board = buildGasBoard({
      stations: rank(),
      userLat: LAVAL_USER.lat,
      userLng: LAVAL_USER.lng,
      statusOf: (s) => (s.cityKey === 'laval' ? UNKNOWN : OPEN),
    });

    expect(board.slots[0]!.status.state).toBe('unknown');
    expect(board.hasUnknownHours).toBe(true);
  });

  it('fusionne les deux premiers slots quand la plus proche est aussi la moins chère', () => {
    const onlyOne = [station('Shell', 'Laval', 45.5599, -73.7273, 1.629), FLEET[3]!];
    const board = buildGasBoard({
      stations: toRankedStations(onlyOne, LAVAL_USER.lat, LAVAL_USER.lng, 'regular'),
      userLat: LAVAL_USER.lat,
      userLng: LAVAL_USER.lng,
      statusOf: allOpen,
    });

    expect(board.slots[0]!.alsoCheapestInCity).toBe(true);
    expect(board.slots.filter((s) => s.kind === 'city-cheapest')).toHaveLength(0);
  });

  it('trie le reste de la liste par compromis prix/distance et exclut les fermées', () => {
    const crowded: GasStation[] = [
      ...FLEET,
      station('Sonic', 'Laval', 45.5601, -73.7250, 1.719),
      station('Harnois', 'Laval', 45.5610, -73.7300, 1.689),
      station('Crevier', 'Laval', 45.5620, -73.7350, 1.709),
      station('Ultramar', 'Laval', 45.5630, -73.7400, 1.759),
    ];
    const ranked = toRankedStations(crowded, LAVAL_USER.lat, LAVAL_USER.lng, 'regular');
    const board = buildGasBoard({
      stations: ranked,
      userLat: LAVAL_USER.lat,
      userLng: LAVAL_USER.lng,
      statusOf: (s) => (s.brand === 'Ultramar' && s.cityKey === 'laval' ? CLOSED : OPEN),
    });

    expect(board.nearbyRest.length).toBeGreaterThan(1);
    const scores = board.nearbyRest.map((r) => r.station.cost_score);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
    expect(board.nearbyRest.every((r) => r.status.state !== 'closed')).toBe(true);
  });

  it('ne répète jamais la même station dans deux slots', () => {
    const board = buildGasBoard({
      stations: rank(),
      userLat: LAVAL_USER.lat,
      userLng: LAVAL_USER.lng,
      statusOf: allOpen,
    });
    const keys = board.slots.map((s) => s.station.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('selectOtherCityGroups', () => {
  /** Enclave minuscule très proche + vraie ville un peu plus loin. */
  function fleetWithEnclave(): GasStation[] {
    const enclave = [station('Shell', 'Mont-Royal', 45.5177, -73.6518, 1.93)];
    const bigCity: GasStation[] = Array.from({ length: MIN_CITY_STATIONS }, (_, i) =>
      station('Esso', 'Montréal', 45.5111 + i * 0.001, -73.5647, 1.7 + i * 0.001)
    );
    return [
      station('Petro', 'Laval', 45.5599, -73.7273, 1.62),
      ...enclave,
      ...bigCity,
    ];
  }

  it('écarte les enclaves minuscules au profit des vraies villes', () => {
    const ranked = toRankedStations(
      fleetWithEnclave(),
      LAVAL_USER.lat,
      LAVAL_USER.lng,
      'regular'
    );
    const groups = groupByCity(ranked, LAVAL_USER.lat, LAVAL_USER.lng);
    // Mont-Royal est plus proche que Montréal…
    expect(groups.filter((g) => g.cityKey !== 'laval')[0]!.cityKey).toBe('mont-royal');
    // …mais c'est bien Montréal qui est proposée en destination.
    const selected = selectOtherCityGroups(groups, 'laval');
    expect(selected[0]!.cityKey).toBe('montreal');
  });

  it('retombe sur les villes les plus proches quand aucune n’atteint le seuil', () => {
    const groups = groupByCity(rank(), LAVAL_USER.lat, LAVAL_USER.lng);
    const selected = selectOtherCityGroups(groups, 'laval');
    expect(selected.map((g) => g.city)).toEqual(['Montréal', 'Longueuil', 'Terrebonne']);
  });

  it('ne propose jamais la ville courante ni plus de 3 villes', () => {
    const groups = groupByCity(rank(), LAVAL_USER.lat, LAVAL_USER.lng);
    const selected = selectOtherCityGroups(groups, 'laval');
    expect(selected.map((g) => g.cityKey)).not.toContain('laval');
    expect(selected.length).toBeLessThanOrEqual(OTHER_CITIES_COUNT);
  });
});

describe('candidatesNeedingHours', () => {
  it('reste borné et couvre toutes les villes des slots', () => {
    const candidates = candidatesNeedingHours(rank(), LAVAL_USER.lat, LAVAL_USER.lng);
    const cities = new Set(candidates.map((c) => c.cityKey));
    expect(cities).toContain('laval');
    expect(cities).toContain('montreal');
    expect(cities).toContain('longueuil');
    expect(candidates.length).toBeLessThanOrEqual(40);
    expect(new Set(candidates.map((c) => c.key)).size).toBe(candidates.length);
  });
});

describe('formatGasPriceFreshness', () => {
  const now = new Date('2026-08-29T18:00:00Z');

  it('reports under a minute as "à l’instant"', () => {
    expect(formatGasPriceFreshness(new Date('2026-08-29T17:59:40Z').toISOString(), now)).toBe(
      'à l’instant'
    );
  });

  it('reports minutes under an hour', () => {
    expect(formatGasPriceFreshness(new Date('2026-08-29T17:45:00Z').toISOString(), now)).toBe(
      'il y a 15 min'
    );
  });

  it('reports hours and remaining minutes past an hour', () => {
    expect(formatGasPriceFreshness(new Date('2026-08-29T15:52:00Z').toISOString(), now)).toBe(
      'il y a 2 h 8 min'
    );
  });

  it('drops the minutes when exactly on the hour', () => {
    expect(formatGasPriceFreshness(new Date('2026-08-29T16:00:00Z').toISOString(), now)).toBe(
      'il y a 2 h'
    );
  });
});
