/**
 * Évaluation « ouvert maintenant ? » pour les stations-service.
 *
 * Les horaires proviennent de Mapbox Search Box (`metadata.open_hours`), qui
 * utilise la convention Google Places :
 *   - `day` : 0 = dimanche … 6 = samedi
 *   - `time` : "HHMM" en heure locale du commerce (America/Toronto ici)
 *   - une période sans `close` signifie « ouvert 24h/24 »
 *
 * Tout est calculé en minutes-de-la-semaine (0 → 10079) pour gérer proprement
 * les plages qui débordent sur le lendemain (ex. 22:00 → 02:00).
 */

export const GAS_TIME_ZONE = 'America/Toronto';

const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

/** Une station qui ferme dans moins de ce délai est signalée « ferme bientôt ». */
export const CLOSING_SOON_MINUTES = 20;

export interface HoursPoint {
  /** 0 = dimanche … 6 = samedi */
  day: number;
  /** "HHMM" */
  time: string;
}

export interface HoursPeriod {
  open: HoursPoint;
  close?: HoursPoint | null;
}

export interface OpenHours {
  periods: HoursPeriod[];
}

export type OpenState = 'open' | 'closed' | 'unknown';

export interface OpenStatus {
  state: OpenState;
  /** Toujours vrai quand la station est ouverte 24h/24. */
  alwaysOpen: boolean;
  /** Minutes avant la fermeture (null si 24h/24 ou si fermé/inconnu). */
  minutesUntilClose: number | null;
  /** Minutes avant la prochaine ouverture (null si ouvert ou inconnu). */
  minutesUntilOpen: number | null;
  /** "HH:MM" de la fermeture en cours, pour affichage. */
  closesAt: string | null;
  /** "HH:MM" de la prochaine ouverture, pour affichage. */
  opensAt: string | null;
}

const UNKNOWN: OpenStatus = {
  state: 'unknown',
  alwaysOpen: false,
  minutesUntilClose: null,
  minutesUntilOpen: null,
  closesAt: null,
  opensAt: null,
};

const dayIndexByName: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: GAS_TIME_ZONE,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Minute-de-la-semaine courante dans le fuseau du Québec. */
export function currentWeekMinute(now: Date): number {
  const parts = weekdayFormatter.formatToParts(now);
  const lookup = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const day = dayIndexByName[lookup('weekday')] ?? 0;
  const hour = Number.parseInt(lookup('hour'), 10);
  const minute = Number.parseInt(lookup('minute'), 10);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
  return day * MINUTES_PER_DAY + hour * 60 + minute;
}

function pointToWeekMinute(point: HoursPoint): number | null {
  if (!Number.isInteger(point.day) || point.day < 0 || point.day > 6) return null;
  const raw = point.time?.padStart(4, '0');
  if (!raw || raw.length !== 4) return null;
  const hour = Number.parseInt(raw.slice(0, 2), 10);
  const minute = Number.parseInt(raw.slice(2), 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour > 24 || minute > 59) return null;
  return point.day * MINUTES_PER_DAY + hour * 60 + minute;
}

function formatWeekMinute(weekMinute: number): string {
  const inDay = ((weekMinute % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK;
  const hour = Math.floor((inDay % MINUTES_PER_DAY) / 60);
  const minute = inDay % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Une seule période sans heure de fermeture ⇒ 24h/24. */
function isAlwaysOpen(periods: HoursPeriod[]): boolean {
  if (periods.length === 1 && !periods[0]!.close) return true;
  // Certains fournisseurs encodent le 24/7 en 7 plages 00:00 → 00:00.
  return (
    periods.length === 7 &&
    periods.every(
      (p) => p.open.time === '0000' && (p.close?.time === '0000' || !p.close)
    )
  );
}

/**
 * Convertit les périodes en intervalles [début, fin[ de minutes-de-la-semaine.
 * Les plages qui débordent sur la semaine suivante sont dupliquées avec un
 * décalage de -1 semaine pour rester comparables à `weekMinute`.
 */
function toIntervals(periods: HoursPeriod[]): Array<[number, number]> {
  const intervals: Array<[number, number]> = [];

  for (const period of periods) {
    const start = pointToWeekMinute(period.open);
    if (start === null) continue;

    if (!period.close) {
      intervals.push([start, start + MINUTES_PER_DAY]);
      continue;
    }

    const rawEnd = pointToWeekMinute(period.close);
    if (rawEnd === null) continue;

    const end = rawEnd > start ? rawEnd : rawEnd + MINUTES_PER_WEEK;
    intervals.push([start, end]);
    // Miroir pour couvrir une plage qui a démarré la semaine précédente.
    intervals.push([start - MINUTES_PER_WEEK, end - MINUTES_PER_WEEK]);
  }

  return intervals;
}

/** Statut d'ouverture d'une station à l'instant `now`. */
export function getOpenStatus(
  hours: OpenHours | null | undefined,
  now: Date
): OpenStatus {
  const periods = hours?.periods;
  if (!periods || periods.length === 0) return UNKNOWN;

  if (isAlwaysOpen(periods)) {
    return {
      state: 'open',
      alwaysOpen: true,
      minutesUntilClose: null,
      minutesUntilOpen: null,
      closesAt: null,
      opensAt: null,
    };
  }

  const intervals = toIntervals(periods);
  if (intervals.length === 0) return UNKNOWN;

  const nowMinute = currentWeekMinute(now);

  for (const [start, end] of intervals) {
    if (nowMinute >= start && nowMinute < end) {
      return {
        state: 'open',
        alwaysOpen: false,
        minutesUntilClose: end - nowMinute,
        minutesUntilOpen: null,
        closesAt: formatWeekMinute(end),
        opensAt: null,
      };
    }
  }

  // Fermé : on cherche la prochaine ouverture dans la semaine glissante.
  // Les intervalles miroir (décalés de -1 semaine) ne servent qu'à détecter une
  // plage entamée la semaine précédente — les inclure ici donnerait des délais
  // négatifs.
  let bestWait = Number.POSITIVE_INFINITY;
  let bestStart: number | null = null;
  for (const [start] of intervals) {
    if (start < 0) continue;
    const wait = start >= nowMinute ? start - nowMinute : start + MINUTES_PER_WEEK - nowMinute;
    if (wait < bestWait) {
      bestWait = wait;
      bestStart = start;
    }
  }

  return {
    state: 'closed',
    alwaysOpen: false,
    minutesUntilClose: null,
    minutesUntilOpen: Number.isFinite(bestWait) ? bestWait : null,
    closesAt: null,
    opensAt: bestStart === null ? null : formatWeekMinute(bestStart),
  };
}

/** Libellé court pour l'UI : « 24h/24 », « ferme à 23:00 », « ouvre à 06:00 ». */
export function describeOpenStatus(status: OpenStatus): string {
  if (status.state === 'unknown') return 'Horaire inconnu';
  if (status.alwaysOpen) return 'Ouvert 24h/24';
  if (status.state === 'open') {
    if (
      status.minutesUntilClose !== null &&
      status.minutesUntilClose <= CLOSING_SOON_MINUTES
    ) {
      return `Ferme dans ${status.minutesUntilClose} min`;
    }
    return status.closesAt ? `Ouvert · ferme à ${status.closesAt}` : 'Ouvert';
  }
  return status.opensAt ? `Fermé · ouvre à ${status.opensAt}` : 'Fermé';
}
