// Helpers navigation Google Maps / Waze pour hotspots et zones
export function getGoogleMapsNavUrl(_name: string, lat: number, lng: number): string {
  // Use official Google Maps Directions API URL format for better precision and app intercepting
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

export function getWazeNavUrl(_name: string, lat: number, lng: number): string {
  return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes&zoom=17`;
}

// Use _system to trigger native Google Maps / Waze app on Android (Capacitor)
export function openGoogleMapsNav(_name: string, lat: number, lng: number): void {
  window.open(getGoogleMapsNavUrl(_name, lat, lng), '_system');
}

export function openWazeNav(_name: string, lat: number, lng: number): void {
  window.open(getWazeNavUrl(_name, lat, lng), '_system');
}

export function launchGoogleMapsNavigation(name: string, lat: number, lng: number): void {
  openGoogleMapsNav(name, lat, lng);
}
// Hotspots stratégiques optimisés pour HustleGo (2026)
// Généré à partir de l'analyse stratégique et logistique

export interface Hotspot {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  category: 'Santé' | 'Transport' | 'Commerce' | 'Retail' | 'Events';
  platforms: string[];
  egressVelocity: number; // 1-10, 10 = sortie ultra-rapide
}

export const HOTSPOTS: Hotspot[] = [
  // Santé
  {
    id: 'chum',
    name: 'CHUM Montréal',
    address: '1000 Rue Saint-Denis',
    lat: 45.5145,
    lng: -73.5586,
    category: 'Santé',
    platforms: ['Uber', 'Lyft', 'Eva'],
    egressVelocity: 9,
  },
  {
    id: 'ste-justine',
    name: 'Hôpital Sainte-Justine',
    address: '3175 Ch. de la Côte-Ste-Catherine',
    lat: 45.5017,
    lng: -73.6191,
    category: 'Santé',
    platforms: ['Uber', 'DoorDash'],
    egressVelocity: 9,
  },
  {
    id: 'cite-sante',
    name: 'Cité-de-la-Santé (Laval)',
    address: '1755 Boul. René-Laennec',
    lat: 45.5535,
    lng: -73.7528,
    category: 'Santé',
    platforms: ['Uber', 'Lyft', 'Eva', 'DoorDash', 'Skip'],
    egressVelocity: 10,
  },
  {
    id: 'le-gardeur',
    name: 'Hôpital Pierre-Le Gardeur',
    address: '911 Montée des Pionniers',
    lat: 45.7248,
    lng: -73.48,
    category: 'Santé',
    platforms: ['Uber', 'Skip', 'DoorDash'],
    egressVelocity: 10,
  },
  // Transport
  {
    id: 'metro-longueuil',
    name: 'Métro Longueuil',
    address: '900 Rue de Sérigny',
    lat: 45.5252,
    lng: -73.5205,
    category: 'Transport',
    platforms: ['Hypra Pro S', 'Uber'],
    egressVelocity: 9,
  },
  {
    id: 'gare-ste-therese',
    name: 'Gare Sainte-Thérèse',
    address: '6 Rue de la Gare (St-Alphonse)',
    lat: 45.6435,
    lng: -73.8284,
    category: 'Transport',
    platforms: ['Uber', 'Lyft', 'Eva'],
    egressVelocity: 10,
  },
  // Commerce
  {
    id: 'centropolis',
    name: 'Centropolis (Laval)',
    address: '495 Promenade du Centropolis',
    lat: 45.5613,
    lng: -73.7494,
    category: 'Commerce',
    platforms: ['DoorDash', 'Eva'],
    egressVelocity: 9,
  },
  {
    id: 'carrefour-laval',
    name: 'Carrefour Laval',
    address: '3035 Boul. le Carrefour (Tim Hortons)',
    lat: 45.5702,
    lng: -73.7519,
    category: 'Commerce',
    platforms: ['Instacart', 'Uber', 'Skip'],
    egressVelocity: 10,
  },
  {
    id: 'faubourg-boisbriand',
    name: 'Faubourg Boisbriand',
    address: "2693 Rue d'Annemasse",
    lat: 45.6281,
    lng: -73.8494,
    category: 'Commerce',
    platforms: ['DoorDash'],
    egressVelocity: 9,
  },
  {
    id: 'place-rosemere',
    name: 'Place Rosemère',
    address: '401 Boul. Curé-Labelle (Walmart)',
    lat: 45.6365,
    lng: -73.7993,
    category: 'Commerce',
    platforms: ['Instacart', 'Retail'],
    egressVelocity: 10,
  },
  {
    id: 'galeries-terrebonne',
    name: 'Galeries Terrebonne',
    address: '1185 Boul. Moody',
    lat: 45.7017,
    lng: -73.6449,
    category: 'Commerce',
    platforms: ['DoorDash'],
    egressVelocity: 8,
  },
  // Retail
  {
    id: 'premium-outlets',
    name: 'Premium Outlets',
    address: '19001 Ch. Notre-Dame, Mirabel',
    lat: 45.6784,
    lng: -73.8648,
    category: 'Retail',
    platforms: ['Uber Black', 'Lyft'],
    egressVelocity: 9,
  },
  // Events
  {
    id: 'centre-bell',
    name: 'Centre Bell',
    address: '1275 Rue Saint-Antoine Ouest',
    lat: 45.4961,
    lng: -73.5693,
    category: 'Events',
    platforms: ['Uber', 'Hypra Pro S'],
    egressVelocity: 10,
  },
  {
    id: 'place-bell',
    name: 'Place Bell (Laval)',
    address: '1700 Rue Jacques-Tétreault',
    lat: 45.5562,
    lng: -73.7203,
    category: 'Events',
    platforms: ['Uber', 'Lyft', 'Eva'],
    egressVelocity: 9,
  },
];
