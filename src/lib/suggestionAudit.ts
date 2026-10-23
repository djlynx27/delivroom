import { haversineKm } from '@/hooks/useUserLocation';
import { NEUTRAL_HUB_SCORE } from '@/lib/taxiMode';

/**
 * Lab-only sanity check of the Drive hero suggestion. Pure, client-side, no DB:
 * flags the failure modes we can actually detect from what the screen already
 * holds (score provenance, deadhead, river side, event expiry, ranking margin).
 * It does NOT judge real $/h or saturation — that needs trip data (trips table
 * is empty) and a live driver feed, so it is deliberately out of scope.
 */

export const AUDIT_FAR_KM = 5;
export const AUDIT_EVENT_ENDING_MIN = 15;
export const AUDIT_CLOSE_CALL_PTS = 3;

export type AuditLevel = 'ok' | 'warn' | 'bad';

export interface AuditCandidate {
  name: string;
  city_id: string;
  latitude: number;
  longitude: number;
  score: number;
  eventEndAt?: string;
}

export interface SuggestionAudit {
  level: AuditLevel;
  reasons: string[];
}

interface AuditInput {
  hero: AuditCandidate;
  others: AuditCandidate[];
  origin: { latitude: number; longitude: number };
  now: Date;
}

const km = (o: AuditInput['origin'], c: AuditCandidate): number =>
  haversineKm(o.latitude, o.longitude, c.latitude, c.longitude);

type Rule = (i: AuditInput) => string | null;

const RULES: readonly Rule[] = [
  ({ hero }) =>
    hero.score === NEUTRAL_HUB_SCORE || hero.score <= 0
      ? `Score ${hero.score} = valeur par défaut, pas une vraie mesure de demande`
      : null,
  ({ hero, origin }) =>
    km(origin, hero) > AUDIT_FAR_KM
      ? `${km(origin, hero).toFixed(1)} km à vide (> ${AUDIT_FAR_KM} km)`
      : null,
  // Nearest candidate overall tells which shore the driver is on.
  ({ hero, others, origin }) => {
    const nearest = [hero, ...others].reduce((a, b) => (km(origin, b) < km(origin, a) ? b : a));
    return nearest.city_id !== hero.city_id
      ? `Autre rive/ville que ta position (${nearest.city_id} → ${hero.city_id}), pont possible`
      : null;
  },
  ({ hero, now }) => {
    if (!hero.eventEndAt) return null;
    const minLeft = (new Date(hero.eventEndAt).getTime() - now.getTime()) / 60_000;
    return minLeft < AUDIT_EVENT_ENDING_MIN
      ? `Événement fini dans ${Math.max(0, Math.round(minLeft))} min`
      : null;
  },
  ({ hero, others, origin }) => {
    const second = others[0];
    return second && hero.score - second.score < AUDIT_CLOSE_CALL_PTS && km(origin, second) < km(origin, hero)
      ? `Écart de ${(hero.score - second.score).toFixed(1)} pts avec ${second.name}, plus proche`
      : null;
  },
];

export function auditSuggestion(input: AuditInput): SuggestionAudit {
  const reasons = RULES.flatMap((rule) => rule(input) ?? []);
  const level: AuditLevel = reasons.length === 0 ? 'ok' : reasons.length === 1 ? 'warn' : 'bad';
  return { level, reasons };
}
