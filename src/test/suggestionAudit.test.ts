import { auditSuggestion, type AuditCandidate } from '@/lib/suggestionAudit';
import { describe, expect, it } from 'vitest';

const origin = { latitude: 45.5559, longitude: -73.7231 };
const now = new Date('2026-10-22T20:00:00Z');
const c = (o: Partial<AuditCandidate>): AuditCandidate => ({
  name: 'X',
  city_id: 'lvl',
  latitude: 45.5583,
  longitude: -73.721,
  score: 80,
  ...o,
});

describe('auditSuggestion', () => {
  it('is ok for a close, real-scored, same-side pick', () => {
    const r = auditSuggestion({ hero: c({}), others: [c({ score: 60 })], origin, now });
    expect(r).toEqual({ level: 'ok', reasons: [] });
  });

  it('flags the neutral default score', () => {
    const r = auditSuggestion({ hero: c({ score: 50 }), others: [], origin, now });
    expect(r.level).toBe('warn');
  });

  it('flags far + other shore as bad', () => {
    const hero = c({ city_id: 'lng', latitude: 45.524, longitude: -73.5215 });
    const r = auditSuggestion({ hero, others: [c({ score: 70 })], origin, now });
    expect(r.level).toBe('bad');
  });

  it('flags an event ending in under 15 min', () => {
    const eventEndAt = new Date(now.getTime() + 5 * 60_000).toISOString();
    const r = auditSuggestion({ hero: c({ eventEndAt }), others: [], origin, now });
    expect(r.reasons[0]).toMatch(/5 min/);
  });

  it('flags a near-tie won against a closer runner-up', () => {
    const hero = c({ latitude: 45.58, score: 71 });
    const r = auditSuggestion({ hero, others: [c({ score: 70 })], origin, now });
    expect(r.level).toBe('warn');
  });
});
