// Hands-free voice driver for the quick-decide widget. Uses the Web Speech
// API (built into Chromium WebViews, including the Capacitor and TWA
// shells). When unsupported, the rest of the UI keeps working — the voice
// button just stays disabled.
//
// Speech grammar accepted:
//   "sept dollar quatre km huit minutes"
//   "douze cinquante, six kilomètres, dix minutes"
//   "7 dollar 4 km 8 minutes pickup 0.5"
// The parser is lenient: it scans the transcript for three numbers and tags
// them by the closest unit keyword. Order doesn't matter; "minutes 8 dollar
// 7 km 4" works the same as the canonical order.

export interface VoiceParseResult {
  fare: number | null;
  rideKm: number | null;
  rideMin: number | null;
  pickupKm: number | null;
  pickupMin: number | null;
  rawTranscript: string;
}

const FR_NUMBER_WORDS: Record<string, number> = {
  zéro: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5,
  six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12,
  treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20,
  trente: 30, quarante: 40, cinquante: 50, soixante: 60,
};

export function parseVoiceTranscript(raw: string): VoiceParseResult {
  const transcript = raw.toLowerCase().trim();
  const tokens = transcript
    .replace(/[,.]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  let fare: number | null = null;
  let rideKm: number | null = null;
  let rideMin: number | null = null;
  let pickupKm: number | null = null;
  let pickupMin: number | null = null;
  let inPickup = false;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === 'pickup' || tok === 'pickup' || tok === 'ramassage' || tok === 'recherche') {
      inPickup = true;
      continue;
    }
    if (tok === 'course' || tok === 'trajet' || tok === 'ride') {
      inPickup = false;
      continue;
    }

    const value = parseNumberToken(tok);
    if (value === null) continue;

    // Peek ahead for the unit
    const unitTok = tokens[i + 1] ?? '';
    if (/dollar|piastre|\$|tarif/.test(unitTok)) {
      fare = value;
      i++;
    } else if (/^km$|kilom[eè]tre/.test(unitTok)) {
      if (inPickup) pickupKm = value;
      else rideKm = value;
      i++;
    } else if (/minute|^min$/.test(unitTok)) {
      if (inPickup) pickupMin = value;
      else rideMin = value;
      i++;
    } else {
      // No unit attached — guess by position: 1st = fare, 2nd = km, 3rd = min
      if (fare === null) fare = value;
      else if (rideKm === null) rideKm = value;
      else if (rideMin === null) rideMin = value;
    }
  }

  return { fare, rideKm, rideMin, pickupKm, pickupMin, rawTranscript: raw };
}

function parseNumberToken(tok: string): number | null {
  // Digit-form first (10, 7.5, 12)
  const num = parseFloat(tok.replace(',', '.'));
  if (Number.isFinite(num)) return num;
  // French number words
  if (tok in FR_NUMBER_WORDS) return FR_NUMBER_WORDS[tok];
  return null;
}

// --- Recognition lifecycle ---------------------------------------------------

interface SpeechRecognitionEvent extends Event {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface WindowWithSpeech extends Window {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
}

export function isVoiceSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as WindowWithSpeech;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function getRecognition(): SpeechRecognitionLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as WindowWithSpeech;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = 'fr-CA';
  rec.continuous = false;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  return rec;
}

export function speak(text: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'fr-CA';
  utter.rate = 1.1;
  utter.volume = 1;
  window.speechSynthesis.speak(utter);
}
