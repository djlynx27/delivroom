import type { TripWithZone } from '@/hooks/useTrips';
import {
  buildLearningPersistencePayload,
  buildShiftPersistencePayload,
  buildSimilarContextRpcArgs,
  buildUserPingCacheKey,
  buildUserPingMatchRpcArgs,
  buildZoneSimilarContextRpcArgs,
  encodeContextVector,
  encodeUserPingContextVector,
  encodeZoneContextVector,
  findSimilarContextsForTrip,
  findSimilarContextsForZoneContext,
  findSimilarUserPings,
  recordUserPing,
  shouldThrottleUserPing,
  syncLearningAggregates,
  syncShiftLearning,
} from '@/lib/learningSync';
import { DEFAULT_WEIGHTS } from '@/lib/scoringEngine';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Supabase client mock — covers all async Supabase-dependent functions
// ---------------------------------------------------------------------------

const mockUpsert = vi.hoisted(() => vi.fn());
const mockInsert = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockEq = vi.hoisted(() => vi.fn());
const mockRpc = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      upsert: mockUpsert,
      insert: mockInsert,
      delete: mockDelete,
    }),
    rpc: mockRpc,
  },
}));

/**
 * Creates a thenable object returned by `insert()` that:
 *  - can be `await`ed directly → resolves to `{ error }`
 *  - supports `.select().single()` chain → resolves to `{ data, error }`
 */
function makeInsertChain(error: Error | null = null, sessionId = 42) {
  const single = vi.fn().mockResolvedValue({ data: { id: sessionId }, error });
  const select = vi.fn().mockReturnValue({ single });
  return {
    then: (
      resolve: (v: { error: Error | null }) => unknown,
      reject?: (r: unknown) => unknown
    ) => Promise.resolve({ error }).then(resolve as never, reject as never),
    select,
  };
}

const trips: TripWithZone[] = [
  {
    id: '1',
    created_at: '2026-03-15T22:00:00.000Z',
    distance_km: 12,
    earnings: 42,
    ended_at: '2026-03-15T22:45:00.000Z',
    experiment: false,
    notes: null,
    started_at: '2026-03-15T22:00:00.000Z',
    tips: 6,
    zone_id: 'mtl-cb',
    zone_score: 62,
    platform: 'lyft',
    source: 'real',
    user_id: null,
    zones: { name: 'Centre Bell', current_score: 60, type: 'événements' },
  },
  {
    id: '2',
    created_at: '2026-03-16T07:00:00.000Z',
    distance_km: 10,
    earnings: 24,
    ended_at: '2026-03-16T07:40:00.000Z',
    experiment: false,
    notes: null,
    started_at: '2026-03-16T07:00:00.000Z',
    tips: 2,
    zone_id: 'mtl-bq',
    zone_score: 55,
    platform: 'uber',
    source: 'real',
    user_id: null,
    zones: { name: 'Station Berri-UQAM', current_score: 53, type: 'métro' },
  },
];

describe('learning sync payloads', () => {
  it('encodes a 16d context vector', () => {
    const vector = encodeContextVector(trips[0]!);
    expect(vector).toHaveLength(16);
  });

  it('builds typed rpc args for similar context lookup', () => {
    const args = buildSimilarContextRpcArgs(trips[0]!, 7);

    expect(args).toEqual({
      query_zone_id: 'mtl-cb',
      match_count: 7,
      query_vector: expect.stringMatching(/^\[[^\]]+\]$/),
    });
  });

  it('encodes a zone context vector in 16 dimensions', () => {
    const vector = encodeZoneContextVector({
      zoneId: 'mtl-cb',
      zoneType: 'événements',
      currentScore: 67,
      now: new Date('2026-03-16T21:30:00.000Z'),
      trafficCongestion: 0.4,
      weatherDemandBoostPoints: 12,
    });

    expect(vector).toHaveLength(16);
    expect(vector[14]).toBe(1);
  });

  it('builds zone rpc args for live similarity lookup', () => {
    const args = buildZoneSimilarContextRpcArgs(
      {
        zoneId: 'mtl-bq',
        zoneType: 'métro',
        currentScore: 54,
        now: new Date('2026-03-16T08:00:00.000Z'),
      },
      4
    );

    expect(args).toEqual({
      query_zone_id: 'mtl-bq',
      match_count: 4,
      query_vector: expect.stringMatching(/^\[[^\]]+\]$/),
    });
  });

  it('returns null rpc args for trips without zone id', () => {
    const args = buildSimilarContextRpcArgs(
      {
        ...trips[0]!,
        zone_id: null,
      },
      5
    );

    expect(args).toBeNull();
  });

  it('returns null zone rpc args for invalid zone id', () => {
    const args = buildZoneSimilarContextRpcArgs(
      {
        zoneId: '',
        now: new Date('2026-03-16T08:00:00.000Z'),
      },
      3
    );

    expect(args).toBeNull();
  });

  it('builds a deterministic cache key for user pings', () => {
    expect(buildUserPingCacheKey('driver-1', 'zone-1', 'libre-auto-pick')).toBe(
      'driver-1:zone-1:libre-auto-pick'
    );
  });

  it('throttles duplicate user pings during cooldown', () => {
    expect(shouldThrottleUserPing(1_000, 1_500, 1_000)).toBe(true);
    expect(shouldThrottleUserPing(1_000, 2_500, 1_000)).toBe(false);
    expect(shouldThrottleUserPing(null, 2_500, 1_000)).toBe(false);
  });

  it('builds aggregate payloads for EMA and beliefs', () => {
    const payload = buildLearningPersistencePayload(trips, DEFAULT_WEIGHTS);
    expect(payload.emaPatterns.length).toBeGreaterThan(0);
    expect(payload.beliefs.length).toBeGreaterThan(0);
    expect(payload.weightHistory.prediction_mae).toBeGreaterThanOrEqual(0);
  });

  it('builds shift payloads for sessions and predictions', () => {
    const payload = buildShiftPersistencePayload(
      trips,
      '2026-03-15T00:00:00.000Z',
      '2026-03-16T23:59:59.000Z',
      DEFAULT_WEIGHTS
    );
    expect(payload.session.total_rides).toBe(2);
    expect(payload.sessionZones).toHaveLength(2);
    expect(payload.predictions).toHaveLength(2);
    expect(payload.demandPatterns).toHaveLength(2);
    expect(payload.demandPatterns[0]?.context_vector).toMatch(/^\[[^\]]+\]$/);
  });

  it('skips zone-scoped rows when a trip has no zone id', () => {
    const payload = buildShiftPersistencePayload(
      [
        ...trips,
        {
          ...trips[0]!,
          id: '3',
          zone_id: null,
          zones: null,
        },
      ],
      '2026-03-15T00:00:00.000Z',
      '2026-03-16T23:59:59.000Z',
      DEFAULT_WEIGHTS
    );

    expect(payload.session.total_rides).toBe(3);
    expect(payload.sessionZones).toHaveLength(2);
    expect(payload.predictions).toHaveLength(2);
    expect(payload.demandPatterns).toHaveLength(2);
  });

  it('skips incomplete trips when building prediction payloads', () => {
    const payload = buildShiftPersistencePayload(
      [
        ...trips,
        {
          ...trips[0]!,
          id: '3',
          ended_at: null,
          earnings: 80,
          tips: 20,
        },
      ],
      '2026-03-15T00:00:00.000Z',
      '2026-03-16T23:59:59.000Z',
      DEFAULT_WEIGHTS
    );

    expect(payload.session.total_rides).toBe(3);
    expect(payload.predictions).toHaveLength(2);
    expect(payload.demandPatterns).toHaveLength(2);
  });
});

describe('encodeUserPingContextVector', () => {
  const baseInput = {
    zoneId: 'mtl-cb',
    zoneType: 'événements',
    currentScore: 70,
    now: new Date('2026-03-22T21:00:00.000Z'),
    trafficCongestion: 0.5,
    weatherDemandBoostPoints: 10,
  };

  it('encodes a 16-dimensional vector', () => {
    const vector = encodeUserPingContextVector(baseInput);
    expect(vector).toHaveLength(16);
  });

  it('sets conservative presence flag at index 11', () => {
    const withPresence = encodeUserPingContextVector({
      ...baseInput,
      conservativePresence: true,
    });
    const withoutPresence = encodeUserPingContextVector({
      ...baseInput,
      conservativePresence: false,
    });
    expect(withPresence[11]).toBe(1);
    expect(withoutPresence[11]).toBe(0);
  });

  it('normalizes distance, lyft demand and wait time', () => {
    const vector = encodeUserPingContextVector({
      ...baseInput,
      distanceKm: 20,
      lyftDemandLevel: 10,
      estimatedWaitMin: 20,
    });
    // normalizedDistance = 20/20 = 1.0 → index 7
    // normalizedLyftDemand = 10/10 = 1.0 → index 8
    // normalizedWait = 20/20 = 1.0 → index 9
    expect(vector[7]).toBe(1);
    expect(vector[8]).toBe(1);
    expect(vector[9]).toBe(1);
  });

  it('clamps oversized inputs to 1', () => {
    const vector = encodeUserPingContextVector({
      ...baseInput,
      distanceKm: 999,
      lyftDemandLevel: 999,
      estimatedWaitMin: 999,
    });
    expect(vector[7]).toBe(1);
    expect(vector[8]).toBe(1);
    expect(vector[9]).toBe(1);
  });

  it('uses zero defaults for optional fields', () => {
    const vector = encodeUserPingContextVector(baseInput);
    // distanceKm, lyftDemandLevel, estimatedWaitMin default to 0
    expect(vector[7]).toBe(0);
    expect(vector[8]).toBe(0);
    expect(vector[9]).toBe(0);
  });
});

describe('buildUserPingMatchRpcArgs', () => {
  const input = {
    zoneId: 'mtl-cb',
    zoneType: 'événements',
    currentScore: 70,
    now: new Date('2026-03-22T21:00:00.000Z'),
  };

  it('builds valid rpc args for a known driver', () => {
    const args = buildUserPingMatchRpcArgs('fp-123', input, 5);
    expect(args).toMatchObject({
      query_driver_fingerprint: 'fp-123',
      query_platform: 'lyft',
      query_zone_id: 'mtl-cb',
      match_count: 5,
    });
    expect(args!.query_vector).toMatch(/^\[[^\]]+\]$/);
  });

  it('returns null when driver fingerprint is empty', () => {
    expect(buildUserPingMatchRpcArgs('', input)).toBeNull();
  });

  it('returns null when zone id is empty', () => {
    expect(
      buildUserPingMatchRpcArgs('fp-123', { ...input, zoneId: '' })
    ).toBeNull();
  });

  it('clamps matchCount to at least 1', () => {
    const args = buildUserPingMatchRpcArgs('fp-123', input, 0);
    expect(args!.match_count).toBe(1);
  });
});

describe('encodeContextVector — platform and zone type branches', () => {
  const makeTrip = (overrides: Partial<TripWithZone>): TripWithZone => ({
    id: 't1',
    created_at: '2026-03-15T22:00:00.000Z',
    distance_km: 10,
    earnings: 30,
    ended_at: '2026-03-15T22:45:00.000Z',
    experiment: false,
    notes: null,
    started_at: '2026-03-15T22:00:00.000Z',
    tips: 0,
    zone_id: 'mtl-cb',
    zone_score: 60,
    platform: 'lyft',
    source: 'real',
    user_id: null,
    zones: { name: 'Centre Bell', current_score: 60, type: 'événements' },
    ...overrides,
  });

  it('sets uber one-hot at index 8', () => {
    const vector = encodeContextVector(makeTrip({ platform: 'uber' }));
    expect(vector[8]).toBe(1);
    expect(vector[9]).toBe(0);
    expect(vector[10]).toBe(0);
  });

  it('sets lyft one-hot at index 9', () => {
    const vector = encodeContextVector(makeTrip({ platform: 'lyft' }));
    expect(vector[8]).toBe(0);
    expect(vector[9]).toBe(1);
    expect(vector[10]).toBe(0);
  });

  it('sets taxi one-hot at index 10', () => {
    const vector = encodeContextVector(makeTrip({ platform: 'taxi' }));
    expect(vector[8]).toBe(0);
    expect(vector[9]).toBe(0);
    expect(vector[10]).toBe(1);
  });

  it('sets nightlife flag at index 14 for nightlife zone', () => {
    const vector = encodeContextVector(
      makeTrip({
        zones: { name: 'Crescent', current_score: 70, type: 'nightlife' },
      })
    );
    expect(vector[14]).toBe(1);
  });

  it('clears nightlife flag for non-event zone', () => {
    const vector = encodeContextVector(
      makeTrip({
        zones: { name: 'NDG', current_score: 55, type: 'résidentiel' },
      })
    );
    expect(vector[14]).toBe(0);
  });

  it('sets winter flag at index 13 for winter month (January)', () => {
    const vector = encodeContextVector(
      makeTrip({
        started_at: '2026-01-10T22:00:00.000Z',
        ended_at: '2026-01-10T23:00:00.000Z',
      })
    );
    expect(vector[13]).toBe(1); // isWinter = 1
  });

  it('clears winter flag for summer month (July)', () => {
    const vector = encodeContextVector(
      makeTrip({
        started_at: '2026-07-10T22:00:00.000Z',
        ended_at: '2026-07-10T23:00:00.000Z',
      })
    );
    expect(vector[13]).toBe(0); // isWinter = 0
  });
});

describe('buildShiftPersistencePayload — date filtering', () => {
  const trips: TripWithZone[] = [
    {
      id: '1',
      created_at: '2026-03-15T22:00:00.000Z',
      distance_km: 12,
      earnings: 42,
      ended_at: '2026-03-15T22:45:00.000Z',
      experiment: false,
      notes: null,
      started_at: '2026-03-15T22:00:00.000Z',
      tips: 6,
      zone_id: 'mtl-cb',
      zone_score: 62,
      platform: 'lyft',
      source: 'real',
      user_id: null,
      zones: { name: 'Centre Bell', current_score: 60, type: 'événements' },
    },
    {
      id: '2',
      created_at: '2026-03-18T07:00:00.000Z',
      distance_km: 8,
      earnings: 20,
      ended_at: '2026-03-18T07:35:00.000Z',
      experiment: false,
      notes: null,
      started_at: '2026-03-18T07:00:00.000Z',
      tips: 2,
      zone_id: 'mtl-bq',
      zone_score: 50,
      platform: 'uber',
      source: 'real',
      user_id: null,
      zones: { name: 'Berri-UQAM', current_score: 50, type: 'métro' },
    },
  ];

  it('only includes trips within the shift period', () => {
    // Only trip 1 falls within this narrow window
    const payload = buildShiftPersistencePayload(
      trips,
      '2026-03-15T00:00:00.000Z',
      '2026-03-16T00:00:00.000Z',
      DEFAULT_WEIGHTS
    );
    expect(payload.session.total_rides).toBe(1);
    expect(payload.sessionZones).toHaveLength(1);
  });

  it('handles an empty trip list gracefully', () => {
    const payload = buildShiftPersistencePayload(
      [],
      '2026-03-15T00:00:00.000Z',
      '2026-03-16T00:00:00.000Z',
      DEFAULT_WEIGHTS
    );
    expect(payload.session.total_rides).toBe(0);
    expect(payload.sessionZones).toHaveLength(0);
    expect(payload.predictions).toHaveLength(0);
  });
});

// ===========================================================================
// Async Supabase-backed functions
// ===========================================================================

const sharedTrips: TripWithZone[] = [
  {
    id: 'a1',
    created_at: '2026-03-15T22:00:00.000Z',
    distance_km: 12,
    earnings: 42,
    ended_at: '2026-03-15T22:45:00.000Z',
    experiment: false,
    notes: null,
    started_at: '2026-03-15T22:00:00.000Z',
    tips: 6,
    zone_id: 'mtl-cb',
    zone_score: 62,
    platform: 'lyft',
    source: 'real',
    user_id: null,
    zones: { name: 'Centre Bell', current_score: 60, type: 'événements' },
  },
];

describe('syncLearningAggregates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsert.mockResolvedValue({ error: null });
    mockInsert.mockImplementation(() => makeInsertChain());
    mockDelete.mockReturnValue({ eq: mockEq });
    mockEq.mockResolvedValue({ error: null });
  });

  it('syncs ema patterns, beliefs and weights — happy path', async () => {
    const result = await syncLearningAggregates(sharedTrips, DEFAULT_WEIGHTS);

    expect(result.ok).toBe(true);
    expect(result.syncedCounts.emaPatterns).toBeGreaterThanOrEqual(0);
    expect(result.syncedCounts.beliefs).toBeGreaterThanOrEqual(0);
    expect(result.message).toContain('synchronisés');
  });

  it('returns ok: false when ema_patterns upsert fails', async () => {
    mockUpsert.mockResolvedValueOnce({
      error: new Error('EMA DB error'),
    });

    const result = await syncLearningAggregates(sharedTrips, DEFAULT_WEIGHTS);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('EMA DB error');
  });

  it('returns ok: false when zone_beliefs upsert fails', async () => {
    mockUpsert
      .mockResolvedValueOnce({ error: null }) // ema_patterns succeeds
      .mockResolvedValueOnce({ error: new Error('Belief error') });

    const result = await syncLearningAggregates(sharedTrips, DEFAULT_WEIGHTS);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Belief error');
  });

  it('returns ok: false when weight_history insert fails', async () => {
    mockUpsert.mockResolvedValue({ error: null });
    mockInsert.mockImplementation(() =>
      makeInsertChain(new Error('Weight insert failed'))
    );

    const result = await syncLearningAggregates(sharedTrips, DEFAULT_WEIGHTS);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Weight insert failed');
  });

  it('returns ok: false and fallback message on unexpected throw', async () => {
    mockUpsert.mockRejectedValueOnce(new Error('Unexpected network error'));

    const result = await syncLearningAggregates(sharedTrips, DEFAULT_WEIGHTS);

    expect(result.ok).toBe(false);
    expect(result.message).toBe('Unexpected network error');
  });
});

describe('syncShiftLearning', () => {
  const START = '2026-03-15T20:00:00.000Z';
  const END = '2026-03-15T23:59:59.000Z';

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsert.mockResolvedValue({ error: null });
    // Default: all inserts succeed; session insert returns { id: 99 }
    mockInsert.mockImplementation(() => makeInsertChain(null, 99));
    mockDelete.mockReturnValue({ eq: mockEq });
    mockEq.mockResolvedValue({ error: null });
  });

  it('syncs a complete shift — happy path', async () => {
    const result = await syncShiftLearning(
      sharedTrips,
      START,
      END,
      DEFAULT_WEIGHTS
    );

    expect(result.ok).toBe(true);
    expect(result.sessionId).toBe(99);
    expect(result.syncedCounts.emaPatterns).toBeGreaterThanOrEqual(0);
    expect(result.message).toContain('Supabase');
  });

  it('returns aggregate failure immediately when syncLearningAggregates fails', async () => {
    // Make ema_patterns upsert fail → syncLearningAggregates returns ok: false
    mockUpsert.mockResolvedValueOnce({
      error: new Error('Aggregate fail'),
    });

    const result = await syncShiftLearning(
      sharedTrips,
      START,
      END,
      DEFAULT_WEIGHTS
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Aggregate fail');
  });

  it('cleans up and returns ok: false when session insert fails', async () => {
    mockUpsert.mockResolvedValue({ error: null });
    // 1st insert: weight_history (success in syncLearningAggregates)
    // 2nd insert: sessions → fails
    mockInsert
      .mockImplementationOnce(() => makeInsertChain(null)) // weight_history
      .mockImplementationOnce(() =>
        makeInsertChain(new Error('Session failed'), 0)
      ); // sessions

    const result = await syncShiftLearning(
      sharedTrips,
      START,
      END,
      DEFAULT_WEIGHTS
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Session failed');
  });

  it('handles empty trips inside shift window gracefully', async () => {
    // Trips exist but none fall within the narrow shift window
    const result = await syncShiftLearning(
      sharedTrips,
      '2026-03-16T00:00:00.000Z', // starts after trip ended
      '2026-03-16T06:00:00.000Z',
      DEFAULT_WEIGHTS
    );

    expect(result.ok).toBe(true);
    expect(result.syncedCounts.sessionZones).toBe(0);
    expect(result.syncedCounts.predictions).toBe(0);
  });

  it('cleans up session and session_zones when session_zones insert fails after successful session insert', async () => {
    mockUpsert.mockResolvedValue({ error: null });
    // Call order for mockInsert inside a full run:
    // #1 = weight_history (direct await, from syncLearningAggregates)
    // #2 = sessions (.select().single(), from syncShiftLearning) → SUCCESS → sessionId = 99
    // #3 = session_zones (direct await) → FAIL → triggers cleanup
    mockInsert
      .mockImplementationOnce(() => makeInsertChain(null)) // weight_history
      .mockImplementationOnce(() => makeInsertChain(null, 99)) // sessions ok
      .mockImplementationOnce(() =>
        makeInsertChain(new Error('session_zones DB error'))
      ); // session_zones fail

    const result = await syncShiftLearning(
      sharedTrips,
      START,
      END,
      DEFAULT_WEIGHTS
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('session_zones DB error');
    // Cleanup should have fired two delete() calls
    expect(mockDelete).toHaveBeenCalledTimes(2);
  });
});

describe('findSimilarContextsForTrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok: false for a trip without zone_id', async () => {
    const tripNoZone = { ...sharedTrips[0]!, zone_id: null };
    const result = await findSimilarContextsForTrip(tripNoZone);

    expect(result.ok).toBe(false);
    expect(result.matches).toHaveLength(0);
    expect(result.message).toContain('zone');
  });

  it('returns matches and computed averages on success', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          id: 1,
          zone_id: 'mtl-cb',
          actual_earnings_per_hour: 48,
          similarity: 0.92,
          created_at: '2026-03-01T22:00:00.000Z',
        },
        {
          id: 2,
          zone_id: 'mtl-cb',
          actual_earnings_per_hour: 52,
          similarity: 0.88,
          created_at: '2026-03-02T22:00:00.000Z',
        },
      ],
      error: null,
    });

    const result = await findSimilarContextsForTrip(sharedTrips[0]!);

    expect(result.ok).toBe(true);
    expect(result.matches).toHaveLength(2);
    expect(result.averageEarningsPerHour).toBeCloseTo(50, 0);
    expect(result.averageSimilarity).toBeCloseTo(0.9, 1);
    expect(result.message).toContain('récupérés');
  });

  it('returns ok: true with empty message when rpc returns no data', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const result = await findSimilarContextsForTrip(sharedTrips[0]!);

    expect(result.ok).toBe(true);
    expect(result.matches).toHaveLength(0);
    expect(result.averageEarningsPerHour).toBe(0);
    expect(result.message).toContain('Aucun');
  });

  it('returns migration message when error mentions match_similar_contexts', async () => {
    // Use an actual Error so getErrorMessage extracts the message for migration detection
    mockRpc.mockResolvedValue({
      data: null,
      error: new Error('function match_similar_contexts not found'),
    });

    const result = await findSimilarContextsForTrip(sharedTrips[0]!);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('migration');
  });

  it('returns migration message when error mentions demand_patterns', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: new Error('relation demand_patterns does not exist'),
    });

    const result = await findSimilarContextsForTrip(sharedTrips[0]!);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('migration');
  });

  it('returns generic error message for non-migration rpc errors', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: new Error('Network timeout'),
    });

    const result = await findSimilarContextsForTrip(sharedTrips[0]!);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Network timeout');
  });
});

describe('findSimilarContextsForZoneContext', () => {
  const zoneCtx = {
    zoneId: 'mtl-cb',
    zoneType: 'événements' as const,
    currentScore: 70,
    now: new Date('2026-03-22T21:00:00.000Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok: false for empty zoneId', async () => {
    const result = await findSimilarContextsForZoneContext({
      ...zoneCtx,
      zoneId: '',
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('invalide');
  });

  it('returns matches and averages on success', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          id: 10,
          zone_id: 'mtl-cb',
          actual_earnings_per_hour: 45,
          similarity: 0.85,
          created_at: '2026-03-10T21:00:00.000Z',
        },
      ],
      error: null,
    });

    const result = await findSimilarContextsForZoneContext(zoneCtx);

    expect(result.ok).toBe(true);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.zoneId).toBe('mtl-cb');
    expect(result.averageEarningsPerHour).toBe(45);
  });

  it('returns ok: true with empty matches when rpc returns no data', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const result = await findSimilarContextsForZoneContext(zoneCtx);

    expect(result.ok).toBe(true);
    expect(result.matches).toHaveLength(0);
    expect(result.message).toContain('Aucun');
  });

  it('returns migration message on schema cache error', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: new Error('schema cache mismatch for match_similar_contexts'),
    });

    const result = await findSimilarContextsForZoneContext(zoneCtx);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('migration');
  });

  it('returns generic error for non-migration failure', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: new Error('DB connection refused'),
    });

    const result = await findSimilarContextsForZoneContext(zoneCtx);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('DB connection refused');
  });
});

describe('findSimilarUserPings', () => {
  const pingCtx = {
    zoneId: 'mtl-cb',
    zoneType: 'événements' as const,
    currentScore: 70,
    now: new Date('2026-03-22T21:00:00.000Z'),
    distanceKm: 2,
    lyftDemandLevel: 6,
    estimatedWaitMin: 3,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok: false when driverFingerprint is empty', async () => {
    const result = await findSimilarUserPings('', pingCtx);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('invalide');
  });

  it('returns ok: false when zoneId is empty', async () => {
    const result = await findSimilarUserPings('fp-123', {
      ...pingCtx,
      zoneId: '',
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('invalide');
  });

  it('returns matches and averages on success', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          id: 'uuid-1',
          zone_id: 'mtl-cb',
          success_score: 0.8,
          similarity: 0.9,
          created_at: '2026-03-01T22:00:00.000Z',
        },
        {
          id: 'uuid-2',
          zone_id: 'mtl-cb',
          success_score: 0.6,
          similarity: 0.75,
          created_at: '2026-03-02T22:00:00.000Z',
        },
      ],
      error: null,
    });

    const result = await findSimilarUserPings('fp-123', pingCtx);

    expect(result.ok).toBe(true);
    expect(result.matches).toHaveLength(2);
    expect(result.averageSuccessScore).toBeCloseTo(0.7, 1);
    expect(result.averageSimilarity).toBeCloseTo(0.825, 2);
    expect(result.message).toContain('récupérées');
  });

  it('returns ok: true with empty matches and zero averages', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const result = await findSimilarUserPings('fp-123', pingCtx);

    expect(result.ok).toBe(true);
    expect(result.matches).toHaveLength(0);
    expect(result.averageSuccessScore).toBe(0);
    expect(result.averageSimilarity).toBe(0);
    expect(result.message).toContain('Aucune');
  });

  it('returns ok: false with error message on rpc failure', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: new Error('RPC not found'),
    });

    const result = await findSimilarUserPings('fp-123', pingCtx);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('RPC not found');
  });
});

describe('recordUserPing', () => {
  const driverFp = 'driver-fp-001';
  const pingInput = {
    zoneId: 'mtl-cb',
    zoneType: 'événements' as const,
    currentScore: 70,
    now: new Date('2026-03-22T21:00:00.000Z'),
    successScore: 0.9,
    metadata: { source: 'auto-pick' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockInsert.mockImplementation(() => makeInsertChain());
  });

  it('returns ok: false when driverFingerprint is empty', async () => {
    const result = await recordUserPing('', pingInput);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('incomplet');
  });

  it('returns ok: false when zoneId is empty', async () => {
    const result = await recordUserPing(driverFp, { ...pingInput, zoneId: '' });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('incomplet');
  });

  it('inserts a ping and returns ok: true', async () => {
    const result = await recordUserPing(driverFp, pingInput);

    expect(result.ok).toBe(true);
    expect(result.message).toContain('enregistré');
    expect(mockInsert).toHaveBeenCalledOnce();
  });

  it('throttles duplicate pings within cooldown window', async () => {
    // First call writes to localStorage
    await recordUserPing(driverFp, pingInput);
    mockInsert.mockClear();

    // Second call within cooldown → should be throttled
    const result = await recordUserPing(driverFp, pingInput);

    expect(result.ok).toBe(true);
    expect(result.message).toContain('doublon');
    // Should NOT have inserted again
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('returns ok: false when supabase insert fails', async () => {
    mockInsert.mockImplementation(() =>
      makeInsertChain(new Error('Insert failed'))
    );

    const result = await recordUserPing(driverFp, pingInput);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Insert failed');
  });

  it('uses default source "unknown" when metadata has no source', async () => {
    const result = await recordUserPing(driverFp, {
      ...pingInput,
      metadata: { extra: 'data' },
    });

    expect(result.ok).toBe(true);
  });

  it('handles undefined metadata gracefully', async () => {
    const result = await recordUserPing(driverFp, {
      ...pingInput,
      metadata: undefined,
    });

    expect(result.ok).toBe(true);
  });
});
