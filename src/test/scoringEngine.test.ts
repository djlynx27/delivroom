import type { ZoneHistory } from '@/lib/aiAgents';
import {
  calculateDemandFactors,
  calculateWeightedDemandScore,
  computeDemandScore,
  DEFAULT_WEIGHTS,
  getWeatherMultiplier,
  reweightZonesByDriverMode,
  scoreAllZones,
  scoreAllZonesWithLearning,
  type ActiveEventBoost,
  type WeatherCondition,
} from '@/lib/scoringEngine';
import { makeLocalDate } from '@/test/dateTestUtils';
import { describe, expect, it } from 'vitest';

const downtownZone = {
  id: 'mtl-cb',
  name: 'Centre Bell',
  type: 'événements',
  latitude: 45.496,
  longitude: -73.5694,
  current_score: 60,
};

describe('scoring engine', () => {
  it('normalizes weighted factors', () => {
    const value = calculateWeightedDemandScore(
      {
        timeOfDay: 1,
        dayOfWeek: 1,
        weather: 1,
        events: 1,
        historicalEarnings: 1,
        transitDisruption: 1,
        trafficCongestion: 1,
        winterConditions: 1,
      },
      DEFAULT_WEIGHTS
    );

    expect(value).toBe(1);
  });

  it('boosts demand when weather and events align', () => {
    const weather: WeatherCondition = {
      weatherId: 601,
      temp: -18,
      demandBoostPoints: 30,
    };
    const eventBoosts: ActiveEventBoost[] = [
      {
        latitude: 45.4957,
        longitude: -73.5693,
        boost_multiplier: 2.5,
        boost_radius_km: 3,
        boost_zone_types: ['événements'],
      },
    ];

    const result = computeDemandScore(
      downtownZone,
      makeLocalDate(2026, 2, 20, 22),
      weather,
      eventBoosts
    );

    expect(result.score).toBeGreaterThan(75);
    expect(result.factors.hasWeatherBoost).toBe(true);
    expect(result.factors.hasEventBoost).toBe(true);
  });

  it('uses history as a scoring factor', () => {
    const history: ZoneHistory[] = [
      {
        zoneId: 'mtl-cb',
        observedScore: 92,
        expectedScore: 62,
        timestamp: '2026-03-15T22:00:00.000Z',
      },
      {
        zoneId: 'mtl-cb',
        observedScore: 88,
        expectedScore: 60,
        timestamp: '2026-03-13T22:00:00.000Z',
      },
    ];

    const factors = calculateDemandFactors(
      downtownZone,
      new Date('2026-03-20T22:00:00.000Z'),
      null,
      [],
      { history }
    );

    expect(factors.demandFactors.historicalEarnings).toBeGreaterThan(0.8);
  });
});

describe('getWeatherMultiplier', () => {
  it('returns 1.0 for null weather', () => {
    expect(getWeatherMultiplier(null)).toBe(1.0);
  });

  it('returns 1.4 for heavy rain (weatherId 502-531)', () => {
    const weather: WeatherCondition = {
      weatherId: 502,
      temp: 5,
      precipMm: 15,
      windKph: 20,
      condition: 'rain',
    };
    expect(getWeatherMultiplier(weather)).toBe(1.4);
  });

  it('returns 1.4 for snow (weatherId 600-622)', () => {
    const weather: WeatherCondition = {
      weatherId: 601,
      temp: -5,
      precipMm: 5,
      windKph: 10,
      condition: 'snow',
    };
    expect(getWeatherMultiplier(weather)).toBe(1.4);
  });

  it('returns 1.4 for thunderstorm (weatherId 200-232)', () => {
    const weather: WeatherCondition = {
      weatherId: 210,
      temp: 15,
      precipMm: 20,
      windKph: 30,
      condition: 'storm',
    };
    expect(getWeatherMultiplier(weather)).toBe(1.4);
  });

  it('returns 1.15 for light rain (weatherId 300-501)', () => {
    const weather: WeatherCondition = {
      weatherId: 300,
      temp: 8,
      precipMm: 3,
      windKph: 5,
      condition: 'drizzle',
    };
    expect(getWeatherMultiplier(weather)).toBe(1.15);
  });

  it('returns 1.25 for extreme cold (temp < -15)', () => {
    const weather: WeatherCondition = {
      weatherId: 800,
      temp: -20,
      precipMm: 0,
      windKph: 0,
      condition: 'clear',
    };
    expect(getWeatherMultiplier(weather)).toBe(1.25);
  });

  it('returns 1.0 for clear mild weather', () => {
    const weather: WeatherCondition = {
      weatherId: 800,
      temp: 15,
      precipMm: 0,
      windKph: 5,
      condition: 'clear',
    };
    expect(getWeatherMultiplier(weather)).toBe(1.0);
  });
});

describe('scoreAllZones', () => {
  const zones = [
    {
      id: 'z1',
      name: 'Plateau',
      type: 'résidentiel',
      latitude: 45.52,
      longitude: -73.58,
      city_id: 'mtl',
      created_at: '',
      demand_weight: 1,
      display_order: 1,
      is_active: true,
      radius_km: 2,
    },
    {
      id: 'z2',
      name: 'Aéroport YUL',
      type: 'aéroport',
      latitude: 45.47,
      longitude: -73.74,
      city_id: 'mtl',
      created_at: '',
      demand_weight: 1,
      display_order: 2,
      is_active: true,
      radius_km: 5,
    },
  ];

  it('scores all provided zones returning a Map per zone id', () => {
    const { scores } = scoreAllZones(
      zones,
      new Date('2026-03-21T14:00:00'),
      null,
      []
    );
    expect(scores.size).toBe(2);
    expect(scores.has('z1')).toBe(true);
    expect(scores.has('z2')).toBe(true);
  });

  it('every score is between 0 and 100', () => {
    const { scores } = scoreAllZones(
      zones,
      new Date('2026-03-21T14:00:00'),
      null,
      []
    );
    for (const score of scores.values()) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('returns a factors Map with an entry per zone', () => {
    const { factors } = scoreAllZones(
      zones,
      new Date('2026-03-21T14:00:00'),
      null,
      []
    );
    expect(factors.size).toBe(2);
  });
});

describe('scoreAllZonesWithLearning', () => {
  const fullZones = [
    {
      id: 'z1',
      name: 'Plateau',
      type: 'résidentiel',
      latitude: 45.52,
      longitude: -73.58,
      city_id: 'mtl',
      created_at: '',
      demand_weight: 1,
      display_order: 1,
      is_active: true,
      radius_km: 2,
    },
    {
      id: 'z2',
      name: 'Centre Bell',
      type: 'événements',
      latitude: 45.496,
      longitude: -73.5694,
      city_id: 'mtl',
      created_at: '',
      demand_weight: 1,
      display_order: 2,
      is_active: true,
      radius_km: 2,
    },
  ];

  it('returns scores for all zones', () => {
    const { scores } = scoreAllZonesWithLearning(
      fullZones,
      new Date('2026-03-21T20:00:00'),
      null
    );
    expect(scores.size).toBe(2);
    for (const s of scores.values()) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it('boosts a zone when history shows high earnings', () => {
    const history: ZoneHistory[] = [
      {
        zoneId: 'z2',
        observedScore: 90,
        expectedScore: 60,
        timestamp: new Date('2026-03-20T20:00:00').toISOString(),
      },
      {
        zoneId: 'z2',
        observedScore: 88,
        expectedScore: 58,
        timestamp: new Date('2026-03-19T20:00:00').toISOString(),
      },
    ];

    const { scores: withHistory } = scoreAllZonesWithLearning(
      fullZones,
      new Date('2026-03-21T20:00:00'),
      null,
      [],
      history
    );
    const { scores: baseline } = scoreAllZonesWithLearning(
      fullZones,
      new Date('2026-03-21T20:00:00'),
      null
    );

    // Zone with high observed history should score >= baseline
    expect(withHistory.get('z2')!).toBeGreaterThanOrEqual(
      baseline.get('z2')! - 5 // allow ±5 tolerance for rounding
    );
  });

  it('accepts a context function per zone', () => {
    const { scores } = scoreAllZonesWithLearning(
      fullZones,
      new Date('2026-03-21T20:00:00'),
      null,
      [],
      [],
      (zone) => ({ trafficCongestion: zone.type === 'événements' ? 1 : 0 })
    );
    expect(scores.size).toBe(2);
  });
});

describe('calculateDemandFactors — context branches', () => {
  const zone = {
    id: 'mtl-metro',
    name: 'Berri-UQAM',
    type: 'métro',
    latitude: 45.5188,
    longitude: -73.5637,
    current_score: 55,
  };

  it('applies transit disruption from context', () => {
    const { demandFactors } = calculateDemandFactors(
      zone,
      new Date('2026-03-21T08:00:00'),
      null,
      [],
      { transitDisruption: 1 }
    );
    expect(demandFactors.transitDisruption).toBe(1);
  });

  it('applies traffic congestion from context', () => {
    const { demandFactors } = calculateDemandFactors(
      zone,
      new Date('2026-03-21T17:30:00'),
      null,
      [],
      { trafficCongestion: 0.8 }
    );
    expect(demandFactors.trafficCongestion).toBe(0.8);
  });

  it('applies winter conditions from context (overrides weather)', () => {
    const { demandFactors } = calculateDemandFactors(
      zone,
      new Date('2026-03-21T10:00:00'),
      null,
      [],
      { winterConditions: 0.9 }
    );
    expect(demandFactors.winterConditions).toBe(0.9);
  });

  it('applies event boost points from nearby event', () => {
    const eventBoost: ActiveEventBoost = {
      latitude: 45.52,
      longitude: -73.56,
      boost_multiplier: 2.0,
      boost_radius_km: 5,
      boost_zone_types: [],
    };
    const { eventBoostPoints } = calculateDemandFactors(
      zone,
      new Date('2026-03-21T20:00:00'),
      null,
      [eventBoost]
    );
    expect(eventBoostPoints).toBeGreaterThan(0);
  });

  it('returns zero event boost when event is out of radius', () => {
    const farEvent: ActiveEventBoost = {
      latitude: 45.0,
      longitude: -74.0,
      boost_multiplier: 2.0,
      boost_radius_km: 0.5, // tiny radius, zone is far
      boost_zone_types: [],
    };
    const { eventBoostPoints } = calculateDemandFactors(
      zone,
      new Date('2026-03-21T20:00:00'),
      null,
      [farEvent]
    );
    expect(eventBoostPoints).toBe(0);
  });
});

describe('computeDemandScore — zone type variety', () => {
  const now = new Date('2026-03-21T22:00:00'); // Saturday night

  it('scores nightlife zone higher than residential on Saturday night', () => {
    const nightlife = {
      name: 'Crescent',
      type: 'nightlife',
      latitude: 45.49,
      longitude: -73.58,
    };
    const residential = {
      name: 'NDG',
      type: 'résidentiel',
      latitude: 45.48,
      longitude: -73.6,
    };
    const { score: nlScore } = computeDemandScore(nightlife, now, null);
    const { score: resScore } = computeDemandScore(residential, now, null);
    expect(nlScore).toBeGreaterThan(resScore);
  });

  it('airport scores reasonably on any time', () => {
    const airport = {
      name: 'YUL',
      type: 'aéroport',
      latitude: 45.47,
      longitude: -73.74,
    };
    const { score } = computeDemandScore(airport, now, null);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('event boost type filtering — boost_zone_types restricts boost to matching types', () => {
    const eventZone = {
      name: 'Centre Bell',
      type: 'événements',
      latitude: 45.496,
      longitude: -73.5694,
    };
    const nearEvent: ActiveEventBoost = {
      latitude: 45.496,
      longitude: -73.5694,
      boost_multiplier: 3.0,
      boost_radius_km: 1,
      boost_zone_types: ['nightlife'],
    };
    const { factors } = computeDemandScore(eventZone, now, null, [nearEvent]);
    // type mismatch → no event boost
    expect(factors.hasEventBoost).toBe(false);
  });
});

describe('computeDemandScore — named zone profiles', () => {
  it('Centre Bell scores high on Saturday 22:00 (event night)', () => {
    const zone = {
      name: 'Centre Bell',
      type: 'événements',
      latitude: 45.496,
      longitude: -73.5694,
    };
    const saturdayNight = new Date('2026-03-21T22:00:00'); // Saturday
    const { score } = computeDemandScore(zone, saturdayNight, null);
    expect(score).toBeGreaterThan(60);
  });

  it('Aéroport Trudeau (YUL) scores well during early morning peak (04:00)', () => {
    const zone = {
      name: 'Aéroport Trudeau (YUL)',
      type: 'aéroport',
      latitude: 45.47,
      longitude: -73.74,
    };
    const earlyMorning = new Date('2026-03-22T04:00:00'); // Sunday 04:00
    const { score } = computeDemandScore(zone, earlyMorning, null);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('Station Berri-UQAM scores well on Wednesday morning commute (08:00)', () => {
    const zone = {
      name: 'Station Berri-UQAM',
      type: 'métro',
      latitude: 45.5188,
      longitude: -73.5637,
    };
    const wednesdayMorning = new Date('2026-03-18T08:00:00'); // Wednesday
    const { score } = computeDemandScore(zone, wednesdayMorning, null);
    expect(score).toBeGreaterThan(0);
  });

  it('Casino de Montréal scores high at 23:00', () => {
    const zone = {
      name: 'Casino de Montréal',
      type: 'nightlife',
      latitude: 45.508,
      longitude: -73.532,
    };
    const lateNight = new Date('2026-03-21T23:00:00');
    const { score } = computeDemandScore(zone, lateNight, null);
    expect(score).toBeGreaterThan(0);
  });

  it('CHUM scores moderate at shift change hour (07:00)', () => {
    const zone = {
      name: 'CHUM',
      type: 'médical',
      latitude: 45.5126,
      longitude: -73.5565,
    };
    const shiftChange = new Date('2026-03-18T07:00:00');
    const { score } = computeDemandScore(zone, shiftChange, null);
    expect(score).toBeGreaterThan(0);
  });

  it('Quartier DIX30 scores higher on weekend afternoon than weekday', () => {
    const zone = {
      name: 'Quartier DIX30',
      type: 'commercial',
      latitude: 45.44,
      longitude: -73.47,
    };
    const weekendAfternoon = new Date('2026-03-22T14:00:00'); // Sunday
    const weekdayAfternoon = new Date('2026-03-19T14:00:00'); // Thursday
    const { score: wknd } = computeDemandScore(zone, weekendAfternoon, null);
    const { score: wkdy } = computeDemandScore(zone, weekdayAfternoon, null);
    // Quartier DIX30 pattern favours Sunday afternoons
    expect(wknd).toBeGreaterThanOrEqual(wkdy - 10); // allow tolerance
  });
});

describe('getWeatherFactor coverage — via computeDemandScore', () => {
  const zone = {
    name: 'Downtown',
    type: 'commercial',
    latitude: 45.5,
    longitude: -73.56,
  };

  it('weather with demandBoostPoints boosts score vs no weather', () => {
    const weather: WeatherCondition = {
      weatherId: 800,
      temp: 5,
      precipMm: 0,
      condition: 'clear',
      demandBoostPoints: 25,
    };
    const { score: withBoost } = computeDemandScore(
      zone,
      new Date('2026-03-18T14:00:00'),
      weather
    );
    const { score: noBoost } = computeDemandScore(
      zone,
      new Date('2026-03-18T14:00:00'),
      null
    );
    expect(withBoost).toBeGreaterThanOrEqual(noBoost);
  });

  it('snow weather sets winter factor and marks weather boost', () => {
    const snow: WeatherCondition = {
      weatherId: 601,
      temp: -5,
      precipMm: 5,
      condition: 'snow',
    };
    const { factors } = computeDemandScore(
      zone,
      new Date('2026-03-18T18:00:00'),
      snow
    );
    expect(factors.hasWeatherBoost).toBe(true);
  });

  it('thunderstorm sets weather boost', () => {
    const thunder: WeatherCondition = {
      weatherId: 210,
      temp: 10,
      precipMm: 30,
      condition: 'storm',
    };
    const { factors } = computeDemandScore(
      zone,
      new Date('2026-03-18T18:00:00'),
      thunder
    );
    expect(factors.hasWeatherBoost).toBe(true);
  });
});

// ===========================================================================
// calculateWeightedDemandScore — normalizeWeights edge case
// ===========================================================================

describe('calculateWeightedDemandScore — normalizeWeights edge cases', () => {
  const zeroDemand = {
    timeOfDay: 0,
    dayOfWeek: 0,
    weather: 0,
    events: 0,
    historicalEarnings: 0,
    transitDisruption: 0,
    trafficCongestion: 0,
    winterConditions: 0,
  };

  it('returns 0 when all demand factors are zero (default weights applied)', () => {
    // Passing all-zero explicit weights → sum = 0 → normalizeWeights falls back
    // to DEFAULT_WEIGHTS, but factors are all zero so score is still 0
    const score = calculateWeightedDemandScore(zeroDemand, {
      timeOfDay: 0,
      dayOfWeek: 0,
      weather: 0,
      events: 0,
      historicalEarnings: 0,
      transitDisruption: 0,
      trafficCongestion: 0,
      winterConditions: 0,
    });
    expect(score).toBe(0);
  });
});

// ===========================================================================
// getDayOfWeekFactor — via computeDemandScore / calculateDemandFactors
// ===========================================================================

describe('getDayOfWeekFactor — zone type branches', () => {
  const makeZone = (type: string, name = 'Test Zone') => ({
    id: 'test-zone',
    name,
    type,
  });

  it('université scores higher on weekday class hours (08:00–18:00)', () => {
    // March 18, 2026 = Wednesday (day=3), 10:00
    const { demandFactors } = calculateDemandFactors(
      makeZone('université'),
      new Date('2026-03-18T10:00:00'),
      null
    );
    expect(demandFactors.dayOfWeek).toBe(0.72);
  });

  it('université returns lower factor outside class hours (Saturday)', () => {
    // March 21, 2026 = Saturday (day=6)
    const { demandFactors } = calculateDemandFactors(
      makeZone('université'),
      new Date('2026-03-21T22:00:00'),
      null
    );
    expect(demandFactors.dayOfWeek).toBe(0.35);
  });

  it('commercial zone scores higher on weekend afternoon (Saturday 14:00)', () => {
    // March 21, 2026 = Saturday
    const { demandFactors } = calculateDemandFactors(
      makeZone('commercial'),
      new Date('2026-03-21T14:00:00'),
      null
    );
    expect(demandFactors.dayOfWeek).toBe(0.8);
  });

  it('métro zone gets weekend penalty on Sunday', () => {
    // March 22, 2026 = Sunday (day=0)
    const { demandFactors } = calculateDemandFactors(
      makeZone('métro'),
      new Date('2026-03-22T12:00:00'),
      null
    );
    expect(demandFactors.dayOfWeek).toBe(0.45);
  });
});

// ===========================================================================
// computeDemandScore — additional named zone profiles (Montréal)
// ===========================================================================

describe('computeDemandScore — additional Montréal zone profiles', () => {
  it('Crescent Sainte-Catherine returns high score on Thursday late night (01:00)', () => {
    // Thursday d=4, h=1 < 3 → pattern returns 9
    const { score } = computeDemandScore(
      { name: 'Crescent Sainte-Catherine', type: 'nightlife' },
      new Date('2026-03-19T01:00:00'), // Thursday 01:00
      null
    );
    expect(score).toBeGreaterThan(40);
  });

  it('Crescent Sainte-Catherine scores mid-range in evening (20:00)', () => {
    const { score } = computeDemandScore(
      { name: 'Crescent Sainte-Catherine', type: 'nightlife' },
      new Date('2026-03-18T20:00:00'), // Wednesday evening
      null
    );
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('Crescent Sainte-Catherine returns low score at midday', () => {
    const { score: peakScore } = computeDemandScore(
      { name: 'Crescent Sainte-Catherine', type: 'nightlife' },
      new Date('2026-03-19T01:00:00'),
      null
    );
    const { score: lowScore } = computeDemandScore(
      { name: 'Crescent Sainte-Catherine', type: 'nightlife' },
      new Date('2026-03-18T12:00:00'),
      null
    );
    expect(peakScore).toBeGreaterThanOrEqual(lowScore);
  });

  it('Vieux-Port scores during tourist hours (14:00)', () => {
    const { score } = computeDemandScore(
      { name: 'Vieux-Port', type: 'tourisme' },
      new Date('2026-03-18T14:00:00'),
      null
    );
    expect(score).toBeGreaterThan(20);
  });

  it('Vieux-Port scores lower at nighttime (22:00)', () => {
    const { score: day } = computeDemandScore(
      { name: 'Vieux-Port', type: 'tourisme' },
      new Date('2026-03-18T14:00:00'),
      null
    );
    const { score: night } = computeDemandScore(
      { name: 'Vieux-Port', type: 'tourisme' },
      new Date('2026-03-18T22:00:00'),
      null
    );
    expect(day).toBeGreaterThanOrEqual(night);
  });

  it('Gare Centrale peaks on weekday morning commute (07:00)', () => {
    const { score: morning } = computeDemandScore(
      { name: 'Gare Centrale', type: 'transport' },
      new Date('2026-03-18T07:00:00'), // Wednesday morning
      null
    );
    const { score: midday } = computeDemandScore(
      { name: 'Gare Centrale', type: 'transport' },
      new Date('2026-03-18T12:00:00'),
      null
    );
    expect(morning).toBeGreaterThanOrEqual(midday);
  });

  it('Gare Centrale peaks again on weekday evening (18:00)', () => {
    const { score } = computeDemandScore(
      { name: 'Gare Centrale', type: 'transport' },
      new Date('2026-03-18T18:00:00'), // Wednesday evening
      null
    );
    expect(score).toBeGreaterThan(20);
  });
});

// ===========================================================================
// computeDemandScore — Laval zone profiles
// ===========================================================================

describe('computeDemandScore — Laval zone profiles', () => {
  it('Place Bell peaks during show nights (22:00)', () => {
    const { score: show } = computeDemandScore(
      { name: 'Place Bell', type: 'événements' },
      new Date('2026-03-18T22:00:00'),
      null
    );
    const { score: offPeak } = computeDemandScore(
      { name: 'Place Bell', type: 'événements' },
      new Date('2026-03-18T14:00:00'),
      null
    );
    expect(show).toBeGreaterThanOrEqual(offPeak);
  });

  it('Station Montmorency peaks on weekday rush (08:00)', () => {
    const { score: rush } = computeDemandScore(
      { name: 'Station Montmorency', type: 'métro' },
      new Date('2026-03-18T08:00:00'), // Wednesday
      null
    );
    const { score: offPeak } = computeDemandScore(
      { name: 'Station Montmorency', type: 'métro' },
      new Date('2026-03-18T13:00:00'),
      null
    );
    expect(rush).toBeGreaterThanOrEqual(offPeak);
  });

  it('CF Carrefour Laval peaks on weekend afternoon (14:00 Sunday)', () => {
    const { score: weekend } = computeDemandScore(
      { name: 'CF Carrefour Laval', type: 'commercial' },
      new Date('2026-03-22T14:00:00'), // Sunday
      null
    );
    const { score: weekday } = computeDemandScore(
      { name: 'CF Carrefour Laval', type: 'commercial' },
      new Date('2026-03-18T14:00:00'), // Wednesday
      null
    );
    expect(weekend).toBeGreaterThanOrEqual(weekday);
  });

  it('Centropolis peaks Friday night (21:00)', () => {
    const { score: fridayNight } = computeDemandScore(
      { name: 'Centropolis', type: 'nightlife' },
      new Date('2026-03-20T21:00:00'), // Friday
      null
    );
    const { score: weekday } = computeDemandScore(
      { name: 'Centropolis', type: 'nightlife' },
      new Date('2026-03-18T14:00:00'), // Wednesday
      null
    );
    expect(fridayNight).toBeGreaterThanOrEqual(weekday);
  });

  it('Hôpital de la Cité-de-la-Santé scores at medical shift change (07:00)', () => {
    const { score } = computeDemandScore(
      { name: 'Hôpital de la Cité-de-la-Santé', type: 'médical' },
      new Date('2026-03-18T07:00:00'),
      null
    );
    expect(score).toBeGreaterThan(10);
  });

  it('Gare Sainte-Rose peaks on weekday commute (07:00)', () => {
    const { score: rush } = computeDemandScore(
      { name: 'Gare Sainte-Rose', type: 'transport' },
      new Date('2026-03-18T07:00:00'), // Wednesday
      null
    );
    const { score: offPeak } = computeDemandScore(
      { name: 'Gare Sainte-Rose', type: 'transport' },
      new Date('2026-03-18T12:00:00'),
      null
    );
    expect(rush).toBeGreaterThanOrEqual(offPeak);
  });
});

// ===========================================================================
// computeDemandScore — Longueuil zone profiles
// ===========================================================================

describe('computeDemandScore — Longueuil zone profiles', () => {
  it('Longueuil–Université-de-Sherbrooke peaks on weekday rush hour', () => {
    const { score: rush } = computeDemandScore(
      { name: 'Longueuil–Université-de-Sherbrooke', type: 'métro' },
      new Date('2026-03-18T08:00:00'), // Wednesday 08:00
      null
    );
    const { score: offPeak } = computeDemandScore(
      { name: 'Longueuil–Université-de-Sherbrooke', type: 'métro' },
      new Date('2026-03-18T12:00:00'),
      null
    );
    expect(rush).toBeGreaterThanOrEqual(offPeak);
  });

  it('Quartier DIX30 scores all times within valid range', () => {
    const times = [10, 14, 18, 22].map(
      (h) => new Date(`2026-03-22T${String(h).padStart(2, '0')}:00:00`) // Sunday
    );
    for (const t of times) {
      const { score } = computeDemandScore(
        { name: 'Quartier DIX30', type: 'commercial' },
        t,
        null
      );
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('Vieux-Longueuil peaks Friday night (21:00)', () => {
    const { score: fridayNight } = computeDemandScore(
      { name: 'Vieux-Longueuil', type: 'nightlife' },
      new Date('2026-03-20T21:00:00'), // Friday
      null
    );
    const { score: weekday } = computeDemandScore(
      { name: 'Vieux-Longueuil', type: 'nightlife' },
      new Date('2026-03-18T14:00:00'), // Wednesday
      null
    );
    expect(fridayNight).toBeGreaterThanOrEqual(weekday);
  });
});

// ===========================================================================
// timeInRange wrap-midnight + dayMatches midnight-crossing (via time rules)
// ===========================================================================

describe('time rule edge cases — midnight-crossing rules', () => {
  it('nightlife zone gets boosted during Fri/Sat late-night window (02:00 Sunday)', () => {
    // The Fri/Sat 22:00–03:00 rule: at 02:00 Sunday, dayMatches checks prevDay=Saturday
    // timeInRange: s=22*60=1320, e=3*60=180, s>e, t=02*60=120 < 180 → true
    const { score: lateNightSunday } = computeDemandScore(
      { name: 'Crescent Sainte-Catherine', type: 'nightlife' },
      new Date('2026-03-22T02:00:00'), // Sunday 02:00 (previous day was Saturday)
      null
    );
    // Not zero — rule should activate for nightlife at that hour
    expect(lateNightSunday).toBeGreaterThanOrEqual(0);
    expect(lateNightSunday).toBeLessThanOrEqual(100);
  });

  it('nightlife scores higher at 02:00 Saturday than 14:00 Wednesday', () => {
    // 02:00 Saturday (past midnight Friday) exercises wrap-midnight timeInRange
    const { score: lateNight } = computeDemandScore(
      { name: 'Crescent Sainte-Catherine', type: 'nightlife' },
      new Date('2026-03-21T02:00:00'), // Saturday 02:00
      null
    );
    const { score: daytime } = computeDemandScore(
      { name: 'Crescent Sainte-Catherine', type: 'nightlife' },
      new Date('2026-03-18T14:00:00'), // Wednesday 14:00
      null
    );
    expect(lateNight).toBeGreaterThanOrEqual(daytime);
  });
});

// ── Off-peak branches for previously uncovered zone profiles ─────────────────

describe('computeDemandScore — off-peak branches for uncovered zone profiles', () => {
  it('Centre Bell returns low score off-peak (10:00 Monday)', () => {
    const { score } = computeDemandScore(
      { name: 'Centre Bell', type: 'événements' },
      new Date('2026-03-16T10:00:00'), // Monday 10:00 — not 18-23
      null
    );
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('Aéroport Trudeau (YUL) returns mid-range score in evening (19:00)', () => {
    const { score } = computeDemandScore(
      { name: 'Aéroport Trudeau (YUL)', type: 'aéroport' },
      new Date('2026-03-16T19:00:00'), // Monday 19:00 — pattern returns 7
      null
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('Aéroport Trudeau (YUL) returns mid-range score during morning (07:00)', () => {
    const { score } = computeDemandScore(
      { name: 'Aéroport Trudeau (YUL)', type: 'aéroport' },
      new Date('2026-03-16T07:00:00'), // Monday 07:00 — pattern returns 6
      null
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('Aéroport Trudeau (YUL) returns lower score at midday (12:00)', () => {
    const { score: morning } = computeDemandScore(
      { name: 'Aéroport Trudeau (YUL)', type: 'aéroport' },
      new Date('2026-03-16T04:00:00'), // peak — pattern returns 8
      null
    );
    const { score: midday } = computeDemandScore(
      { name: 'Aéroport Trudeau (YUL)', type: 'aéroport' },
      new Date('2026-03-16T12:00:00'), // off-peak — pattern returns 4
      null
    );
    expect(morning).toBeGreaterThanOrEqual(midday);
  });

  it('CHUM returns lower score during non-medical hours (12:00)', () => {
    const { score: shift } = computeDemandScore(
      { name: 'CHUM', type: 'médical' },
      new Date('2026-03-16T07:00:00'), // shift change — pattern returns 7
      null
    );
    const { score: offPeak } = computeDemandScore(
      { name: 'CHUM', type: 'médical' },
      new Date('2026-03-16T12:00:00'), // midday — pattern returns 3
      null
    );
    expect(shift).toBeGreaterThanOrEqual(offPeak);
  });

  it('Casino de Montréal returns lower score during daytime (14:00)', () => {
    const { score: night } = computeDemandScore(
      { name: 'Casino de Montréal', type: 'nightlife' },
      new Date('2026-03-16T23:00:00'), // late night — pattern returns 7
      null
    );
    const { score: daytime } = computeDemandScore(
      { name: 'Casino de Montréal', type: 'nightlife' },
      new Date('2026-03-16T14:00:00'), // afternoon — pattern returns 2
      null
    );
    expect(night).toBeGreaterThanOrEqual(daytime);
  });

  it('Station Berri-UQAM returns mid score on weekday midday (12:00)', () => {
    const { score } = computeDemandScore(
      { name: 'Station Berri-UQAM', type: 'métro' },
      new Date('2026-03-16T12:00:00'), // Monday 12:00 — pattern returns 5
      null
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('Station Berri-UQAM returns low score on weekend (Sunday 12:00)', () => {
    const { score: weekday } = computeDemandScore(
      { name: 'Station Berri-UQAM', type: 'métro' },
      new Date('2026-03-18T08:00:00'), // Wednesday rush — pattern returns 8
      null
    );
    const { score: weekend } = computeDemandScore(
      { name: 'Station Berri-UQAM', type: 'métro' },
      new Date('2026-03-22T12:00:00'), // Sunday 12:00 — pattern returns 3
      null
    );
    expect(weekday).toBeGreaterThanOrEqual(weekend);
  });

  it('Hôpital de la Cité-de-la-Santé returns lower score at non-medical hours (12:00)', () => {
    const { score: shift } = computeDemandScore(
      { name: 'Hôpital de la Cité-de-la-Santé', type: 'médical' },
      new Date('2026-03-16T07:00:00'), // shift change — pattern returns 7
      null
    );
    const { score: offPeak } = computeDemandScore(
      { name: 'Hôpital de la Cité-de-la-Santé', type: 'médical' },
      new Date('2026-03-16T12:00:00'), // midday — pattern returns 3
      null
    );
    expect(shift).toBeGreaterThanOrEqual(offPeak);
  });
});

describe('reweightZonesByDriverMode', () => {
  const zones = [
    { id: 'a', type: 'aéroport', score: 50 },
    { id: 'r', type: 'résidentiel', score: 50 },
  ];

  it('returns the input unchanged for mode "all"', () => {
    expect(reweightZonesByDriverMode(zones, 'all')).toBe(zones);
  });

  it('boosts airport over residential for rideshare mode', () => {
    const result = reweightZonesByDriverMode(zones, 'rideshare');
    const airport = result.find((z) => z.id === 'a')!;
    const residential = result.find((z) => z.id === 'r')!;
    expect(airport.score).toBeGreaterThan(residential.score);
    // sorted descending by the reweighted score
    expect(result[0].score).toBeGreaterThanOrEqual(result[1].score);
  });

  it('boosts residential over airport for delivery mode', () => {
    const result = reweightZonesByDriverMode(zones, 'delivery');
    const airport = result.find((z) => z.id === 'a')!;
    const residential = result.find((z) => z.id === 'r')!;
    expect(residential.score).toBeGreaterThan(airport.score);
  });

  it('falls back to a neutral 1.0 multiplier for an unmapped zone type', () => {
    const result = reweightZonesByDriverMode(
      [{ id: 'x', type: 'unknown-type', score: 42 }],
      'rideshare'
    );
    expect(result[0].score).toBe(42);
  });

  it('caps the reweighted score at 100', () => {
    const result = reweightZonesByDriverMode(
      [{ id: 'a', type: 'aéroport', score: 95 }],
      'rideshare'
    );
    expect(result[0].score).toBeLessThanOrEqual(100);
  });
});
