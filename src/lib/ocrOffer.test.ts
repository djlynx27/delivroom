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

  // Fixtures below are real Tesseract.js output from actual Lyft Driver
  // offer screenshots (adb-pulled from Pictures/maxymo/lyft, 2026-09-24),
  // not hand-written text — they encode real OCR quirks synthetic text
  // can't reproduce.
  describe('real device OCR fixtures', () => {
    it('ignores map-label $ noise that appears before the real fare', () => {
      // Raw Tesseract output had a stray "$7," from a misread map label
      // BEFORE the actual "$15.05" fare. The ride leg below is dropped by
      // the plausibility ceiling (see next test), so only one leg survives
      // — a known ceiling interaction: with one leg left, it's reported as
      // the ride (the common single-leg case), not the pickup that
      // actually produced it.
      const text =
        'Hampstead, = NO . $15.05 | $23.15/hr est. rate for this ride ' +
        '6 mins = 2.2 km Avenue du Havre-des-Iles & Promenade des Iles, Laval ' +
        '33 mins +164 km Rue St-André & Rue St-Zotique E, Montréal';
      const parsed = parseOfferText(text);
      expect(parsed.fare).toBe(15.05);
      expect(parsed.rideKm).toBe(2.2);
      expect(parsed.rideMin).toBe(6);
    });

    it('drops an implausible leg distance instead of trusting a dropped decimal point', () => {
      // "16.4 km" was OCR'd as "164 km" (decimal point lost) — must not be
      // trusted as-is, it would 10x the real ride distance.
      const text = '$15.05 $23.15/hr est. rate for this ride 6 mins = 2.2 km 33 mins +164 km';
      const parsed = parseOfferText(text);
      expect(parsed.rideKm).not.toBe(164);
    });

    it('ignores the top pre-accept banner\'s duplicate "X min (Y km) away" leg pattern', () => {
      // Lyft shows "Lyft • $7.01 7 min (1.5 km) away" above the real card,
      // which also matches the leg regex and must not become the pickup leg.
      const text =
        '@ Lyft+$7.01 7 min (1.5 km) away $7.01 $38.23/hr est. rate for this ride ' +
        '6 mins = 1.2 km Chemin de la Station & Rue Notre-Dame O, Montréal ' +
        '5 mins - 0.9 km Rue Dagenais & Rue de Courcelle, Montréal';
      const parsed = parseOfferText(text);
      expect(parsed.fare).toBe(7.01);
      expect(parsed.pickupKm).toBe(1.2);
      expect(parsed.pickupMin).toBe(6);
      expect(parsed.rideKm).toBe(0.9);
      expect(parsed.rideMin).toBe(5);
    });

    it('parses a clean card with no map noise or banner', () => {
      const text =
        '@ Lyft- $23.01 10 min (4.6 km) away $23.01 $29.37/hr est. rate for this ride ' +
        '10 mins = 4.5 km Rue Kieran, St-Laurent 37 mins =18.9 km Rue Charlevoix & Rue Duvernay, Montréal';
      expect(parseOfferText(text)).toEqual({
        fare: 23.01,
        pickupKm: 4.5,
        pickupMin: 10,
        rideKm: 18.9,
        rideMin: 37,
      });
    });
  });
});
