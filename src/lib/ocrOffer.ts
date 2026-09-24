// Local, offline-capable OCR for a Lyft/Maxymo ride-offer screenshot — no
// server call, no API key, no recurring cost. Runs Tesseract.js entirely on
// the driver's device (S23 Ultra). Separate from `analyze-screenshot`
// (Gemini, server-side, paid) which only handles post-ride earnings import —
// see memory `project_ocr_offer_local_only` for why these stay split.
//
// Expected screenshot text (per Lyft Driver's offer card layout, same shape
// documented in supabase/functions/analyze-screenshot's extraction prompt):
//   $8.50
//   $23/hr est. rate for this ride
//   2 mins · 0.5 km       <- pickup leg (first "X mins · Y km" line)
//   8 mins · 4.2 km       <- ride leg (second "X mins · Y km" line)
// The parser is lenient about the separator (OCR often mangles "·").
//
// Calibrated against real device OCR output (adb-pulled Lyft screenshots,
// 2026-09-24), which surfaced two failure modes synthetic text can't:
// 1. Lyft shows a persistent top banner before the card itself —
//    "Lyft • $7.01 7 min (1.5 km) away" — which also matches the leg
//    pattern and would get mistaken for the pickup leg. Fixed by only
//    scanning for legs/fare relative to the "est. rate" line, which always
//    sits between the banner and the real card content.
// 2. Tesseract occasionally drops the decimal point on distances (a real
//    "16.4 km" came back as "164 km"). Not recoverable by regex — flagged
//    via a plausibility ceiling below instead of silently trusting it.

const MILES_TO_KM = 1.60934;
// No single MTL/Laval/Rive-Sud leg is plausibly this long — a value above
// this is almost certainly a dropped decimal point, not a real distance.
// ponytail: heuristic ceiling, not a fix for the underlying OCR miss —
// revisit if Tesseract's decimal accuracy improves or legs start clipping.
const MAX_PLAUSIBLE_LEG_KM = 120;

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

/** The fare is the last "$X.XX" before the rate figure's OWN "$Y.YY/hr" —
 * not the first "$" in the text, which can be map-label OCR noise, and not
 * the rate itself (which also starts with "$"). The rate always sits right
 * after the fare, so anchoring on its "$.../hr" span and looking strictly
 * before it isolates the fare regardless of what noise precedes it. */
function extractFare(text: string, rateSpanStart: number): number | null {
  const scope = rateSpanStart >= 0 ? text.slice(0, rateSpanStart) : text;
  const matches = [...scope.matchAll(/\$\s*(\d+(?:[.,]\d{1,2})?)/g)];
  const last = matches.at(-1);
  if (!last) return null;
  const value = parseFloat(last[1]!.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function extractLegs(text: string, fromIndex: number): Leg[] {
  const scope = fromIndex >= 0 ? text.slice(fromIndex) : text;
  const pattern = /(\d+(?:\.\d+)?)\s*mins?\b[^\d]{0,4}(\d+(?:\.\d+)?)\s*(km|mi)\b/gi;
  const legs: Leg[] = [];
  for (const match of scope.matchAll(pattern)) {
    const minutes = parseFloat(match[1]!);
    const km = toKm(parseFloat(match[2]!), match[3]!);
    if (Number.isFinite(minutes) && Number.isFinite(km) && km <= MAX_PLAUSIBLE_LEG_KM) {
      legs.push({ minutes, km });
    }
  }
  return legs;
}

/** The "$Y.YY/hr" rate figure always sits right after the fare and right
 * before the two ride legs — a reliable anchor for both. -1/-1 when absent
 * (extractFare/extractLegs then fall back to scanning the whole text). */
function findRateSpan(text: string): { start: number; end: number } {
  const rateMatch = text.match(/\$\s*\d+(?:[.,]\d{1,2})?\s*\/\s*hr/i);
  if (!rateMatch) return { start: -1, end: -1 };
  return { start: rateMatch.index!, end: rateMatch.index! + rateMatch[0].length };
}

/** Pure text parser — exported separately from the OCR call so it's testable
 * without a real image/worker. */
export function parseOfferText(rawText: string): ParsedOffer {
  const text = rawText.replace(/\s+/g, ' ');
  const rateSpan = findRateSpan(text);
  const fare = extractFare(text, rateSpan.start);
  const legs = extractLegs(text, rateSpan.end);

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
