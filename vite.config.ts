import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { buildFallbackYulStatus } from './src/lib/yulStatus';

// https://vite.dev/config/
import { resolve } from 'path';

function sendJson(
  res: {
    statusCode: number;
    setHeader: (name: string, value: string) => void;
    end: (body: string) => void;
  },
  payload: unknown,
  statusCode = 200
) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const stmProxyHeaders = env.VITE_STM_KEY
    ? { apikey: env.VITE_STM_KEY }
    : undefined;
  const aviationstackKey =
    env.AVIATIONSTACK_API_KEY || env.VITE_AVIATIONSTACK_KEY;
  const devApiFallbacks = {
    name: 'dev-api-fallbacks',
    configureServer(server: {
      middlewares: {
        use: (
          handler: (
            req: { url?: string; method?: string },
            res: {
              statusCode: number;
              setHeader: (name: string, value: string) => void;
              end: (body: string) => void;
            },
            next: () => void
          ) => void | Promise<void>
        ) => void;
      };
    }) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || req.method !== 'GET') {
          next();
          return;
        }

        const url = new URL(req.url, 'http://localhost');

        if (url.pathname === '/api/holidays') {
          const yearParam = url.searchParams.get('year');
          const year = /^\d{4}$/.test(yearParam ?? '')
            ? yearParam!
            : String(new Date().getFullYear());

          try {
            const upstream = await fetch(
              `https://canada-holidays.ca/api/v1/holidays?province=QC&year=${year}`
            );

            if (!upstream.ok) {
              sendJson(res, { holidays: [] });
              return;
            }

            sendJson(res, await upstream.json());
            return;
          } catch {
            sendJson(res, { holidays: [] });
            return;
          }
        }

        if (url.pathname === '/api/yul-flights') {
          const now = new Date();

          if (!aviationstackKey) {
            sendJson(res, buildFallbackYulStatus(now));
            return;
          }

          if (aviationstackKey === 'mock') {
            sendJson(res, buildFallbackYulStatus(now, 12));
            return;
          }

          try {
            const params = new URLSearchParams({
              access_key: aviationstackKey,
              arr_iata: 'YUL',
              flight_status: 'active',
              limit: '50',
            });
            const upstream = await fetch(
              `https://api.aviationstack.com/v1/flights?${params.toString()}`
            );

            if (!upstream.ok) {
              sendJson(res, buildFallbackYulStatus(now));
              return;
            }

            const payload = (await upstream.json()) as {
              data?: unknown[];
            };
            const liveArrivalsCount = payload.data?.length ?? 0;
            const baseStatus = buildFallbackYulStatus(now, liveArrivalsCount);

            sendJson(res, {
              ...baseStatus,
              isActivePeriod:
                baseStatus.isActivePeriod || liveArrivalsCount > 5,
              liveArrivalsCount,
              fetchedAt: now.toISOString(),
            });
            return;
          } catch {
            sendJson(res, buildFallbackYulStatus(now));
            return;
          }
        }

        next();
      });
    },
  };

  return {
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    server: {
      proxy: {
        '/api/habs-schedule': {
          target: 'https://api-web.nhle.com',
          changeOrigin: true,
          rewrite: (path) => {
            const url = new URL(path, 'http://localhost');
            const dateParam = url.searchParams.get('date');
            const parsed = dateParam ? new Date(dateParam) : new Date();
            const baseDate = Number.isNaN(parsed.getTime())
              ? new Date()
              : parsed;
            const seasonStartYear =
              baseDate.getMonth() >= 8
                ? baseDate.getFullYear()
                : baseDate.getFullYear() - 1;
            return `/v1/club-schedule-season/mtl/${seasonStartYear}${seasonStartYear + 1}`;
          },
        },
        '/api/stm-alerts': {
          target: 'https://api.stm.info',
          changeOrigin: true,
          headers: stmProxyHeaders,
          rewrite: () => '/pub/od/gtfs-rt/ic/v2/serviceAlerts',
        },
      },
    },
    plugins: [
      devApiFallbacks,
      react(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        registerType: 'autoUpdate',
        devOptions: {
          enabled: true,
        },
        includeAssets: ['favicon.ico', 'pwa-icon-192.png', 'pwa-icon-512.png'],
        manifest: {
          name: 'Delivroom',
          short_name: 'Delivroom',
          description: 'Optimise tes trajets, booste tes revenus.',
          theme_color: '#0a0a1a',
          background_color: '#0a0a1a',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          icons: [
            {
              src: '/pwa-icon-192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: '/pwa-icon-512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: '/pwa-icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-query': ['@tanstack/react-query'],
            'vendor-supabase': ['@supabase/supabase-js'],
            'vendor-map': ['mapbox-gl', 'react-map-gl'],
            'vendor-ui': [
              '@radix-ui/react-dialog',
              '@radix-ui/react-dropdown-menu',
              '@radix-ui/react-select',
              '@radix-ui/react-switch',
              '@radix-ui/react-tabs',
              '@radix-ui/react-toast',
            ],
          },
        },
      },
    },
  };
});
