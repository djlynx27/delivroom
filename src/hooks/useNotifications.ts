import { useDemandScores } from '@/hooks/useDemandScores';
import type { Zone } from '@/hooks/useSupabase';
import { haversineKm, useUserLocation } from '@/hooks/useUserLocation';
import { useCallback, useEffect, useRef, useState } from 'react';

const NOTIF_COOLDOWN_MS = 15 * 60_000; // 15 min per notification type
const NOTIFIED_EVENTS_KEY = 'geohustle_notified_events';
const PUSH_SUBSCRIPTION_KEY = 'delivroom_push_subscription_registered';

function base64UrlToUint8Array(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const bytes = new Uint8Array(raw.length);

  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }

  return bytes;
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return window
    .btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function registerPushSubscription(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (Notification.permission !== 'granted') return;

  const env = (
    import.meta as unknown as { env: Record<string, string | undefined> }
  ).env;
  const vapidPublicKey = env.VITE_VAPID_PUBLIC_KEY;
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const supabaseAnonKey =
    env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!vapidPublicKey || !supabaseUrl || !supabaseAnonKey) return;

  const registration = await navigator.serviceWorker.ready;
  const existingSubscription = await registration.pushManager.getSubscription();
  const subscription =
    existingSubscription ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(vapidPublicKey),
    }));

  const json = subscription.toJSON();
  const endpoint = json.endpoint;
  const p256dh = subscription.getKey('p256dh');
  const auth = subscription.getKey('auth');

  if (!endpoint || !p256dh || !auth) return;

  const registrationFingerprint = `${endpoint}:${bufferToBase64Url(auth)}`;
  if (localStorage.getItem(PUSH_SUBSCRIPTION_KEY) === registrationFingerprint) {
    return;
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/push_subscriptions?on_conflict=endpoint`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([
        {
          endpoint,
          p256dh: bufferToBase64Url(p256dh),
          auth: bufferToBase64Url(auth),
          user_agent:
            typeof navigator !== 'undefined' ? navigator.userAgent : null,
        },
      ]),
    }
  );

  if (!response.ok) {
    throw new Error(`push_subscriptions upsert failed: ${response.status}`);
  }

  localStorage.setItem(PUSH_SUBSCRIPTION_KEY, registrationFingerprint);
}

function getNotifiedEvents(): Set<string> {
  try {
    const raw = localStorage.getItem(NOTIFIED_EVENTS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function markEventNotified(eventId: string) {
  const set = getNotifiedEvents();
  set.add(eventId);
  // Keep only last 200 to avoid unbounded growth
  const arr = [...set];
  if (arr.length > 200) arr.splice(0, arr.length - 200);
  try {
    localStorage.setItem(NOTIFIED_EVENTS_KEY, JSON.stringify(arr));
  } catch {
    // localStorage unavailable; notification dedupe cache is not persisted.
  }
}

interface NotifState {
  lastDemandNotif: number;
  lastWeatherNotif: number;
  lastBarNotif: number;
  lastSurgeNotif: number;
  lastDriftNotif: number;
  prevWeatherId: number | null;
  stationarySince: number | null;
  stationaryLat: number | null;
  stationaryLng: number | null;
}

function getGoogleMapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

async function sendNotification(title: string, body: string, url?: string) {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;

  // Try service worker notification first (works in background)
  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, {
      body,
      icon: '/pwa-icon-192.png',
      badge: '/pwa-icon-192.png',
      tag: title.slice(0, 20),
      renotify: true,
      data: { url },
      actions: url ? [{ action: 'go', title: 'GO →' }] : [],
    } as NotificationOptions);
    return;
  }

  // Fallback to basic notification
  new Notification(title, { body, icon: '/pwa-icon-192.png' });
}

function findNearestZone(lat: number, lng: number, zones: Zone[]): Zone | null {
  let best: Zone | null = null;
  let bestDist = Infinity;
  for (const z of zones) {
    const d = haversineKm(lat, lng, z.latitude, z.longitude);
    if (d < bestDist) {
      bestDist = d;
      best = z;
    }
  }
  return best;
}

export function useNotifications(
  cityId: string,
  options: { conservativePresence?: boolean } = {}
) {
  const [enabled, setEnabled] = useState(
    () =>
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
  );
  const { location: userLocation } = useUserLocation();
  const { scores, zones, weather, endingSoon, startingSoon, surgeMap } =
    useDemandScores(cityId, {
      currentLat: userLocation?.latitude ?? null,
      currentLng: userLocation?.longitude ?? null,
      conservativePresence: options.conservativePresence,
    });
  const stateRef = useRef<NotifState>({
    lastDemandNotif: 0,
    lastWeatherNotif: 0,
    lastBarNotif: 0,
    lastSurgeNotif: 0,
    lastDriftNotif: 0,
    prevWeatherId: null,
    stationarySince: null,
    stationaryLat: null,
    stationaryLng: null,
  });

  const requestPermission = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window))
      return false;
    const result = await Notification.requestPermission();
    setEnabled(result === 'granted');
    if (result === 'granted') {
      try {
        await registerPushSubscription();
      } catch (error) {
        console.error('push subscription registration failed', error);
      }
    }
    return result === 'granted';
  }, []);

  useEffect(() => {
    if (!enabled) return;

    void registerPushSubscription().catch((error) => {
      console.error('push subscription bootstrap failed', error);
    });
  }, [enabled]);

  // Check demand spikes
  useEffect(() => {
    if (!enabled || !userLocation) return;
    const now = Date.now();
    const s = stateRef.current;
    if (now - s.lastDemandNotif < NOTIF_COOLDOWN_MS) return;

    for (const zone of zones) {
      const score = scores.get(zone.id) ?? 0;
      if (score < 85) continue;
      const dist = haversineKm(
        userLocation.latitude,
        userLocation.longitude,
        zone.latitude,
        zone.longitude
      );
      if (dist > 5) continue;

      sendNotification(
        '🔴 Forte demande',
        `${zone.name} · Score ${score}/100 · ${dist.toFixed(1)} km`,
        getGoogleMapsUrl(zone.latitude, zone.longitude)
      );
      s.lastDemandNotif = now;
      break;
    }
  }, [enabled, scores, zones, userLocation]);

  // PRE-EVENT: 90 min before event starts — ONCE per event (localStorage dedup)
  useEffect(() => {
    if (!enabled || !startingSoon || startingSoon.length === 0) return;
    const now = Date.now();
    const notified = getNotifiedEvents();

    for (const ev of startingSoon) {
      if (notified.has(ev.id)) continue; // Already sent for this event

      const startMs = new Date(ev.start_at).getTime();
      const minsUntil = Math.round((startMs - now) / 60_000);

      const nearZone = findNearestZone(ev.latitude, ev.longitude, zones);
      const zoneName = nearZone?.name || 'la zone';
      const attendance = ev.capacity;
      const attendanceText =
        attendance && attendance > 0
          ? ` — ${attendance.toLocaleString()} personnes attendues`
          : '';

      sendNotification(
        `🎫 Événement dans ${minsUntil}min`,
        `${ev.name} à ${ev.venue}${attendanceText}. Positionnez-vous près de ${zoneName} pour la surge!`,
        getGoogleMapsUrl(ev.latitude, ev.longitude)
      );
      markEventNotified(ev.id);
      break; // one at a time
    }
  }, [enabled, startingSoon, zones]);

  // Check events ending in 30 min — ONCE per event (localStorage dedup)
  useEffect(() => {
    if (!enabled) return;
    const now = Date.now();
    const notified = getNotifiedEvents();

    for (const ev of endingSoon) {
      const endingKey = `ending_${ev.id}`;
      if (notified.has(endingKey)) continue;

      const endMs = new Date(ev.end_at).getTime();
      const minsLeft = Math.round((endMs - now) / 60_000);
      if (minsLeft > 30 || minsLeft < 0) continue;

      sendNotification(
        `🏒 ${ev.name}`,
        `Se termine dans ${minsLeft}min - Positionnez-vous!`,
        getGoogleMapsUrl(ev.latitude, ev.longitude)
      );
      markEventNotified(endingKey);
      break;
    }
  }, [enabled, endingSoon]);

  // Friday/Saturday 02:15 bar closing
  useEffect(() => {
    if (!enabled) return;
    const checkBarClosing = () => {
      const now = new Date();
      const day = now.getDay();
      const h = now.getHours();
      const m = now.getMinutes();
      const s = stateRef.current;

      // Friday=5 or Saturday=6, at 02:15
      if ((day === 5 || day === 6) && h === 2 && m >= 15 && m < 30) {
        if (Date.now() - s.lastBarNotif < NOTIF_COOLDOWN_MS) return;
        sendNotification(
          '🍺 Bars ferment dans 45min',
          'Crescent/St-Laurent au max',
          getGoogleMapsUrl(45.4985, -73.5726) // Crescent St
        );
        s.lastBarNotif = Date.now();
      }
    };

    checkBarClosing();
    const interval = setInterval(checkBarClosing, 60_000);
    return () => clearInterval(interval);
  }, [enabled]);

  // Weather change detection
  useEffect(() => {
    if (!enabled || !weather) return;
    const s = stateRef.current;
    const now = Date.now();

    if (
      s.prevWeatherId !== null &&
      s.prevWeatherId >= 700 &&
      weather.weatherId < 700
    ) {
      if (now - s.lastWeatherNotif >= NOTIF_COOLDOWN_MS) {
        sendNotification(
          '🌧️ Précipitations détectées',
          'Demande en hausse partout'
        );
        s.lastWeatherNotif = now;
      }
    }
    s.prevWeatherId = weather.weatherId;
  }, [enabled, weather]);

  // Surge PEAK alert — fires when any zone in the city crosses peak threshold
  useEffect(() => {
    if (!enabled || !surgeMap || surgeMap.size === 0) return;
    const s = stateRef.current;
    const now = Date.now();
    if (now - s.lastSurgeNotif < NOTIF_COOLDOWN_MS) return;

    const peakZones = zones.filter(
      (z) => surgeMap.get(z.id)?.surgeClass === 'peak'
    );
    if (peakZones.length === 0) return;

    // If user has GPS, prefer the closest peak zone
    let targetZone = peakZones[0]!;
    if (userLocation && peakZones.length > 1) {
      let bestDist = Infinity;
      for (const z of peakZones) {
        const dlat = ((z.latitude - userLocation.latitude) * Math.PI) / 180;
        const dlng = ((z.longitude - userLocation.longitude) * Math.PI) / 180;
        const a =
          Math.sin(dlat / 2) ** 2 +
          Math.cos((userLocation.latitude * Math.PI) / 180) *
            Math.cos((z.latitude * Math.PI) / 180) *
            Math.sin(dlng / 2) ** 2;
        const d = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        if (d < bestDist) {
          bestDist = d;
          targetZone = z;
        }
      }
    }

    const surge = surgeMap.get(targetZone.id);
    const multiplier = surge ? `${surge.surgeMultiplier.toFixed(2)}×` : '';
    const extra =
      peakZones.length > 1 ? ` + ${peakZones.length - 1} autre(s)` : '';

    sendNotification(
      `🔴 PEAK Surge ${multiplier} — ${targetZone.name}`,
      `Demande maximale${extra}. Allez-y maintenant!`,
      `https://www.google.com/maps/dir/?api=1&destination=${targetZone.latitude},${targetZone.longitude}&travelmode=driving`
    );
    s.lastSurgeNotif = now;
  }, [enabled, surgeMap, zones, userLocation]);

  useEffect(() => {
    if (!enabled || !userLocation) return;

    const s = stateRef.current;
    const now = Date.now();
    const speedKmh = userLocation.speed == null ? 0 : userLocation.speed * 3.6;

    if (s.stationaryLat == null || s.stationaryLng == null) {
      s.stationaryLat = userLocation.latitude;
      s.stationaryLng = userLocation.longitude;
      s.stationarySince = now;
      return;
    }

    const movedKm = haversineKm(
      s.stationaryLat,
      s.stationaryLng,
      userLocation.latitude,
      userLocation.longitude
    );

    if (movedKm > 0.12 || speedKmh >= 8) {
      s.stationaryLat = userLocation.latitude;
      s.stationaryLng = userLocation.longitude;
      s.stationarySince = now;
      return;
    }

    if (s.stationarySince == null) {
      s.stationarySince = now;
      return;
    }

    if (
      now - s.stationarySince < 12 * 60_000 ||
      now - s.lastDriftNotif < NOTIF_COOLDOWN_MS
    ) {
      return;
    }

    const nearbyTarget = [...zones]
      .map((zone) => ({
        zone,
        score: scores.get(zone.id) ?? 0,
        distKm: haversineKm(
          userLocation.latitude,
          userLocation.longitude,
          zone.latitude,
          zone.longitude
        ),
      }))
      .filter((entry) => entry.distKm <= 8)
      .sort((left, right) => right.score - left.score)[0];

    const body = nearbyTarget
      ? options.conservativePresence
        ? `Immobile depuis 12 min. Garde Lyft actif et place un filtre destination vers ${nearbyTarget.zone.name} (${nearbyTarget.distKm.toFixed(1)} km).`
        : `Immobile depuis 12 min. ${nearbyTarget.zone.name} est à ${nearbyTarget.distKm.toFixed(1)} km avec ${nearbyTarget.score}/100.`
      : 'Immobile depuis 12 min. Réévalue ta zone active sur Lyft.';

    sendNotification(
      '🧭 Alerte de dérive',
      body,
      nearbyTarget
        ? getGoogleMapsUrl(
            nearbyTarget.zone.latitude,
            nearbyTarget.zone.longitude
          )
        : undefined
    );
    s.lastDriftNotif = now;
    s.stationarySince = now;
  }, [enabled, options.conservativePresence, scores, userLocation, zones]);

  return { enabled, requestPermission };
}
