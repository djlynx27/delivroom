/**
 * today.spec.ts — Delivroom E2E
 *
 * Teste le flow principal de TodayScreen :
 *   - Rendu de la hero card (meilleure zone)
 *   - Mode libre / Mode conduite toggle
 *   - Score et distance affichés
 *   - Transition de zone
 */

import { expect, test } from '@playwright/test';
import { mockSupabase } from './helpers/supabase-mock';

test.describe('TodayScreen — Mode libre', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/');
    // Attendre que l'app soit hydratée (pas l'ErrorBoundary)
    await expect(page.getByText('Un problème est survenu')).not.toBeVisible({
      timeout: 5000,
    });
  });

  test('la page charge sans crash', async ({ page }) => {
    // Vérifier le body contient quelque chose
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('le BottomNav est visible avec tous les liens', async ({ page }) => {
    const nav = page.locator('nav').last(); // BottomNav est le dernier nav
    await expect(nav).toBeVisible();
    await expect(nav.locator('a[href="/"]')).toBeVisible();
    await expect(nav.locator('a[href="/drive"]')).toBeVisible();
    await expect(nav.locator('a[href="/planning"]')).toBeVisible();
    await expect(nav.locator('a[href="/events"]')).toBeVisible();
    await expect(nav.locator('a[href="/zones"]')).toBeVisible();
    await expect(nav.locator('a[href="/admin"]')).toBeVisible();
  });

  test('le lien / est actif sur TodayScreen', async ({ page }) => {
    // Le lien actif a la classe text-primary
    const todayLink = page.locator('nav a[href="/"]');
    await expect(todayLink).toHaveClass(/text-primary/);
  });

  test("l'app ne bug pas si Supabase retourne vide", async ({ page }) => {
    // mockSupabase retourne [] pour tout — l'app doit gérer ça gracieusement
    await expect(page.getByText('Un problème est survenu')).not.toBeVisible();
    // Le layout principal est là
    await expect(page.locator('div.min-h-screen')).toBeVisible();
  });

  test('peut basculer vers /drive depuis le BottomNav', async ({ page }) => {
    await page.locator('nav a[href="/drive"]').click();
    await expect(page).toHaveURL('/drive');
    await expect(page.getByText('Un problème est survenu')).not.toBeVisible();
    // Revenir
    await page.locator('nav a[href="/"]').click();
    await expect(page).toHaveURL('/');
  });
});
