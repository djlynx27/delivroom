/**
 * AI-driven demand simulation engine (simulation mode)
 * Replaces basic random generation with realistic base scores + time multipliers
 */

import type { Zone } from '@/hooks/useSupabase';
import type { TablesInsert } from '@/integrations/supabase/types';
import { generate96TimeLabels } from '@/lib/demandUtils';

const BASE_SCORES: Record<string, number> = {
  métro: 65,
  nightlife: 70,
  commercial: 60,
  transport: 65,
  événements: 75,
  université: 55,
  médical: 50,
  tourisme: 60,
  résidentiel: 40,
  achalandage: 65,
  aéroport: 70,
};

interface Multiplier {
  hours: [number, number]; // [start, end) — end can wrap (e.g. 22→3 = [22,27])
  weekdayOnly?: boolean;
  weekendOnly?: boolean;
  types: Record<string, number>;
}

const MULTIPLIERS: Multiplier[] = [
  { hours: [6, 9], weekdayOnly: true, types: { métro: 1.4, transport: 1.3, commercial: 0.8 } },
  { hours: [11, 13], types: { commercial: 1.2, université: 1.3 } },
  { hours: [16, 18], weekdayOnly: true, types: { métro: 1.5, transport: 1.4 } },
  { hours: [18, 22], types: { nightlife: 1.3, événements: 1.4 } },
  { hours: [22, 27], weekendOnly: true, types: { nightlife: 1.6, événements: 1.5 } },
];

function hourInRange(hour: number, range: [number, number]): boolean {
  const [s, e] = range;
  if (e <= 24) return hour >= s && hour < e;
  // Wrap-around (e.g. 22→27 means 22-23 and 0-2)
  return hour >= s || hour < (e % 24);
}

function computeScore(zoneType: string, hour: number, dayOfWeek: number): number {
  const base = BASE_SCORES[zoneType] ?? 50;
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  let multiplier = 1;
  for (const m of MULTIPLIERS) {
    if (m.weekdayOnly && !isWeekday) continue;
    if (m.weekendOnly && !isWeekend) continue;
    if (!hourInRange(hour, m.hours)) continue;
    if (m.types[zoneType]) {
      multiplier *= m.types[zoneType];
    }
  }

  const variation = Math.floor(Math.random() * 21) - 10; // ±10
  return Math.max(0, Math.min(100, Math.round(base * multiplier + variation)));
}

export interface SimulationProgress {
  current: number;
  total: number;
  cityName?: string;
}

/**
 * Generate all 96 time slots (15-min each, 06:00→05:45) for every zone
 */
export function generateAISimulatedSlots(
  cityId: string,
  date: string,
  zones: Zone[],
): TablesInsert<'time_slots'>[] {
  const d = new Date(date + 'T12:00:00');
  const dayOfWeek = d.getDay();
  const slots: TablesInsert<'time_slots'>[] = [];
  const timeLabels = generate96TimeLabels();

  for (const zone of zones) {
    for (const startTime of timeLabels) {
      const [h = 0, m = 0] = startTime.split(':').map(Number);
      const endTotalMin = h * 60 + m + 15;
      const eh = Math.floor(endTotalMin / 60) % 24;
      const em = endTotalMin % 60;
      const endTime = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
      const score = computeScore(zone.type, h, dayOfWeek);

      slots.push({
        date,
        start_time: startTime,
        end_time: endTime,
        city_id: cityId,
        zone_id: zone.id,
        demand_score: score,
        comment: '',
      });
    }
  }

  return slots;
}
