// Append-only log of accepted Hypra (Central Bonjour) dispatch calls, kept
// OUT of the shift tally on purpose: a Hypra card has no fare at accept time
// (taximeter computes it at pickup), so logging it as a $0 ride would skew
// ride count and $/h — and the tally rolls over daily, while the 30-day
// "is the Hypra subscription worth it" review needs history across days.
//
// `taximeterFare` is null until the driver enters the final amount (planned,
// not built yet) — the field exists so old entries stay valid then.

const KEY = 'delivroom-hypra-calls';
const MAX_ENTRIES = 500; // ~months of calls; bounds localStorage growth

export interface HypraCall {
  ts: number; // epoch ms
  pickupKm: number;
  /** Cap mode the driver had selected when accepting. */
  mode: 'strict' | 'large';
  taximeterFare: number | null;
}

export function loadHypraCalls(): HypraCall[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as HypraCall[]) : [];
  } catch {
    return [];
  }
}

export function recordHypraCall(call: Omit<HypraCall, 'ts' | 'taximeterFare'>): HypraCall[] {
  const calls = [...loadHypraCalls(), { ts: Date.now(), taximeterFare: null, ...call }].slice(-MAX_ENTRIES);
  try {
    localStorage.setItem(KEY, JSON.stringify(calls));
  } catch {
    /* storage full/blocked — the accept itself must never fail on this */
  }
  return calls;
}
