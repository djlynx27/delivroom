/**
 * supabase-mock.ts — Delivroom E2E helpers
 *
 * Intercepte toutes les requêtes réseau vers Supabase et retourne
 * des fixtures déterministes pour éviter les appels réseau en tests.
 *
 * Usage dans un spec :
 *   import { mockSupabase } from './helpers/supabase-mock';
 *   test.beforeEach(async ({ page }) => { await mockSupabase(page); });
 */

import type { Page } from '@playwright/test';

// ── Fixtures ───────────────────────────────────────────────────────────────────

export const FIXTURE_ZONES = [
  {
    id: 'zon-plateau',
    name: 'Plateau Mont-Royal',
    type: 'residential',
    latitude: 45.522,
    longitude: -73.581,
    city_id: 'montreal',
  },
  {
    id: 'zon-downtown',
    name: 'Centre-Ville',
    type: 'commercial',
    latitude: 45.501,
    longitude: -73.567,
    city_id: 'montreal',
  },
  {
    id: 'zon-stlaurent',
    name: 'Saint-Laurent',
    type: 'mixed',
    latitude: 45.497,
    longitude: -73.604,
    city_id: 'montreal',
  },
];

export const FIXTURE_SCORES = FIXTURE_ZONES.map((z, i) => ({
  id: `score-${z.id}`,
  zone_id: z.id,
  score: 60 + i * 10,
  factors: { time: 0.7, weather: 0.5, events: 0.2 },
  recorded_at: new Date().toISOString(),
}));

export const FIXTURE_EVENTS: unknown[] = [];

export const FIXTURE_WEIGHT_CALIBRATOR = {
  w_time: 0.35,
  w_day: 0.2,
  w_weather: 0.2,
  w_events: 0.15,
  w_historical: 0.1,
  mae: 4.2,
  accuracy_pct: 78,
  trip_count: 42,
  source: 'calibrated',
  created_at: new Date().toISOString(),
  history: [],
};

// ── Mock helper ────────────────────────────────────────────────────────────────

export async function mockSupabase(page: Page): Promise<void> {
  // Intercepte toutes les requêtes REST Supabase
  await page.route('**/rest/v1/zones*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(FIXTURE_ZONES),
    });
  });

  await page.route('**/rest/v1/scores*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(FIXTURE_SCORES),
    });
  });

  await page.route('**/rest/v1/events*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(FIXTURE_EVENTS),
    });
  });

  await page.route('**/rest/v1/weight_history*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route('**/rest/v1/platform_signals*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route('**/rest/v1/push_subscriptions*', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  // Edge Functions
  await page.route('**/functions/v1/score-calculator*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ zones: FIXTURE_SCORES }),
    });
  });

  await page.route('**/functions/v1/weight-calibrator*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(FIXTURE_WEIGHT_CALIBRATOR),
    });
  });

  await page.route('**/functions/v1/push-notifier*', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // Catch-all pour les autres requêtes Supabase (realtime, auth, etc.)
  await page.route('**/supabase.co/**', (route) => {
    // Laisse passer les websockets (realtime) — uniquement bloquer HTTP
    if (route.request().resourceType() !== 'websocket') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      });
    }
  });
}
