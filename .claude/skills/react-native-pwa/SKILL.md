---
name: react-native-pwa
description: Création et configuration de Progressive Web Apps (PWA) installables avec React + Vite + TypeScript. Utilise ce skill dès que l'utilisateur mentionne PWA, service workers, manifest, offline-first, installation sur mobile, ou veut rendre son app React installable comme une app native. Applicable directement pour Delivroom/Delivroom sur Delivroom.lovable.app.
---

# React PWA — Progressive Web App

Transformer une app React/Vite en PWA installable sur Android/iOS.

## Stack cible

```
React + Vite + TypeScript + Tailwind
+ vite-plugin-pwa (Workbox)
+ Web App Manifest
+ Service Worker
```

## Setup rapide

### 1. Installer le plugin

```bash
npm install -D vite-plugin-pwa
```

### 2. Configuration `vite.config.ts`

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt', 'icons/*.png'],
      manifest: {
        name: 'Delivroom',
        short_name: 'GeoHustle',
        description: 'Optimisation positionnement chauffeur Montréal',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ],
        categories: ['navigation', 'productivity'],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 300 },
            },
          },
          {
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
        ],
      },
    }),
  ],
})
```

### 3. Icônes requises

```bash
# Générer depuis un PNG source 1024x1024
# Utiliser: https://www.pwabuilder.com/imageGenerator
public/
└── icons/
    ├── icon-192.png    (192×192)
    ├── icon-512.png    (512×512)
    └── apple-touch-icon.png  (180×180)
```

### 4. Bouton "Installer l'app" (Android)

```typescript
// hooks/usePWAInstall.ts
import { useState, useEffect } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function usePWAInstall() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstallable, setIsInstallable] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as BeforeInstallPromptEvent)
      setIsInstallable(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const install = async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') setIsInstallable(false)
  }

  return { isInstallable, install }
}
```

### 5. Détection offline

```typescript
// hooks/useOnlineStatus.ts
import { useState, useEffect } from 'react'

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  useEffect(() => {
    const go = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('online', go)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', go)
      window.removeEventListener('offline', off)
    }
  }, [])

  return isOnline
}
```

## Stratégies de cache Workbox

| Stratégie | Usage | Exemple |
|---|---|---|
| `CacheFirst` | Assets statiques, tuiles de carte | Tuiles OSM, fonts |
| `NetworkFirst` | Données en temps réel | Scores Supabase, auth |
| `StaleWhileRevalidate` | Semi-statique | Config app, zones |
| `NetworkOnly` | Toujours frais | Positions GPS live |

## Checklist PWA

```
✅ manifest.json valide (Lighthouse score)
✅ HTTPS (obligatoire pour service worker)
✅ Icônes 192px et 512px
✅ start_url accessible offline
✅ theme_color défini
✅ Service worker enregistré
✅ Bouton install (Android)
✅ Contenu offline fallback
✅ Pas d'erreurs console
```

## Tester la PWA

```bash
npm run build && npm run preview
# Puis Lighthouse > PWA dans Chrome DevTools
# Ou: npx serve dist
```

## Push Notifications (Supabase + Web Push)

```typescript
// Demander permission
const permission = await Notification.requestPermission()
if (permission === 'granted') {
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: VAPID_PUBLIC_KEY
  })
  // Sauvegarder sub dans Supabase
  await supabase.from('push_subscriptions').insert({ subscription: sub })
}
```
