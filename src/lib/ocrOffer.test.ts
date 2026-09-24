import { describe, expect, it } from 'vitest';
import { parseOfferText } from './ocrOffer';

describe('parseOfferText', () => {
  it('extracts fare, pickup leg and ride leg from a standard offer card', () => {
    const text = '$8.50\n2 mins · 0.5 km\n8 mins · 4.2 km';
    expect(parseOfferText(text)).toEqual({
      fare: 8.5,
      pickupKm: 0.5,
      pickupMin: 2,
      rideKm: 4.2,
      rideMin: 8,
    });
  });

  it('treats a single leg as the ride when no pickup section is present', () => {
    const text = '$12\n8 mins · 4.2 km';
    const parsed = parseOfferText(text);
    expect(parsed.rideKm).toBe(4.2);
    expect(parsed.rideMin).toBe(8);
    expect(parsed.pickupKm).toBeNull();
  });

  it('converts miles to km', () => {
    const text = '$15\n3 mins · 1 mi\n10 mins · 2.5 mi';
    const parsed = parseOfferText(text);
    expect(parsed.pickupKm).toBeCloseTo(1.6);
    expect(parsed.rideKm).toBeCloseTo(4.0);
  });

  it('tolerates OCR separator noise between mins and km', () => {
    const text = '$7.00 5 mins . 3 km';
    const parsed = parseOfferText(text);
    expect(parsed.rideMin).toBe(5);
    expect(parsed.rideKm).toBe(3);
  });

  it('returns nulls when nothing recognizable is present', () => {
    expect(parseOfferText('blurry garbage')).toEqual({
      fare: null,
      pickupKm: null,
      pickupMin: null,
      rideKm: null,
      rideMin: null,
    });
  });
});
