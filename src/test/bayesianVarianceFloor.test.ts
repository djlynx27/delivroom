import { MIN_VARIANCE, updateBayesianBelief } from '@/lib/learningEngine';
import { describe, expect, it } from 'vitest';

describe('updateBayesianBelief — variance floor (MIN_VARIANCE)', () => {
  it('keeps at least a 10% gain on a new real observation, however many came before', () => {
    // Prior mean 30 and an (almost) collapsed variance: without the floor the
    // gain would be ~0 and the mean would never leave 30.
    const { posteriorMean } = updateBayesianBelief(30, 0.01, 50);
    const gain = (posteriorMean - 30) / (50 - 30);
    expect(gain).toBeGreaterThanOrEqual(MIN_VARIANCE / (MIN_VARIANCE + 36) - 1e-9);
    expect(posteriorMean).toBeGreaterThan(31.9);
  });

  it('still follows a trend shift after 300 identical observations', () => {
    let mean = 25;
    let variance = 100;
    for (let i = 0; i < 300; i++) ({ posteriorMean: mean, posteriorVariance: variance } = updateBayesianBelief(mean, variance, 25));
    for (let i = 0; i < 15; i++) ({ posteriorMean: mean, posteriorVariance: variance } = updateBayesianBelief(mean, variance, 45));
    expect(mean).toBeGreaterThan(38); // moved most of the way to 45 within 15 obs
  });

  it('does not change an update whose prior variance is already above the floor', () => {
    const { posteriorMean, posteriorVariance } = updateBayesianBelief(25, 100, 40);
    expect(posteriorVariance).toBeCloseTo(1 / (1 / 100 + 1 / 36), 6);
    expect(posteriorMean).toBeCloseTo(posteriorVariance * (25 / 100 + 40 / 36), 6);
  });
});
