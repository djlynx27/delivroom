/**
 * admin.spec.ts — Delivroom E2E
 *
 * Teste le hub admin et les sous-pages spécialisées.
 */

import { expect, test } from '@playwright/test';
import { mockSupabase } from './helpers/supabase-mock';

test.describe('AdminScreen — Hub admin', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/admin');
    await expect(page.getByText('Un problème est survenu')).not.toBeVisible({
      timeout: 5000,
    });
  });

  test("l'écran admin charge sans crash", async ({ page }) => {
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('le hub admin affiche les entrées principales', async ({ page }) => {
    await expect(page.getByText('Opérations terrain')).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText('Rapports & revenus')).toBeVisible();
    await expect(page.getByText('Apprentissage IA')).toBeVisible();
    await expect(page.getByText('Imports & documents')).toBeVisible();
    await expect(page.getByText('Outils & labo')).toBeVisible();
  });

  test('le lien /admin est actif dans la nav', async ({ page }) => {
    const adminLink = page.locator('nav a[href="/admin"]');
    await expect(adminLink).toHaveClass(/text-primary/);
  });
});

test.describe('AdminScreen — Navigation sortante', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/admin');
  });

  test('peut aller vers DriveScreen', async ({ page }) => {
    await page.locator('nav a[href="/drive"]').click();
    await expect(page).toHaveURL('/drive');
    await expect(page.getByText('Un problème est survenu')).not.toBeVisible();
  });

  test('peut ouvrir la sous-page apprentissage', async ({ page }) => {
    await page
      .getByRole('link', { name: /Ouvrir/i })
      .nth(2)
      .click();
    await expect(page).toHaveURL('/admin/learning');
    await expect(page.getByText('Calibration IA')).toBeVisible({
      timeout: 8000,
    });
  });

  test('la sous-page apprentissage affiche le calibrateur', async ({
    page,
  }) => {
    await page.goto('/admin/learning');
    await expect(page.getByText('Calibration IA')).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText('🕐 Heure du jour')).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText('📅 Jour semaine')).toBeVisible();
    await expect(page.getByText('🌧 Météo')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Recalibrer/i })
    ).toBeVisible();
  });
});
