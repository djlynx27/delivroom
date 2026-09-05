import { decideRideOffer } from '@/lib/rideDecision';
import { describe, expect, it } from 'vitest';

describe('decideRideOffer — floor absolu & hiérarchie $/hr', () => {
  it('force skip quand $/km ET $/hr sont sous le floor rideshare ($0.40/km, $18/h)', () => {
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

  it('ne force pas skip si un seul des deux seuils est franchi', () => {
    // $0.33/km (sous floor) mais $/h correct via un trajet très court
    const d = decideRideOffer({
      earnings: 10,
      pickupTimeMin: 0,
      pickupDistKm: 0,
      rideTimeMin: 10,
      rideDistKm: 30,
    });
    expect(d.reasoning.join(' ')).not.toMatch(/Floor absolu/);
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
