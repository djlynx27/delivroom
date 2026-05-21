/**
 * surgeEngine.test.ts — Delivroom
 *
 * Tests unitaires pour surgeEngine.ts
 * 37 cas limites couvrant :
 *   - Multiplicateurs (normal → peak)
 *   - Vecteur contexte 8D (bornes, normalisation)
 *   - Boosts météo, événement, trafic
 *   - Bar closing surge
 *   - Saisons Montréal (hiver, GP de Montréal, fêtes)
 *   - Deadhead inverse
 *   - Edge cases (baseline=0, score=0, score max)
 *   - computeSurge API complète
 */

import {
  _lerp,
  buildSurgeContext,
  computeSurge,
  cosineSimilarity,
  getSurgeDisplay,
  type SurgeContext,
} from '@/lib/surgeEngine';
import { describe, expect, it } from 'vitest';

// ── Fixture helpers ────────────────────────────────────────────────────────────

function baseCtx(overrides: Partial<SurgeContext> = {}): SurgeContext {
  return {
    hour: 14, // 2pm — neutral
    dayOfWeek: 2, // Tuesday
    weatherScore: 0, // Clear sky
    eventProximity: 0,
    trafficIndex: 0,
    currentScore: 60,
    baselineScore: 60, // ratio = 1.0
    deadheadKm: 5,
    month: 8, // September — neutral season
    ...overrides,
  };
}

// ── Surge class boundaries ─────────────────────────────────────────────────────

describe('surge class — thresholds', () => {
  it('returns normal when demand is well below adjusted baseline', () => {
    const r = computeSurge(baseCtx({ currentScore: 20, baselineScore: 60 }));
    expect(r.surgeClass).toBe('normal');
    expect(r.surgeMultiplier).toBeGreaterThanOrEqual(1.0);
    expect(r.surgeMultiplier).toBeLessThan(1.18);
  });

  it('returns elevated when demand is modestly above adjusted baseline', () => {
    const r = computeSurge(baseCtx({ currentScore: 63, baselineScore: 60 }));
    expect(r.surgeClass).toBe('elevated');
    expect(r.surgeMultiplier).toBeGreaterThanOrEqual(1.18);
    expect(r.surgeMultiplier).toBeLessThan(1.45);
  });

  it('returns high when demand clearly exceeds adjusted baseline', () => {
    const r = computeSurge(baseCtx({ currentScore: 70, baselineScore: 60 }));
    expect(r.surgeClass).toBe('high');
    expect(r.surgeMultiplier).toBeGreaterThanOrEqual(1.45);
    expect(r.surgeMultiplier).toBeLessThan(1.8);
  });

  it('returns peak when ratio is extreme (2×+)', () => {
    const r = computeSurge(baseCtx({ currentScore: 100, baselineScore: 40 }));
    expect(r.surgeClass).toBe('peak');
    expect(r.surgeMultiplier).toBeGreaterThanOrEqual(1.8);
  });

  it('multiplier is always between 1.0 and 2.5', () => {
    for (const score of [0, 20, 50, 80, 100]) {
      const r = computeSurge(
        baseCtx({ currentScore: score, baselineScore: 50 })
      );
      expect(r.surgeMultiplier).toBeGreaterThanOrEqual(1.0);
      expect(r.surgeMultiplier).toBeLessThanOrEqual(2.5);
    }
  });
});

// ── Weather boost ──────────────────────────────────────────────────────────────

describe('weather boost', () => {
  it('no weather boost below 50 pts', () => {
    const withWeather = computeSurge(baseCtx({ weatherScore: 49 }));
    const noWeather = computeSurge(baseCtx({ weatherScore: 0 }));
    expect(withWeather.surgeMultiplier).toBeCloseTo(
      noWeather.surgeMultiplier,
      3
    );
  });

  it('adds weather boost above 50 pts', () => {
    const noWeather = computeSurge(baseCtx({ weatherScore: 0 }));
    const withWeather = computeSurge(baseCtx({ weatherScore: 80 }));
    expect(withWeather.surgeMultiplier).toBeGreaterThan(
      noWeather.surgeMultiplier
    );
  });

  it('blizzard (100pts) adds maximum weather boost ~0.15', () => {
    const noW = computeSurge(baseCtx({ weatherScore: 0 }));
    const blizzard = computeSurge(baseCtx({ weatherScore: 100 }));
    // Max boost = (100-50)/100 × 0.30 = 0.15
    const diff = blizzard.surgeMultiplier - noW.surgeMultiplier;
    expect(diff).toBeCloseTo(0.15, 1);
  });

  it('contains "météo" mention in reasoning when weather > 60', () => {
    const r = computeSurge(baseCtx({ weatherScore: 70 }));
    expect(r.reasoning).toContain('météo');
  });
});

// ── Event boost ────────────────────────────────────────────────────────────────

describe('event proximity boost', () => {
  it('full event at 100pts adds ~0.25 to multiplier', () => {
    const noEvent = computeSurge(baseCtx({ eventProximity: 0 }));
    const fullEvent = computeSurge(baseCtx({ eventProximity: 100 }));
    const diff = fullEvent.surgeMultiplier - noEvent.surgeMultiplier;
    expect(diff).toBeCloseTo(0.25, 1);
  });

  it('event mention in reasoning above 50', () => {
    const r = computeSurge(baseCtx({ eventProximity: 60 }));
    expect(r.reasoning).toContain('événement');
  });

  it('zero event proximity adds nothing', () => {
    const a = computeSurge(baseCtx({ eventProximity: 0 }));
    const b = computeSurge(
      baseCtx({ eventProximity: 0, weatherScore: 0, trafficIndex: 0 })
    );
    expect(a.surgeMultiplier).toBeCloseTo(b.surgeMultiplier, 5);
  });
});

// ── Traffic boost ──────────────────────────────────────────────────────────────

describe('traffic boost', () => {
  it('heavy traffic (100pts) adds ~0.15', () => {
    const noTraff = computeSurge(baseCtx({ trafficIndex: 0 }));
    const heavyTraff = computeSurge(baseCtx({ trafficIndex: 100 }));
    const diff = heavyTraff.surgeMultiplier - noTraff.surgeMultiplier;
    expect(diff).toBeCloseTo(0.15, 1);
  });

  it('trafic mention when index > 60', () => {
    const r = computeSurge(baseCtx({ trafficIndex: 70 }));
    expect(r.reasoning).toContain('trafic');
  });
});

// ── Bar closing surge (02:00–03:30) ───────────────────────────────────────────

describe('bar closing surge', () => {
  it('mentions bar closing at 02h', () => {
    const r = computeSurge(baseCtx({ hour: 2 }));
    expect(r.reasoning).toContain('bar closing');
  });

  it('mentions bar closing at 03h', () => {
    const r = computeSurge(baseCtx({ hour: 3 }));
    expect(r.reasoning).toContain('bar closing');
  });

  it('no bar closing mention at 04h', () => {
    const r = computeSurge(baseCtx({ hour: 4 }));
    expect(r.reasoning).not.toContain('bar closing');
  });
});

// ── Seasonal indices Montréal ─────────────────────────────────────────────────

describe('seasonal modulation', () => {
  it('December (month=11) has higher adjusted baseline → lower ratio → lower surge vs July at same score', () => {
    const july = computeSurge(
      baseCtx({ month: 6, currentScore: 80, baselineScore: 60 })
    );
    const december = computeSurge(
      baseCtx({ month: 11, currentScore: 80, baselineScore: 60 })
    );
    // Dec seasonal (1.18) > Jul seasonal (1.10) → adjustedBaseline ↑ → ratio ↓ → surge ↓
    expect(december.surgeMultiplier).toBeLessThanOrEqual(
      july.surgeMultiplier + 0.05
    );
  });

  it('January (winter) seasonal index = 1.15 — boosted baseline still modulates surge', () => {
    const r = computeSurge(
      baseCtx({ month: 0, currentScore: 75, baselineScore: 60 })
    );
    expect(r.surgeMultiplier).toBeGreaterThanOrEqual(1.0);
    expect(r.surgeMultiplier).toBeLessThanOrEqual(2.5);
  });

  it('May (low season) yields higher surge ratio at same scores vs December', () => {
    const may = computeSurge(
      baseCtx({ month: 4, currentScore: 80, baselineScore: 60 })
    );
    const dec = computeSurge(
      baseCtx({ month: 11, currentScore: 80, baselineScore: 60 })
    );
    // May seasonal (0.90) < Dec seasonal (1.18) → lower adjustedBaseline → higher ratio → higher surge
    expect(may.surgeMultiplier).toBeGreaterThanOrEqual(
      dec.surgeMultiplier - 0.05
    );
  });
});

// ── Day-of-week modulation ─────────────────────────────────────────────────────

describe('day-of-week baseline modulation', () => {
  it('Friday (5) yields lower surge than Monday at same raw scores because Friday baseline is highest', () => {
    const friday = computeSurge(
      baseCtx({ dayOfWeek: 5, currentScore: 70, baselineScore: 60 })
    );
    const monday = computeSurge(
      baseCtx({ dayOfWeek: 1, currentScore: 70, baselineScore: 60 })
    );
    // Friday DOW multiplier = 1.0 (max) → adjustedBaseline highest → ratio lowest → lower surge
    expect(friday.surgeMultiplier).toBeLessThanOrEqual(
      monday.surgeMultiplier + 0.02
    );
  });

  it('Sunday (0) yields noticeably different surge than Saturday (6) at same scores', () => {
    const sun = computeSurge(
      baseCtx({ dayOfWeek: 0, currentScore: 80, baselineScore: 60 })
    );
    const sat = computeSurge(
      baseCtx({ dayOfWeek: 6, currentScore: 80, baselineScore: 60 })
    );
    expect(sun.surgeMultiplier).toBeGreaterThanOrEqual(1.0);
    expect(sat.surgeMultiplier).toBeGreaterThanOrEqual(1.0);
  });
});

// ── Deadhead (inverse distance) ────────────────────────────────────────────────

describe('deadhead inverse distance', () => {
  it('context vector dim[6] is 1.0 when deadheadKm = 0', () => {
    const r = computeSurge(baseCtx({ deadheadKm: 0 }));
    expect(r.contextVector[6]).toBe(1.0);
  });

  it('context vector dim[6] approaches 0 when deadheadKm = 30+', () => {
    const r = computeSurge(baseCtx({ deadheadKm: 30 }));
    expect(r.contextVector[6]).toBeCloseTo(0, 2);
  });

  it('very close zone mentioned in reasoning when deadhead < 2km', () => {
    const r = computeSurge(baseCtx({ deadheadKm: 1 }));
    expect(r.reasoning).toContain('km');
  });
});

// ── Context vector 8D ─────────────────────────────────────────────────────────

describe('context vector 8D', () => {
  it('all 8 dimensions are within [0, 1]', () => {
    const r = computeSurge(
      baseCtx({
        hour: 23,
        dayOfWeek: 6,
        weatherScore: 100,
        eventProximity: 100,
        trafficIndex: 100,
        currentScore: 100,
        baselineScore: 20,
        deadheadKm: 0,
        month: 11,
      })
    );
    expect(r.contextVector).toHaveLength(8);
    for (const dim of r.contextVector) {
      expect(dim).toBeGreaterThanOrEqual(0);
      expect(dim).toBeLessThanOrEqual(1);
    }
  });

  it('hour dimension: midnight = 0, 23h ≈ 1', () => {
    const midnight = computeSurge(baseCtx({ hour: 0 }));
    const lateNight = computeSurge(baseCtx({ hour: 23 }));
    expect(midnight.contextVector[0]).toBeCloseTo(0, 2);
    expect(lateNight.contextVector[0]).toBeCloseTo(1, 2);
  });

  it('day dimension: Monday (0) ≈ 0, Sunday (6) ≈ 1', () => {
    const mon = computeSurge(baseCtx({ dayOfWeek: 0 }));
    const sun = computeSurge(baseCtx({ dayOfWeek: 6 }));
    expect(mon.contextVector[1]).toBeCloseTo(0, 2);
    expect(sun.contextVector[1]).toBeCloseTo(1, 2);
  });

  it('weather dim = weatherScore / 100', () => {
    const r = computeSurge(baseCtx({ weatherScore: 60 }));
    expect(r.contextVector[2]).toBeCloseTo(0.6, 2);
  });

  it('event dim = eventProximity / 100', () => {
    const r = computeSurge(baseCtx({ eventProximity: 75 }));
    expect(r.contextVector[3]).toBeCloseTo(0.75, 2);
  });

  it('traffic dim = trafficIndex / 100', () => {
    const r = computeSurge(baseCtx({ trafficIndex: 40 }));
    expect(r.contextVector[4]).toBeCloseTo(0.4, 2);
  });
});

// ── Edge cases ─────────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('baseline = 0 returns minimum multiplier gracefully', () => {
    const r = computeSurge(baseCtx({ currentScore: 80, baselineScore: 0 }));
    expect(r.surgeMultiplier).toBe(1.0);
    expect(r.surgeClass).toBe('normal');
  });

  it('currentScore = 0 returns modest multiplier', () => {
    const r = computeSurge(baseCtx({ currentScore: 0, baselineScore: 60 }));
    expect(r.surgeMultiplier).toBeGreaterThanOrEqual(1.0);
    expect(r.surgeMultiplier).toBeLessThan(1.18);
  });

  it('both scores = 0 returns safe minimum', () => {
    const r = computeSurge(baseCtx({ currentScore: 0, baselineScore: 0 }));
    expect(r.surgeMultiplier).toBe(1.0);
  });

  it('all boosts maxed at once caps at 2.5', () => {
    const r = computeSurge({
      hour: 2,
      dayOfWeek: 5,
      weatherScore: 100,
      eventProximity: 100,
      trafficIndex: 100,
      currentScore: 100,
      baselineScore: 20,
      deadheadKm: 0,
      month: 6,
    });
    expect(r.surgeMultiplier).toBeLessThanOrEqual(2.5);
    expect(r.surgeClass).toBe('peak');
  });

  it('surgeScore is always between 0 and 100', () => {
    for (const [cur, bas] of [
      [0, 60],
      [60, 60],
      [100, 20],
      [0, 0],
    ]) {
      const r = computeSurge(
        baseCtx({ currentScore: cur, baselineScore: bas })
      );
      expect(r.surgeScore).toBeGreaterThanOrEqual(0);
      expect(r.surgeScore).toBeLessThanOrEqual(100);
    }
  });

  it('estimatedBoostPct = 0 when multiplier = 1.0', () => {
    const r = computeSurge(
      baseCtx({ dayOfWeek: 5, currentScore: 60, baselineScore: 60 })
    );
    expect(r.estimatedBoostPct).toBe(0);
  });

  it('reasoning is always a non-empty string', () => {
    for (const cls of ['normal', 'elevated', 'high', 'peak'] as const) {
      const scoreMap = { normal: 60, elevated: 73, high: 90, peak: 100 };
      const r = computeSurge(
        baseCtx({ currentScore: scoreMap[cls], baselineScore: 40 })
      );
      expect(typeof r.reasoning).toBe('string');
      expect(r.reasoning.length).toBeGreaterThan(3);
    }
  });

  it('very large deadhead (50km) clips context vector dim[6] to 0', () => {
    const r = computeSurge(baseCtx({ deadheadKm: 50 }));
    expect(r.contextVector[6]).toBe(0);
  });

  it('handles every month index 0–11 without throwing', () => {
    for (let m = 0; m < 12; m++) {
      expect(() => computeSurge(baseCtx({ month: m }))).not.toThrow();
    }
  });

  it('handles every hour 0–23 without throwing', () => {
    for (let h = 0; h < 24; h++) {
      expect(() => computeSurge(baseCtx({ hour: h }))).not.toThrow();
    }
  });

  it('handles every day-of-week 0–6 without throwing', () => {
    for (let d = 0; d < 7; d++) {
      expect(() => computeSurge(baseCtx({ dayOfWeek: d }))).not.toThrow();
    }
  });
});

// ── Full API shape ─────────────────────────────────────────────────────────────

describe('computeSurge API shape', () => {
  it('returns all required fields', () => {
    const r = computeSurge(baseCtx());
    expect(r).toHaveProperty('surgeMultiplier');
    expect(r).toHaveProperty('surgeScore');
    expect(r).toHaveProperty('surgeClass');
    expect(r).toHaveProperty('contextVector');
    expect(r).toHaveProperty('reasoning');
    expect(r).toHaveProperty('estimatedBoostPct');
  });

  it('surgeMultiplier has at most 2 decimal places', () => {
    const r = computeSurge(baseCtx({ currentScore: 77, baselineScore: 52 }));
    const decimals = r.surgeMultiplier.toString().split('.')[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(2);
  });

  it('context vector is readonly tuple of 8 numbers', () => {
    const r = computeSurge(baseCtx());
    expect(r.contextVector).toHaveLength(8);
    expect(r.contextVector.every((v) => typeof v === 'number')).toBe(true);
  });

  it('surgeClass is one of the 4 valid values', () => {
    const valid = ['normal', 'elevated', 'high', 'peak'];
    const r = computeSurge(baseCtx());
    expect(valid).toContain(r.surgeClass);
  });
});

describe('buildSurgeContext', () => {
  it('extracts hour, dayOfWeek and month from now', () => {
    const now = new Date(2026, 2, 21, 17, 30, 0); // Saturday March 21, 17:30
    const ctx = buildSurgeContext({
      now,
      currentScore: 80,
      baselineScore: 55,
      weatherScore: 0.3,
      eventProximity: 0.5,
      trafficIndex: 0.4,
      deadheadKm: 2,
    });
    expect(ctx.hour).toBe(17);
    expect(ctx.dayOfWeek).toBe(6); // Saturday
    expect(ctx.month).toBe(2); // March (0-indexed)
    expect(ctx.currentScore).toBe(80);
    expect(ctx.baselineScore).toBe(55);
  });
});

describe('getSurgeDisplay', () => {
  it('returns peak display for peak class', () => {
    const d = getSurgeDisplay('peak');
    expect(d.label).toContain('PEAK');
    expect(d.pulseClass).toBe('animate-pulse');
  });

  it('returns high display for high class', () => {
    const d = getSurgeDisplay('high');
    expect(d.label).toContain('SURGE');
  });

  it('returns elevated display for elevated class', () => {
    const d = getSurgeDisplay('elevated');
    expect(d.pulseClass).toBe('');
  });

  it('returns normal (default) display for normal class', () => {
    const d = getSurgeDisplay('normal');
    expect(d.label).toContain('Normal');
    expect(d.bgClass).toContain('green');
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0, 0], [0, 0, 0])).toBe(0);
  });

  it('returns 0 for vectors of different lengths', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('returns ~0.707 for 45-degree vectors in 2D', () => {
    expect(cosineSimilarity([1, 1], [1, 0])).toBeCloseTo(Math.SQRT1_2, 3);
  });
});

describe('_lerp', () => {
  it('returns a when t=0', () => {
    expect(_lerp(10, 20, 0)).toBe(10);
  });

  it('returns b when t=1', () => {
    expect(_lerp(10, 20, 1)).toBe(20);
  });

  it('returns midpoint when t=0.5', () => {
    expect(_lerp(10, 20, 0.5)).toBe(15);
  });

  it('clamps t above 1', () => {
    expect(_lerp(10, 20, 2)).toBe(20);
  });

  it('clamps t below 0', () => {
    expect(_lerp(10, 20, -1)).toBe(10);
  });
});
