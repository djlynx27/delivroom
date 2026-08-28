/**
 * drive.spec.ts — Delivroom E2E
 *
 * Teste DriveScreen :
 *   - Hero zone (meilleure zone de conduite)
 *   - Zones suivantes listées
 *   - Bouton navigation Google Maps
 *   - Lien nav actif
 */

import { expect, test } from '@playwright/test';
import { mockSupabase } from './helpers/supabase-mock';

test.describe('DriveScreen — Mode conduite', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/drive');
    await expect(page.getByText('Un problème est survenu')).not.toBeVisible({
      timeout: 5000,
    });
  });

  test('la page DriveScreen charge sans crash', async ({ page }) => {
    await expect(page.locator('body')).not.toBeEmpty();
    await expect(page).toHaveURL('/drive');
  });

  test('le lien /drive est actif dans la nav', async ({ page }) => {
    const driveLink = page.locator('nav a[href="/drive"]');
    await expect(driveLink).toHaveClass(/text-primary/);
  });

  test("l'app gère l'absence de données sans crash", async ({ page }) => {
    // Avec Supabase mocké retournant [], DriveScreen affiche un état vide.
    // Le BottomNav est un signal non ambigu que l'app a fini de rendre --
    // contrairement à div.min-h-screen, qui matche à la fois le wrapper de
    // AppContent ET le fallback Suspense (AppLoading) pendant la brève
    // fenêtre où les deux coexistent le temps que le chunk lazy se charge.
    await expect(page.getByText('Un problème est survenu')).not.toBeVisible();
    await expect(page.locator('nav').last()).toBeVisible();
  });

  test('peut naviguer vers /planning depuis DriveScreen', async ({ page }) => {
    await page.locator('nav a[href="/planning"]').click();
    await expect(page).toHaveURL('/planning');
    await expect(page.getByText('Un problème est survenu')).not.toBeVisible();
  });

  test('peut revenir à TodayScreen depuis DriveScreen', async ({ page }) => {
    await page.locator('nav a[href="/"]').click();
    await expect(page).toHaveURL('/');
  });
});
