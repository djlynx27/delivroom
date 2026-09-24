// Local, offline-capable OCR for a Lyft/Maxymo ride-offer screenshot — no
// server call, no API key, no recurring cost. Runs Tesseract.js entirely on
// the driver's device (S23 Ultra). Separate from `analyze-screenshot`
// (Gemini, server-side, paid) which only handles post-ride earnings import —
// see memory `project_ocr_offer_local_only` for why these stay split.
//
// Expected screenshot text (per Lyft Driver's offer card layout, same shape
// documented in supabase/functions/analyze-screenshot's extraction prompt):
//   $8.50
//   2 mins · 0.5 km       <- pickup leg (first "X mins · Y km" line)
//   8 mins · 4.2 km       <- ride leg (second "X mins · Y km" line)
// The parser is lenient about the separator (OCR often mangles "·") and
// tolerates a single leg (pickup section not always shown).

const MILES_TO_KM = 1.60934;

export interface ParsedOffer {
  fare: number | null;
  pickupKm: number | null;
  pickupMin: number | null;
  rideKm: number | null;
  rideMin: number | null;
}

interface Leg {
  minutes: number;
  km: number;
}

function toKm(value: number, unit: string): number {
  return /mi/i.test(unit) ? Math.round(value * MILES_TO_KM * 10) / 10 : value;
}

function extractFare(text: string): number | null {
  const match = text.match(/\$\s*(\d+(?:[.,]\d{1,2})?)/);
  if (!match) return null;
  const value = parseFloat(match[1]!.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function extractLegs(text: string): Leg[] {
  const pattern = /(\d+(?:\.\d+)?)\s*mins?\b[^\d]{0,4}(\d+(?:\.\d+)?)\s*(km|mi)\b/gi;
  const legs: Leg[] = [];
  for (const match of text.matchAll(pattern)) {
    const minutes = parseFloat(match[1]!);
    const km = toKm(parseFloat(match[2]!), match[3]!);
    if (Number.isFinite(minutes) && Number.isFinite(km)) legs.push({ minutes, km });
  }
  return legs;
}

/** Pure text parser — exported separately from the OCR call so it's testable
 * without a real image/worker. */
export function parseOfferText(rawText: string): ParsedOffer {
  const text = rawText.replace(/\s+/g, ' ');
  const fare = extractFare(text);
  const legs = extractLegs(text);

  // One leg = ride only (pickup section not shown). Two+ legs = pickup then ride.
  const [pickup, ride] = legs.length >= 2 ? legs : [undefined, legs[0]];

  return {
    fare,
    pickupKm: pickup?.km ?? null,
    pickupMin: pickup?.minutes ?? null,
    rideKm: ride?.km ?? null,
    rideMin: ride?.minutes ?? null,
  };
}

/** Runs Tesseract.js on an image and returns the parsed offer fields.
 * Dynamically imports the library so it never loads until a driver actually
 * taps "scan" — it's ~2MB and most sessions won't touch it. */
export async function recognizeOfferImage(image: File | Blob): Promise<ParsedOffer> {
  const { recognize } = await import('tesseract.js');
  const { data } = await recognize(image, 'eng');
  return parseOfferText(data.text);
}
