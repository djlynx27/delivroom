import type { ZoneHistory } from '@/lib/aiAgents';
import {
  applyDemandWindow,
  DEMAND_WINDOW_MINUTES,
  DEMAND_WINDOW_RECENCY_WEIGHT,
} from '@/lib/scoringEngine';
import { describe, expect, it } from 'vitest';

const now = new Date('2026-03-21T14:00:00Z');

function entry(minutesAgo: number, observedScore: number): ZoneHistory {
  return {
    zoneId: 'z1',
    observedScore,
    expectedScore: observedScore,
    timestamp: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
  };
}

describe('applyDemandWindow', () => {
  it('returns the baseline unchanged when there is no zoneId', () => {
    expect(applyDemandWindow(0.5, [entry(1, 90)], null, now, '5m')).toBe(0.5);
  });

  it('returns the baseline unchanged when no history falls within the window', () => {
    const history = [entry(45, 90)]; // outside a 30m window
    expect(applyDemandWindow(0.4, history, 'z1', now, '30m')).toBe(0.4);
  });

  it('blends the baseline with the in-window average using the window recency weight', () => {
    const history = [entry(2, 100)]; // score 100 -> recentFactor 1.0
    const baseline = 0.2;
    const result = applyDemandWindow(baseline, history, 'z1', now, '5m');

    const weight = DEMAND_WINDOW_RECENCY_WEIGHT['5m'];
    expect(result).toBeCloseTo(1.0 * weight + baseline * (1 - weight));
  });

  it('weights recent signal more aggressively for tighter windows', () => {
    const history = [entry(2, 100)];
    const baseline = 0.1;

    const result5m = applyDemandWindow(baseline, history, 'z1', now, '5m');
    const result1h = applyDemandWindow(baseline, history, 'z1', now, '1h');

    // 5m trusts the (high) recent signal more than 1h does, so it produces
    // a higher blended factor for the same inputs.
    expect(result5m).toBeGreaterThan(result1h);
  });

  it('only counts history strictly within each window boundary', () => {
    const history = [entry(DEMAND_WINDOW_MINUTES['30m'] - 1, 80)];
    expect(applyDemandWindow(0.3, history, 'z1', now, '5m')).toBe(0.3); // outside 5m
    expect(
      applyDemandWindow(0.3, history, 'z1', now, '30m')
    ).not.toBe(0.3); // inside 30m
  });
});
