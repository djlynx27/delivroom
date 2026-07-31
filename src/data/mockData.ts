import type { City, TimeSlot, Zone, ZoneType } from '@/types/models';

export const CITIES: City[] = [
  { id: 'mtl', name: 'Montréal' },
  { id: 'lvl', name: 'Laval' },
  { id: 'lng', name: 'Longueuil' },
  { id: 'bsb', name: 'Boisbriand' },
  { id: 'sth', name: 'Sainte-Thérèse' },
  { id: 'blv', name: 'Blainville' },
  { id: 'rsm', name: 'Rosemère' },
  { id: 'trb', name: 'Terrebonne' },
];

// ─── Zones extraites du fichier "zones bubble.csv" + enrichies ───────────────
export const ZONES: Zone[] = [
  // ── Montréal ──────────────────────────────────────────────────────────────
  {
    id: 'mtl-yul',
    city_id: 'mtl',
    name: 'Aéroport Trudeau (YUL)',
    type: 'aéroport',
    latitude: 45.4706,
    longitude: -73.7408,
  },
  {
    id: 'mtl-gc',
    city_id: 'mtl',
    name: 'Gare Centrale',
    type: 'transport',
    latitude: 45.4994,
    longitude: -73.5685,
  },
  {
    id: 'mtl-bq',
    city_id: 'mtl',
    name: 'Station Berri-UQAM',
    type: 'métro',
    latitude: 45.5163,
    longitude: -73.5694,
  },
  {
    id: 'mtl-ll',
    city_id: 'mtl',
    name: 'Station Lionel-Groulx',
    type: 'métro',
    latitude: 45.4734,
    longitude: -73.5773,
  },
  {
    id: 'mtl-jt',
    city_id: 'mtl',
    name: 'Station Jean-Talon',
    type: 'métro',
    latitude: 45.5353,
    longitude: -73.6238,
  },
  {
    id: 'mtl-cv',
    city_id: 'mtl',
    name: 'Station Côte-Vertu',
    type: 'métro',
    latitude: 45.5058,
    longitude: -73.7438,
  },
  {
    id: 'mtl-qs',
    city_id: 'mtl',
    name: 'Quartier des spectacles',
    type: 'nightlife',
    latitude: 45.5088,
    longitude: -73.5603,
  },
  {
    id: 'mtl-cs',
    city_id: 'mtl',
    name: 'Crescent Sainte-Catherine',
    type: 'nightlife',
    latitude: 45.4985,
    longitude: -73.5795,
  },
  {
    id: 'mtl-vp',
    city_id: 'mtl',
    name: 'Vieux-Port de Montréal',
    type: 'tourisme',
    latitude: 45.5088,
    longitude: -73.554,
  },
  {
    id: 'mtl-cb',
    city_id: 'mtl',
    name: 'Centre Bell',
    type: 'événements',
    latitude: 45.496,
    longitude: -73.5694,
  },
  {
    id: 'mtl-so',
    city_id: 'mtl',
    name: 'Stade olympique',
    type: 'événements',
    latitude: 45.5597,
    longitude: -73.5515,
  },
  {
    id: 'mtl-rk',
    city_id: 'mtl',
    name: 'Centre commercial Rockland',
    type: 'commercial',
    latitude: 45.4942,
    longitude: -73.662,
  },
  {
    id: 'mtl-mj',
    city_id: 'mtl',
    name: 'Marché Jean-Talon',
    type: 'commercial',
    latitude: 45.5349,
    longitude: -73.6148,
  },
  {
    id: 'mtl-ch',
    city_id: 'mtl',
    name: 'CHUM Hôpital',
    type: 'médical',
    latitude: 45.511,
    longitude: -73.556,
  },
  {
    id: 'mtl-mg',
    city_id: 'mtl',
    name: 'Université McGill',
    type: 'université',
    latitude: 45.5048,
    longitude: -73.5772,
  },
  {
    id: 'mtl-uq',
    city_id: 'mtl',
    name: 'UQAM',
    type: 'université',
    latitude: 45.5094,
    longitude: -73.5688,
  },
  {
    id: 'mtl-ph',
    city_id: 'mtl',
    name: 'Plaza Saint-Hubert',
    type: 'commercial',
    latitude: 45.5402,
    longitude: -73.5845,
  },
  {
    id: 'mtl-mr',
    city_id: 'mtl',
    name: 'Avenue Mont-Royal',
    type: 'résidentiel',
    latitude: 45.5268,
    longitude: -73.585,
  },
  {
    id: 'mtl-ca',
    city_id: 'mtl',
    name: 'Casino de Montréal',
    type: 'nightlife',
    latitude: 45.5095,
    longitude: -73.5296,
  },
  // ── Laval ─────────────────────────────────────────────────────────────────
  {
    id: 'lvl-mm',
    city_id: 'lvl',
    name: 'Station Montmorency',
    type: 'métro',
    latitude: 45.5585,
    longitude: -73.7114,
  },
  {
    id: 'lvl-ct',
    city_id: 'lvl',
    name: 'Station Cartier',
    type: 'métro',
    latitude: 45.5503,
    longitude: -73.7006,
  },
  {
    id: 'lvl-dc',
    city_id: 'lvl',
    name: 'Station De La Concorde',
    type: 'métro',
    latitude: 45.5446,
    longitude: -73.6936,
  },
  {
    id: 'lvl-cl',
    city_id: 'lvl',
    name: 'Carrefour Laval',
    type: 'commercial',
    latitude: 45.5578,
    longitude: -73.7453,
  },
  {
    id: 'lvl-cp',
    city_id: 'lvl',
    name: 'Centropolis Laval',
    type: 'nightlife',
    latitude: 45.5572,
    longitude: -73.7468,
  },
  {
    id: 'lvl-pl',
    city_id: 'lvl',
    name: 'Place Laval',
    type: 'commercial',
    latitude: 45.5422,
    longitude: -73.7167,
  },
  {
    id: 'lvl-hp',
    city_id: 'lvl',
    name: 'Hôpital Cité-de-la-Santé',
    type: 'médical',
    latitude: 45.5535,
    longitude: -73.7528,
  },
  {
    id: 'lvl-cm',
    city_id: 'lvl',
    name: 'Cégep Montmorency',
    type: 'université',
    latitude: 45.5592,
    longitude: -73.7118,
  },
  {
    id: 'lvl-um',
    city_id: 'lvl',
    name: 'Université de Montréal Laval',
    type: 'université',
    latitude: 45.5718,
    longitude: -73.735,
  },
  {
    id: 'lvl-gs',
    city_id: 'lvl',
    name: 'Gare Sainte-Rose',
    type: 'transport',
    latitude: 45.6049,
    longitude: -73.7698,
  },
  {
    id: 'lvl-pb',
    city_id: 'lvl',
    name: 'Place Bell',
    type: 'événements',
    latitude: 45.5569,
    longitude: -73.7465,
  },
  // ── Longueuil ─────────────────────────────────────────────────────────────
  {
    id: 'lng-us',
    city_id: 'lng',
    name: 'Station Longueuil U. Sherbrooke',
    type: 'métro',
    latitude: 45.5252,
    longitude: -73.5205,
  },
  {
    id: 'lng-tl',
    city_id: 'lng',
    name: 'Terminus Longueuil',
    type: 'transport',
    latitude: 45.5254,
    longitude: -73.5198,
  },
  {
    id: 'lng-mc',
    city_id: 'lng',
    name: 'Mail Champlain',
    type: 'commercial',
    latitude: 45.5001,
    longitude: -73.4998,
  },
  {
    id: 'lng-pl',
    city_id: 'lng',
    name: 'Place Longueuil',
    type: 'commercial',
    latitude: 45.5255,
    longitude: -73.5176,
  },
  {
    id: 'lng-hc',
    city_id: 'lng',
    name: 'Hôpital Charles-Le Moyne',
    type: 'médical',
    latitude: 45.5223,
    longitude: -73.5068,
  },
  {
    id: 'lng-vl',
    city_id: 'lng',
    name: 'Vieux-Longueuil',
    type: 'résidentiel',
    latitude: 45.5311,
    longitude: -73.5066,
  },
  {
    id: 'lng-em',
    city_id: 'lng',
    name: 'Cégep Édouard-Montpetit',
    type: 'université',
    latitude: 45.4991,
    longitude: -73.5053,
  },
  {
    id: 'lng-us2',
    city_id: 'lng',
    name: 'Université de Sherbrooke Longueuil',
    type: 'université',
    latitude: 45.4998,
    longitude: -73.5045,
  },
  {
    id: 'lng-psb',
    city_id: 'lng',
    name: 'Promenades Saint-Bruno',
    type: 'commercial',
    latitude: 45.5311,
    longitude: -73.3581,
  },
  {
    id: 'lng-rem',
    city_id: 'lng',
    name: 'Gare Brossard REM',
    type: 'transport',
    latitude: 45.4582,
    longitude: -73.4718,
  },
  // ── Boisbriand ────────────────────────────────────────────────────────────
  {
    id: 'bsb-gb',
    city_id: 'bsb',
    name: 'Gare Boisbriand exo',
    type: 'transport',
    latitude: 45.6202,
    longitude: -73.8428,
  },
  {
    id: 'bsb-cn',
    city_id: 'bsb',
    name: 'Carrefour du Nord',
    type: 'commercial',
    latitude: 45.6234,
    longitude: -73.8396,
  },
  {
    id: 'bsb-pb',
    city_id: 'bsb',
    name: 'Promenades de Boisbriand',
    type: 'commercial',
    latitude: 45.6281,
    longitude: -73.8494,
  },
  // ── Sainte-Thérèse ────────────────────────────────────────────────────────
  {
    id: 'sth-gs',
    city_id: 'sth',
    name: 'Gare Sainte-Thérèse exo',
    type: 'transport',
    latitude: 45.6435,
    longitude: -73.8284,
  },
  {
    id: 'sth-cv',
    city_id: 'sth',
    name: 'Centre-ville Sainte-Thérèse',
    type: 'résidentiel',
    latitude: 45.6422,
    longitude: -73.8295,
  },
  {
    id: 'sth-cl',
    city_id: 'sth',
    name: 'Cégep Lionel-Groulx',
    type: 'université',
    latitude: 45.6462,
    longitude: -73.8408,
  },
  {
    id: 'sth-gal',
    city_id: 'sth',
    name: 'Galeries Sainte-Thérèse',
    type: 'commercial',
    latitude: 45.638,
    longitude: -73.8248,
  },
  // ── Blainville ────────────────────────────────────────────────────────────
  {
    id: 'blv-gb',
    city_id: 'blv',
    name: 'Gare Blainville exo',
    type: 'transport',
    latitude: 45.6784,
    longitude: -73.8648,
  },
  {
    id: 'blv-cs',
    city_id: 'blv',
    name: 'Complexe sportif de Blainville',
    type: 'événements',
    latitude: 45.6715,
    longitude: -73.8878,
  },
  {
    id: 'blv-cc',
    city_id: 'blv',
    name: 'Centre commercial Blainville',
    type: 'commercial',
    latitude: 45.675,
    longitude: -73.8779,
  },
  {
    id: 'blv-cv',
    city_id: 'blv',
    name: 'Centre-ville Blainville',
    type: 'résidentiel',
    latitude: 45.67,
    longitude: -73.8649,
  },
  // ── Rosemère ──────────────────────────────────────────────────────────────
  {
    id: 'rsm-pr',
    city_id: 'rsm',
    name: 'Place Rosemère',
    type: 'commercial',
    latitude: 45.6365,
    longitude: -73.7993,
  },
  {
    id: 'rsm-cv',
    city_id: 'rsm',
    name: 'Centre-ville Rosemère',
    type: 'résidentiel',
    latitude: 45.639,
    longitude: -73.795,
  },
  {
    id: 'rsm-gr',
    city_id: 'rsm',
    name: 'Gare Rosemère (Ste-Rose)',
    type: 'transport',
    latitude: 45.625,
    longitude: -73.7643,
  },
  // ── Terrebonne ────────────────────────────────────────────────────────────
  {
    id: 'trb-cl',
    city_id: 'trb',
    name: 'Carrefour des Laurentides',
    type: 'commercial',
    latitude: 45.704,
    longitude: -73.642,
  },
  {
    id: 'trb-vt',
    city_id: 'trb',
    name: 'Vieux-Terrebonne',
    type: 'tourisme',
    latitude: 45.7017,
    longitude: -73.6449,
  },
  {
    id: 'trb-gt',
    city_id: 'trb',
    name: 'Gare Terrebonne exo',
    type: 'transport',
    latitude: 45.7033,
    longitude: -73.6367,
  },
  {
    id: 'trb-ct',
    city_id: 'trb',
    name: 'Cégep de Terrebonne',
    type: 'université',
    latitude: 45.6942,
    longitude: -73.6449,
  },
  {
    id: 'trb-hp',
    city_id: 'trb',
    name: 'Hôpital Pierre-Le Gardeur',
    type: 'médical',
    latitude: 45.7248,
    longitude: -73.48,
  },
];

export function generateSimulatedSlots(
  cityId: string,
  date: string
): TimeSlot[] {
  const cityZones = ZONES.filter((z) => z.city_id === cityId);
  const slots: TimeSlot[] = [];
  let slotIndex = 0;

  for (let hour = 6; hour < 30; hour++) {
    for (let min = 0; min < 60; min += 15) {
      const h = hour % 24;
      const startTime = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      const endMin = min + 15;
      const endH = endMin >= 60 ? (h + 1) % 24 : h;
      const endM = endMin % 60;
      const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

      const zone = cityZones[slotIndex % cityZones.length];
      const score = generateDemandScore(h, zone.type);

      slots.push({
        id: `ts-${cityId}-${date}-${slotIndex}`,
        date,
        start_time: startTime,
        end_time: endTime,
        city_id: cityId,
        zone_id: zone.id,
        demand_score: score,
        comment: '',
      });
      slotIndex++;
    }
  }
  return slots;
}

function generateDemandScore(hour: number, zoneType: ZoneType): number {
  let base = 30 + Math.floor(Math.random() * 20);

  // Rush hours
  if ((hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 18)) base += 30;
  // Late night
  if (hour >= 22 || hour <= 2) {
    if (zoneType === 'nightlife') base += 40;
    else if (zoneType === 'aéroport') base += 20;
    else base -= 10;
  }
  // Morning airport
  if (hour >= 4 && hour <= 7 && zoneType === 'aéroport') base += 35;
  // Events evening
  if (hour >= 18 && hour <= 23 && zoneType === 'événements') base += 30;
  // University weekday
  if (hour >= 8 && hour <= 17 && zoneType === 'université') base += 20;
  // Hospital always decent
  if (zoneType === 'médical') base += 10;

  return Math.max(0, Math.min(100, base));
}
