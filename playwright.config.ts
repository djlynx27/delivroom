import { defineConfig, devices } from '@playwright/test';

/**
 * playwright.config.ts — Delivroom
 *
 * Tests E2E sur les flows critiques chauffeur :
 *   - Navigation entre écrans
 *   - TodayScreen: rendu zones + surge
 *   - DriveScreen: hero zone + plateforme
 *   - AdminScreen: calibration IA
 *
 * Lance le serveur Vite dev localement avec des credentials Supabase placeholder.
 * Toutes les requêtes Supabase sont interceptées par page.route() dans chaque spec.
 */
export default defineConfig({
  testDir: './src/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'html',

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Permissions GPS simulées
    geolocation: { latitude: 45.5017, longitude: -73.5673 }, // Montréal
    permissions: ['geolocation'],
    // Viewport mobile (chauffeur sur téléphone)
    viewport: { width: 390, height: 844 },
  },

  projects: [
    {
      name: 'chromium-mobile',
      use: {
        ...devices['Pixel 7'],
        browserName: 'chromium',
        geolocation: { latitude: 45.5017, longitude: -73.5673 },
        permissions: ['geolocation'],
      },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      // Utilise la vraie URL Supabase pour les tests E2E réels
      VITE_SUPABASE_URL:
        process.env.VITE_SUPABASE_URL ||
        'https://hibzhsjgipybfihhzpxr.supabase.co',
      VITE_SUPABASE_ANON_KEY:
        process.env.VITE_SUPABASE_ANON_KEY ||
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhpYnpoc2pnaXB5YmZpaGh6cHhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NjI4NjAsImV4cCI6MjA4OTEzODg2MH0.3YiwAnLpgbLgyXIWBNEGR6yfIcaFJ3eYO4XCivG2rKU',
    },
  },
});
