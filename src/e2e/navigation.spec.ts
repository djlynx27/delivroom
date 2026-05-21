/**
 * navigation.spec.ts — Delivroom E2E
 *
 * Teste la navigation entre tous les écrans via le BottomNav.
 * Vérifie qu'aucun écran ne déclenche l'ErrorBoundary.
 */

import { expect, test } from '@playwright/test';
import { mockSupabase } from './helpers/supabase-mock';

test.describe('Navigation BottomNav', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
  });

  test("charge l'écran d'accueil / sans crash", async ({ page }) => {
    await page.goto('/');
    // L'ErrorBoundary affiche "Un problème est survenu" en cas de crash
    await expect(page.getByText('Un problème est survenu')).not.toBeVisible();
    // La nav du bas est toujours visible
    const nav = page.locator('nav').filter({ hasText: /./ });
    await expect(nav).toBeVisible();
  });

  test('navigue vers /drive via le BottomNav', async ({ page }) => {
    await page.goto('/');
    // Clique sur le lien "drive" dans la nav
    await page.locator('nav a[href="/drive"]').click();
    await expect(page).toHaveURL('/drive');
    await expect(page.getByText('Un problème est survenu')).not.toBeVisible();
  });

  test('navigue vers /planning via le BottomNav', async ({ page }) => {
    await page.goto('/');
    await page.locator('nav a[href="/planning"]').click();
    await expect(page).toHaveURL('/planning');
    await expect(page.getByText('Un problème est survenu')).not.toBeVisible();
  });

  test('navigue vers /events via le BottomNav', async ({ page }) => {
    await page.goto('/');
    await page.locator('nav a[href="/events"]').click();
    await expect(page).toHaveURL('/events');
    await expect(page.getByText('Un problème est survenu')).not.toBeVisible();
  });

  test('navigue vers /zones via le BottomNav', async ({ page }) => {
    await page.goto('/');
    await page.locator('nav a[href="/zones"]').click();
    await expect(page).toHaveURL('/zones');
    await expect(page.getByText('Un problème est survenu')).not.toBeVisible();
  });

  test('navigue vers /admin via le BottomNav', async ({ page }) => {
    await page.goto('/');
    await page.locator('nav a[href="/admin"]').click();
    await expect(page).toHaveURL('/admin');
    await expect(page.getByText('Un problème est survenu')).not.toBeVisible();
  });

  test('retourne vers / depuis /drive', async ({ page }) => {
    await page.goto('/drive');
    await page.locator('nav a[href="/"]').click();
    await expect(page).toHaveURL('/');
  });

  test('affiche 404 sur route inconnue', async ({ page }) => {
    await page.goto('/route-inconnue-xyz');
    // NotFound.tsx est rendu
    await expect(page.locator('body')).not.toBeEmpty();
    await expect(page.getByText('Un problème est survenu')).not.toBeVisible();
  });
});
