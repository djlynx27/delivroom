import { computeElasticHourlyFloor, decideRideOffer } from '@/lib/rideDecision';
import { describe, expect, it } from 'vitest';

describe('decideRideOffer — floors rideshare (strict $/km + $/hr élastique)', () => {
  it('force skip quand $/km ET $/hr sont sous les seuils', () => {
    // $5 pour 15 km / 25 min → $0.33/km, $12/h
    const d = decideRideOffer({
      earnings: 5,
      pickupTimeMin: 0,
      pickupDistKm: 0,
      rideTimeMin: 25,
      rideDistKm: 15,
    });
    expect(d.verdict).toBe('skip');
    expect(d.confidence).toBe(100);
  });

  it('force skip sur le seul $/km strict (0.70/km), même avec un excellent $/hr', () => {
    // $10 pour 30 km / 10 min → $0.33/km (sous le plancher strict) mais $60/h
    // — le plancher $/km est désormais inconditionnel : un bon $/h ne rachète
    // plus un $/km qui ne couvre pas le coût du véhicule.
    const d = decideRideOffer({
      earnings: 10,
      pickupTimeMin: 0,
      pickupDistKm: 0,
      rideTimeMin: 10,
      rideDistKm: 30,
    });
    expect(d.verdict).toBe('skip');
    expect(d.reasoning.join(' ')).toMatch(/plancher strict/);
  });

  it('n\'exige plus le $/km ET le $/hr simultanément — un seul suffit à forcer skip', () => {
    // $/km correct (0.90) mais $/hr sous le plancher élastique de base (23) via un trajet lent
    const d = decideRideOffer({
      earnings: 9,
      pickupTimeMin: 0,
      pickupDistKm: 0,
      rideTimeMin: 30,
      rideDistKm: 10,
    });
    expect(d.metrics.dollarsPerKm).toBe(0.9);
    expect(d.metrics.effectiveHourlyRate).toBe(18);
    expect(d.verdict).toBe('skip');
    expect(d.reasoning.join(' ')).toMatch(/seuil élastique/);
  });

  it('un $/hr vert valide la course même si $/km est faible (hiérarchie)', () => {
    // $40 en 48 min → $50/h effectif, mais seulement $0.95/km sur 42 km
    const d = decideRideOffer({
      earnings: 40,
      pickupTimeMin: 0,
      pickupDistKm: 0,
      rideTimeMin: 48,
      rideDistKm: 42,
    });
    expect(d.metrics.effectiveHourlyRate).toBe(50);
    expect(d.verdict).toBe('take');
    expect(d.reasoning.join(' ')).not.toMatch(/\$\/km (excellent|trop bas|moyen)/);
  });

  it('utilise le floor delivery ($0.85/km, $28/h) quand platform=delivery', () => {
    // $7 pour 10 km / 16 min → $0.70/km, $26.25/h : sous le floor delivery, au-dessus du floor rideshare
    const rideshare = decideRideOffer({
      earnings: 7,
      pickupTimeMin: 0,
      pickupDistKm: 0,
      rideTimeMin: 16,
      rideDistKm: 10,
      platform: 'rideshare',
    });
    const delivery = decideRideOffer({
      earnings: 7,
      pickupTimeMin: 0,
      pickupDistKm: 0,
      rideTimeMin: 16,
      rideDistKm: 10,
      platform: 'delivery',
    });
    expect(rideshare.verdict).not.toBe('skip');
    expect(delivery.verdict).toBe('skip');
  });
});

describe('computeElasticHourlyFloor', () => {
  it('returns the off-peak base with no idle time', () => {
    expect(computeElasticHourlyFloor(false, null)).toBe(23);
    expect(computeElasticHourlyFloor(false, 0)).toBe(23);
  });

  it('returns the peak base with no idle time', () => {
    expect(computeElasticHourlyFloor(true, 0)).toBe(29);
  });

  it('does not decay within the 15-minute grace period', () => {
    expect(computeElasticHourlyFloor(false, 15)).toBe(23);
  });

  it('steps down $2/h every 10 minutes past the grace period', () => {
    expect(computeElasticHourlyFloor(false, 16)).toBe(23); // still within the first 10-min step
    expect(computeElasticHourlyFloor(false, 25)).toBe(21); // 1 step (25-15=10)
    expect(computeElasticHourlyFloor(false, 34)).toBe(21); // still 1 step (34-15=19, not yet 20)
    expect(computeElasticHourlyFloor(false, 35)).toBe(20); // 2 steps (23-4=19) clamped to the $20 hard floor
    expect(computeElasticHourlyFloor(true, 35)).toBe(25);  // peak base 29, 2 steps (29-4=25, above the floor)
  });

  it('never decays below the $20/h hard floor', () => {
    expect(computeElasticHourlyFloor(false, 200)).toBe(20);
    expect(computeElasticHourlyFloor(true, 200)).toBe(20);
  });
});

describe('decideRideOffer — idle-time decay integration', () => {
  it('a ride skipped off-peak with no idle time can become acceptable after enough idle decay', () => {
    // $/hr = 21 (below the 23 off-peak base, above the $20 hard floor),
    // $/km comfortably clears the strict floor.
    const ctx = {
      earnings: 10.5,
      pickupTimeMin: 0,
      pickupDistKm: 0,
      rideTimeMin: 30,
      rideDistKm: 10,
    };
    const freshQueue = decideRideOffer({ ...ctx, idleMinutes: 0 });
    expect(freshQueue.verdict).toBe('skip');
    expect(freshQueue.reasoning.join(' ')).toMatch(/seuil élastique/);

    const afterLongIdle = decideRideOffer({ ...ctx, idleMinutes: 40 }); // 2 decay steps -> floor 19
    expect(afterLongIdle.reasoning.join(' ')).not.toMatch(/seuil élastique/);
  });

  it('the elastic floor never drops the strict $/km floor', () => {
    // Even after a huge idle streak, a ride under $0.70/km must still skip.
    const d = decideRideOffer({
      earnings: 3,
      pickupTimeMin: 0,
      pickupDistKm: 0,
      rideTimeMin: 5,
      rideDistKm: 10, // $0.30/km
      idleMinutes: 200,
    });
    expect(d.verdict).toBe('skip');
    expect(d.reasoning.join(' ')).toMatch(/plancher strict/);
  });
});
