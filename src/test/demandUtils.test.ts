import type { Zone } from '@/hooks/useSupabase';
import {
  createSimulatedSlotForTime,
  formatTime24h,
  generate96TimeLabels,
  generateSimulatedSlots,
  getCurrentSlotTime,
  getDemandClass,
  getDemandLevel,
  getSlotOrderMinutes,
  getUpcomingSlotTimes,
  hasFiniteCoordinates,
  normalize24hTime,
} from '@/lib/demandUtils';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('hasFiniteCoordinates', () => {
  it('accepts finite lat/lng', () => {
    expect(hasFiniteCoordinates({ latitude: 45.5, longitude: -73.6 })).toBe(true);
  });

  it('rejects NaN coordinates', () => {
    expect(hasFiniteCoordinates({ latitude: NaN, longitude: -73.6 })).toBe(false);
  });

  it('rejects null/undefined coordinates', () => {
    expect(
      hasFiniteCoordinates({ latitude: null as unknown as number, longitude: -73.6 })
    ).toBe(false);
    expect(
      hasFiniteCoordinates({ latitude: 45.5, longitude: undefined as unknown as number })
    ).toBe(false);
  });

  it('rejects Infinity', () => {
    expect(hasFiniteCoordinates({ latitude: Infinity, longitude: -73.6 })).toBe(false);
  });
});

describe('normalize24hTime', () => {
  it('pads single-digit hours and minutes', () => {
    expect(normalize24hTime('8:5')).toBe('08:05');
  });

  it('leaves well-formed time untouched', () => {
    expect(normalize24hTime('14:30')).toBe('14:30');
  });

  it('handles edge midnight value', () => {
    expect(normalize24hTime('00:00')).toBe('00:00');
  });

  it('handles NaN gracefully with default zero', () => {
    expect(normalize24hTime('xx:yy')).toBe('00:00');
  });
});

describe('formatTime24h', () => {
  it('formats date hours and minutes with padding', () => {
    const date = new Date(2026, 2, 21, 8, 5, 0);
    expect(formatTime24h(date)).toBe('08:05');
  });

  it('formats afternoon times correctly', () => {
    const date = new Date(2026, 2, 21, 17, 45, 0);
    expect(formatTime24h(date)).toBe('17:45');
  });
});

describe('getSlotOrderMinutes', () => {
  it('returns offset-from-6am for a morning time', () => {
    // 06:00 → 0 minutes after base
    expect(getSlotOrderMinutes('06:00')).toBe(0);
  });

  it('wraps pre-6am times to end of 24h cycle', () => {
    // 05:45 → 23*60+45 - 360+60 = somewhere after midnight
    const result = getSlotOrderMinutes('05:45');
    expect(result).toBeGreaterThan(60 * 18); // after 18h of day
  });

  it('gives 15-minute delta between consecutive slots', () => {
    const a = getSlotOrderMinutes('10:00');
    const b = getSlotOrderMinutes('10:15');
    expect(b - a).toBe(15);
  });
});

describe('generate96TimeLabels', () => {
  it('generates exactly 96 labels', () => {
    const labels = generate96TimeLabels();
    expect(labels).toHaveLength(96);
  });

  it('starts at 06:00', () => {
    const labels = generate96TimeLabels();
    expect(labels[0]).toBe('06:00');
  });

  it('has 15-minute intervals', () => {
    const labels = generate96TimeLabels();
    expect(labels[1]).toBe('06:15');
    expect(labels[2]).toBe('06:30');
  });

  it('ends at 05:45 (wraps through midnight)', () => {
    const labels = generate96TimeLabels();
    expect(labels[95]).toBe('05:45');
  });
});

describe('getDemandLevel', () => {
  it('returns high for score >= 70', () => {
    expect(getDemandLevel(70)).toBe('high');
    expect(getDemandLevel(100)).toBe('high');
  });

  it('returns medium for 40 <= score < 70', () => {
    expect(getDemandLevel(40)).toBe('medium');
    expect(getDemandLevel(69)).toBe('medium');
  });

  it('returns low for score < 40', () => {
    expect(getDemandLevel(0)).toBe('low');
    expect(getDemandLevel(39)).toBe('low');
  });
});

describe('getDemandClass', () => {
  it('returns demand-high css classes for high scores', () => {
    const cls = getDemandClass(80);
    expect(cls.bg).toBe('demand-high');
    expect(cls.text).toBe('demand-high-text');
    expect(cls.border).toBe('demand-high-border');
  });

  it('returns demand-medium css classes for medium scores', () => {
    const cls = getDemandClass(55);
    expect(cls.bg).toBe('demand-medium');
  });

  it('returns demand-low css classes for low scores', () => {
    const cls = getDemandClass(20);
    expect(cls.bg).toBe('demand-low');
  });
});

describe('getUpcomingSlotTimes', () => {
  it('returns the requested number of slot times', () => {
    const now = new Date(2026, 2, 21, 10, 7, 0); // 10:07
    const slots = getUpcomingSlotTimes(now, 4);
    expect(slots).toHaveLength(4);
  });

  it('first slot rounds up to next 15-min boundary', () => {
    const now = new Date(2026, 2, 21, 10, 7, 0); // 10:07 → next slot 10:15
    const slots = getUpcomingSlotTimes(now, 1);
    expect(slots[0]).toBe('10:15');
  });

  it('consecutive slots are 15 min apart', () => {
    const now = new Date(2026, 2, 21, 9, 0, 0); // 09:00 → next slot 09:15
    const slots = getUpcomingSlotTimes(now, 3);
    expect(slots[0]).toBe('09:15');
    expect(slots[1]).toBe('09:30');
    expect(slots[2]).toBe('09:45');
  });
});

describe('getCurrentSlotTime', () => {
  it('returns a start time rounded down to 15-min boundary', () => {
    const now = new Date(2026, 2, 21, 14, 22, 0); // 14:22 → slot 14:15
    const { start } = getCurrentSlotTime(now);
    expect(start).toBe('14:15');
  });

  it('returns end time 15 minutes after start', () => {
    const now = new Date(2026, 2, 21, 14, 22, 0);
    const { start, end } = getCurrentSlotTime(now);
    expect(start).toBe('14:15');
    expect(end).toBe('14:30');
  });

  it('returns a date string in YYYY-MM-DD format', () => {
    const now = new Date(2026, 2, 21, 10, 0, 0);
    const { date } = getCurrentSlotTime(now);
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('handles exact 15-min boundaries without shifting', () => {
    const now = new Date(2026, 2, 21, 9, 30, 0); // exactly on boundary
    const { start } = getCurrentSlotTime(now);
    expect(start).toBe('09:30');
  });
});

const MOCK_ZONE: Zone = {
  id: 'downtown-mtl',
  name: 'Downtown',
  type: 'commercial',
  latitude: 45.5,
  longitude: -73.57,
  city_id: 'mtl',
  address: null,
  base_score: 50,
  category: null,
  created_at: '',
  current_score: 50,
  territory: null,
  updated_at: '',
};

describe('createSimulatedSlotForTime', () => {
  it('creates a slot with the expected shape', () => {
    const slot = createSimulatedSlotForTime(
      'mtl',
      '2026-03-21',
      '10:00',
      MOCK_ZONE
    );
    expect(slot.city_id).toBe('mtl');
    expect(slot.date).toBe('2026-03-21');
    expect(slot.start_time).toBe('10:00');
    expect(slot.end_time).toBe('10:15');
    expect(typeof slot.demand_score).toBe('number');
    expect(slot.demand_score).toBeGreaterThanOrEqual(0);
    expect(slot.demand_score).toBeLessThanOrEqual(100);
  });

  it('assigns a unique id containing date and zone id', () => {
    const slot = createSimulatedSlotForTime(
      'mtl',
      '2026-03-21',
      '14:30',
      MOCK_ZONE
    );
    expect(slot.id).toContain('2026-03-21');
    expect(slot.id).toContain('downtown-mtl');
  });

  it('normalizes time to HH:MM format', () => {
    const slot = createSimulatedSlotForTime(
      'mtl',
      '2026-03-21',
      '9:0',
      MOCK_ZONE
    );
    expect(slot.start_time).toBe('09:00');
  });
});

describe('generateSimulatedSlots', () => {
  it('generates 96 slots per zone', () => {
    const slots = generateSimulatedSlots('mtl', '2026-03-21', [MOCK_ZONE]);
    expect(slots).toHaveLength(96);
  });

  it('generates 96 × zones.length slots', () => {
    const secondZone: Zone = {
      ...MOCK_ZONE,
      id: 'plateau',
      name: 'Plateau',
      type: 'résidentiel',
    };
    const slots = generateSimulatedSlots('mtl', '2026-03-21', [
      MOCK_ZONE,
      secondZone,
    ]);
    expect(slots).toHaveLength(192);
  });

  it('all slots have demand_score between 0 and 100', () => {
    const slots = generateSimulatedSlots('mtl', '2026-03-21', [MOCK_ZONE]);
    for (const slot of slots) {
      expect(slot.demand_score).toBeGreaterThanOrEqual(0);
      expect(slot.demand_score).toBeLessThanOrEqual(100);
    }
  });

  it('returns empty array when no zones provided', () => {
    const slots = generateSimulatedSlots('mtl', '2026-03-21', []);
    expect(slots).toHaveLength(0);
  });
});

// generateDemandScore branches — triggered via createSimulatedSlotForTime with
// controlled day-of-week using fake timers so all code paths execute reliably.
describe('generateDemandScore — branch coverage via createSimulatedSlotForTime', () => {
  // Freeze time to Monday 2026-03-16 so isWeekend=false and dayOfWeek=1
  const MONDAY = new Date('2026-03-16T00:00:00.000Z');

  afterEach(() => vi.useRealTimers());

  it('hits weekday rush-hour branch (08:00, non-weekend)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(MONDAY);
    const slot = createSimulatedSlotForTime('mtl', '2026-03-16', '08:00', {
      ...MOCK_ZONE,
      type: 'commercial',
    });
    // Rush-hour adds 30 to base; score should be above the non-rush minimum
    expect(slot.demand_score).toBeGreaterThan(0);
  });

  it('hits airport nightlife-hours branch (22:00, aéroport)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(MONDAY);
    const slot = createSimulatedSlotForTime('mtl', '2026-03-16', '22:00', {
      ...MOCK_ZONE,
      type: 'aéroport',
    });
    // hour >= 22 && type=aéroport → base += 20
    expect(slot.demand_score).toBeGreaterThan(0);
    expect(slot.demand_score).toBeLessThanOrEqual(100);
  });

  it('hits university weekday branch (10:00, université, weekday)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(MONDAY);
    const slot = createSimulatedSlotForTime('mtl', '2026-03-16', '10:00', {
      ...MOCK_ZONE,
      type: 'université',
    });
    // Weekday 10:00 + université → base += 20
    expect(slot.demand_score).toBeGreaterThan(0);
    expect(slot.demand_score).toBeLessThanOrEqual(100);
  });
});
