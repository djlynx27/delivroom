import {
  PEAK_FACTOR,
  clampScore,
  computeMetrics,
  fixedRescaleScore,
  normalizeAll,
  percentileRankScores,
  rankAgreement,
  rawScore,
  softKneeScore,
} from '@/lib/scoreNormalization';
import { describe, expect, it } from 'vitest';

describe('rawScore — mirrors recalculate_zone_scores', () => {
  it('Friday 18h, base 82 -> 138.58 (the value that overflowed scores_score_check)', () => {
    expect(rawScore(82, 'métro', 5, 18)).toBeCloseTo(138.58, 2);
  });

  it('Sunday 4h is a dead hour (x0.6 x0.85)', () => {
    expect(rawScore(50, 'métro', 0, 4)).toBeCloseTo(25.5, 6);
  });

  it('commercial zones are cut to 10% from 22h to 6h only', () => {
    expect(rawScore(70, 'commercial', 6, 23)).toBeCloseTo(70 * 1.15 * 1.25 * 0.1, 6);
    expect(rawScore(70, 'commercial', 6, 15)).toBeCloseTo(70 * 0.85 * 1.25, 6);
  });
});

describe('the four methods', () => {
  it('clamp collapses everything above 100', () => {
    expect(clampScore(138.6)).toBe(100);
    expect(clampScore(100.01)).toBe(100);
    expect(clampScore(-3)).toBe(0);
  });

  it('softKnee: identity below the knee, strictly increasing and < 100 above it', () => {
    expect(softKneeScore(60)).toBe(60);
    expect(softKneeScore(80)).toBe(80);
    const a = softKneeScore(100);
    const b = softKneeScore(138.6);
    expect(a).toBeGreaterThan(80);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(100);
  });

  it('fixedRescale maps the highest possible raw to exactly 100', () => {
    const max = 82 * PEAK_FACTOR;
    expect(fixedRescaleScore(max, max)).toBeCloseTo(100, 6);
    expect(fixedRescaleScore(max / 2, max)).toBeCloseTo(50, 6);
  });

  it('percentileRank spans 0..100 and gives tied values the same rank', () => {
    expect(percentileRankScores([10, 20, 30])).toEqual([0, 50, 100]);
    const ranks = percentileRankScores([5, 5, 9]);
    expect(ranks[0]).toBe(ranks[1]);
    expect(ranks[2]).toBe(100);
  });
});

describe('metrics', () => {
  const raws = [30, 60, 90, 110, 120, 138.6];
  const out = normalizeAll(raws, { maxPossibleRaw: 138.6 });

  it('clamp ties the top zones; softKnee/fixedRescale/percentile never invert an order', () => {
    expect(computeMetrics(raws, out.clamp).at100).toBe(3);
    expect(computeMetrics(raws, out.softKnee).inversions).toBe(0);
    expect(computeMetrics(raws, out.fixedRescale).inversions).toBe(0);
    expect(computeMetrics(raws, out.percentileRank).inversions).toBe(0);
  });

  it('softKnee keeps all six values distinct, clamp does not', () => {
    expect(computeMetrics(raws, out.softKnee).distinctValues).toBe(6);
    expect(computeMetrics(raws, out.clamp).distinctValues).toBe(4);
  });

  it('kendall tau: 1 for a strictly monotone map, below 1 once ties appear', () => {
    expect(computeMetrics(raws, out.softKnee).tau).toBeCloseTo(1, 9);
    expect(computeMetrics(raws, out.clamp).tau).toBeLessThan(1);
  });

  it('rankAgreement counts a reversed pair as an inversion', () => {
    expect(rankAgreement([1, 2], [2, 1])).toEqual({ tau: -1, inversions: 1 });
  });
});
