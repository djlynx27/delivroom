import { describe, expect, it } from 'vitest';
import {
  currentWeekMinute,
  describeOpenStatus,
  getOpenStatus,
  type OpenHours,
} from '@/lib/gasHours';

/** Un instant précis exprimé en heure locale du Québec (EDT en juillet, UTC-4). */
function edt(day: string, time: string): Date {
  return new Date(`${day}T${time}-04:00`);
}

const NINE_TO_NINE: OpenHours = {
  periods: Array.from({ length: 7 }, (_, day) => ({
    open: { day, time: '0900' },
    close: { day, time: '2100' },
  })),
};

const OVERNIGHT: OpenHours = {
  // Ouvre 22:00 le vendredi (day 5), ferme 04:00 le samedi (day 6).
  periods: [{ open: { day: 5, time: '2200' }, close: { day: 6, time: '0400' } }],
};

const ALWAYS: OpenHours = {
  periods: [{ open: { day: 0, time: '0000' } }],
};

describe('currentWeekMinute', () => {
  it('convertit en minute-de-la-semaine dans le fuseau du Québec', () => {
    // Jeudi 31 juillet 2026, 14:30 EDT. Jeudi = jour 4.
    expect(currentWeekMinute(edt('2026-07-30', '14:30'))).toBe(4 * 1440 + 14 * 60 + 30);
  });

  it('utilise l’heure du Québec, pas celle du navigateur', () => {
    // 01:30 UTC le vendredi = 21:30 EDT le jeudi.
    expect(currentWeekMinute(new Date('2026-07-31T01:30:00Z'))).toBe(
      4 * 1440 + 21 * 60 + 30
    );
  });
});

describe('getOpenStatus', () => {
  it('retourne "unknown" sans horaire', () => {
    expect(getOpenStatus(null, edt('2026-07-30', '14:00')).state).toBe('unknown');
    expect(getOpenStatus({ periods: [] }, edt('2026-07-30', '14:00')).state).toBe(
      'unknown'
    );
  });

  it('reconnaît le 24h/24 via une période sans fermeture', () => {
    const status = getOpenStatus(ALWAYS, edt('2026-07-30', '03:00'));
    expect(status.state).toBe('open');
    expect(status.alwaysOpen).toBe(true);
  });

  it('reconnaît le 24h/24 encodé en 7 plages 00:00 → 00:00', () => {
    const sevenDays: OpenHours = {
      periods: Array.from({ length: 7 }, (_, day) => ({
        open: { day, time: '0000' },
        close: { day, time: '0000' },
      })),
    };
    expect(getOpenStatus(sevenDays, edt('2026-07-30', '03:00')).alwaysOpen).toBe(true);
  });

  it('ouvre pendant la plage et calcule le temps restant', () => {
    const status = getOpenStatus(NINE_TO_NINE, edt('2026-07-30', '20:30'));
    expect(status.state).toBe('open');
    expect(status.minutesUntilClose).toBe(30);
    expect(status.closesAt).toBe('21:00');
  });

  it('ferme en dehors de la plage et annonce la prochaine ouverture', () => {
    const status = getOpenStatus(NINE_TO_NINE, edt('2026-07-30', '22:30'));
    expect(status.state).toBe('closed');
    expect(status.opensAt).toBe('09:00');
    // 22:30 jeudi → 09:00 vendredi = 10h30.
    expect(status.minutesUntilOpen).toBe(630);
  });

  it('gère une plage de nuit qui déborde sur le lendemain', () => {
    // Samedi 01:00 : encore dans la plage ouverte vendredi 22:00.
    expect(getOpenStatus(OVERNIGHT, edt('2026-08-01', '01:00')).state).toBe('open');
    // Samedi 05:00 : fermé.
    expect(getOpenStatus(OVERNIGHT, edt('2026-08-01', '05:00')).state).toBe('closed');
    // Vendredi 23:00 : ouvert.
    expect(getOpenStatus(OVERNIGHT, edt('2026-07-31', '23:00')).state).toBe('open');
  });

  it('gère une plage de nuit qui déborde sur la semaine suivante', () => {
    const sundayNight: OpenHours = {
      // Samedi (6) 23:00 → dimanche (0) 05:00, donc à cheval sur la fin de semaine.
      periods: [{ open: { day: 6, time: '2300' }, close: { day: 0, time: '0500' } }],
    };
    expect(getOpenStatus(sundayNight, edt('2026-08-02', '02:00')).state).toBe('open');
    expect(getOpenStatus(sundayNight, edt('2026-08-02', '06:00')).state).toBe('closed');
  });

  it('traite une plage sans fermeture comme ouverte 24h, au sein d’un horaire mixte', () => {
    const mixed: OpenHours = {
      periods: [
        // Jeudi (4) : ouvert en continu, aucune heure de fermeture publiée.
        { open: { day: 4, time: '0000' } },
        { open: { day: 5, time: '0900' }, close: { day: 5, time: '1700' } },
      ],
    };
    expect(getOpenStatus(mixed, edt('2026-07-30', '23:00')).state).toBe('open');
    expect(getOpenStatus(mixed, edt('2026-07-30', '23:00')).alwaysOpen).toBe(false);
    expect(getOpenStatus(mixed, edt('2026-07-31', '20:00')).state).toBe('closed');
  });

  it('ignore les périodes malformées', () => {
    const broken: OpenHours = {
      periods: [
        { open: { day: 9, time: '0900' }, close: { day: 9, time: '2100' } },
        { open: { day: 4, time: 'zzzz' }, close: { day: 4, time: '2100' } },
      ],
    };
    expect(getOpenStatus(broken, edt('2026-07-30', '14:00')).state).toBe('unknown');
  });
});

describe('describeOpenStatus', () => {
  it('signale une fermeture imminente', () => {
    const status = getOpenStatus(NINE_TO_NINE, edt('2026-07-30', '20:50'));
    expect(describeOpenStatus(status)).toBe('Ferme dans 10 min');
  });

  it('affiche l’heure de fermeture quand il reste du temps', () => {
    const status = getOpenStatus(NINE_TO_NINE, edt('2026-07-30', '12:00'));
    expect(describeOpenStatus(status)).toBe('Ouvert · ferme à 21:00');
  });

  it('se contente de "Ouvert"/"Fermé" sans heure exploitable', () => {
    const base = {
      alwaysOpen: false,
      minutesUntilClose: null,
      minutesUntilOpen: null,
      closesAt: null,
      opensAt: null,
    };
    expect(describeOpenStatus({ ...base, state: 'open' })).toBe('Ouvert');
    expect(describeOpenStatus({ ...base, state: 'closed' })).toBe('Fermé');
  });

  it('affiche 24h/24 et horaire inconnu', () => {
    expect(describeOpenStatus(getOpenStatus(ALWAYS, edt('2026-07-30', '03:00')))).toBe(
      'Ouvert 24h/24'
    );
    expect(describeOpenStatus(getOpenStatus(null, edt('2026-07-30', '03:00')))).toBe(
      'Horaire inconnu'
    );
  });
});
