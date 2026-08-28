/**
 * marketRadar.spec.ts — Delivroom E2E
 *
 * Teste le sheet Market Radar sur DriveScreen :
 *   - Ouverture du sheet
 *   - Bascule entre les vues Attente / Saturation / Pit-Stops
 *   - Bascule de la fenêtre temporelle (5m/30m/1h) dans la vue Attente
 */

import { expect, test } from '@playwright/test';
import { mockSupabase } from './helpers/supabase-mock';

test.describe('DriveScreen — Market Radar', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/drive');
    await expect(page.getByText('Un problème est survenu')).not.toBeVisible({
      timeout: 5000,
    });
  });

  test('ouvre le sheet Market Radar', async ({ page }) => {
    await page.getByRole('button', { name: 'Ouvrir Market Radar' }).click();
    await expect(page.getByRole('heading', { name: 'Market Radar' })).toBeVisible();
  });

  test('bascule entre les 3 vues', async ({ page }) => {
    await page.getByRole('button', { name: 'Ouvrir Market Radar' }).click();
    await expect(page.getByRole('heading', { name: 'Market Radar' })).toBeVisible();

    await page.getByRole('button', { name: 'Saturation' }).click();
    await page.getByRole('button', { name: 'Pit-Stops' }).click();
    await expect(page.getByText('🚻', { exact: false }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Attente' }).click();
  });

  test('bascule la fenêtre temporelle dans la vue Attente', async ({ page }) => {
    await page.getByRole('button', { name: 'Ouvrir Market Radar' }).click();
    await page.getByRole('button', { name: '5m' }).click();
    await page.getByRole('button', { name: '1h' }).click();
    // No crash after switching windows -- the sheet stays open and rendered.
    await expect(page.getByRole('heading', { name: 'Market Radar' })).toBeVisible();
  });
});
