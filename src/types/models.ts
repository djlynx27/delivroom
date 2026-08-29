export type ZoneType =
  | 'métro' | 'commercial' | 'résidentiel' | 'nightlife'
  | 'aéroport' | 'transport' | 'médical' | 'université'
  | 'événements' | 'tourisme';

export interface City {
  id: string;
  name: string;
}

export interface Zone {
  id: string;
  city_id: string;
  name: string;
  type: ZoneType;
  latitude: number;
  longitude: number;
}

export interface TimeSlot {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  city_id: string;
  zone_id: string;
  demand_score: number;
  comment: string;
}

export type DemandLevel = 'high' | 'medium' | 'low';

export function getDemandLevel(score: number): DemandLevel {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

export function getDemandClass(score: number) {
  const level = getDemandLevel(score);
  return {
    bg: level === 'high' ? 'demand-high' : level === 'medium' ? 'demand-medium' : 'demand-low',
    text: level === 'high' ? 'demand-high-text' : level === 'medium' ? 'demand-medium-text' : 'demand-low-text',
    border: level === 'high' ? 'demand-high-border' : level === 'medium' ? 'demand-medium-border' : 'demand-low-border',
  };
}

export function getCurrentSlotTime(): { start: string; end: string; date: string } {
  const now = new Date();
  const minutes = Math.floor(now.getMinutes() / 15) * 15;
  const start = new Date(now);
  start.setMinutes(minutes, 0, 0);
  const end = new Date(start);
  end.setMinutes(end.getMinutes() + 15);

  const fmt = (d: Date) => d.toTimeString().slice(0, 5);
  const date = start.toISOString().split('T')[0]!;
  return { start: fmt(start), end: fmt(end), date };
}
