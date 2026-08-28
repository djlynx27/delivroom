// Curated 24/7 driver pit-stops (restrooms) for the Market Radar map layer.
// Same hand-curated-list pattern as hotspots.ts. Gas isn't listed here --
// the Pit-Stop layer sources "best price nearby" live from useGasBoard
// (lib/gasRanking.ts) instead of a static list, since prices move daily.

export interface PitStop {
  id: string;
  name: string;
  category: 'restroom';
  latitude: number;
  longitude: number;
}

export const PIT_STOPS: PitStop[] = [
  {
    id: 'pitstop-halte-a40-vaudreuil',
    name: 'Halte routière A-40 (Vaudreuil-Dorion)',
    category: 'restroom',
    latitude: 45.3985,
    longitude: -74.0193,
  },
  {
    id: 'pitstop-halte-a20-st-augustin',
    name: 'Halte routière A-20 (Saint-Augustin)',
    category: 'restroom',
    latitude: 46.7448,
    longitude: -71.4453,
  },
  {
    id: 'pitstop-tim-hortons-decarie',
    name: 'Tim Hortons Décarie (24h)',
    category: 'restroom',
    latitude: 45.4784,
    longitude: -73.6644,
  },
  {
    id: 'pitstop-mcdo-champlain',
    name: "McDonald's Pont Champlain (24h)",
    category: 'restroom',
    latitude: 45.4645,
    longitude: -73.5407,
  },
  {
    id: 'pitstop-tim-hortons-laval-carrefour',
    name: 'Tim Hortons Carrefour Laval (24h)',
    category: 'restroom',
    latitude: 45.5761,
    longitude: -73.7486,
  },
  {
    id: 'pitstop-mcdo-longueuil-taschereau',
    name: "McDonald's Boul. Taschereau, Longueuil (24h)",
    category: 'restroom',
    latitude: 45.5308,
    longitude: -73.4771,
  },
];
