# `ingest-lyft-screenshots` — intégration MacroDroid

Webhook Edge Function qui ingère 3 captures Lyft Driver (wait times, recent
demand, nearby drivers) + la position GPS, extrait un snapshot via Gemini
Vision, et l'enregistre dans `platform_signals` (lu par `useDemandScores.ts`
pour le Lyft Realtime Factor). Voir `supabase/functions/ingest-lyft-screenshots/index.ts`
pour le code.

## 1. Configuration (une seule fois)

```bash
# Secret dédié — jamais l'anon key ni la service_role key
supabase secrets set INGEST_LYFT_API_KEY=<génère un token aléatoire>
supabase functions deploy ingest-lyft-screenshots --no-verify-jwt
```

Garde le token généré en lieu sûr — c'est lui que MacroDroid doit envoyer
dans le header `Authorization`.

## 2. Endpoint

```
POST https://hibzhsjgipybfihhzpxr.supabase.co/functions/v1/ingest-lyft-screenshots
Authorization: Bearer <INGEST_LYFT_API_KEY>
Content-Type: application/json
```

## 3. Format du corps (JSON)

Chaque image peut être envoyée soit comme une URL déjà présente dans le
bucket Storage de l'app (`*_image_url`), soit directement en base64
(`*_image_base64`) — c'est cette deuxième option qui convient à MacroDroid,
qui ne peut pas facilement s'authentifier pour faire un upload Storage
séparé au préalable.

```json
{
  "wait_times_image_base64": "data:image/jpeg;base64,/9j/4AAQ...",
  "recent_demand_image_base64": "data:image/jpeg;base64,/9j/4AAQ...",
  "nearby_drivers_image_base64": "data:image/jpeg;base64,/9j/4AAQ...",
  "latitude": 45.5017,
  "longitude": -73.5673
}
```

- `*_image_base64` accepte soit une URI `data:image/...;base64,...` complète,
  soit du base64 brut (mimeType par défaut : `image/jpeg`).
- `latitude` / `longitude` : position GPS actuelle du chauffeur — sert à
  résoudre la zone la plus proche si `zone_id` n'est pas fourni.
- `zone_id` (optionnel) : force la zone cible et saute la résolution GPS.

## 4. Réponse

```json
{
  "ok": true,
  "zone_id": "mtl-downtown",
  "snapshot": {
    "demand_score": 8,
    "wait_time_min": 4,
    "nearby_drivers_count": 2
  }
}
```

Erreurs possibles : `400` (image/GPS manquant), `401` (clé API invalide),
`429` (rate-limit, 20 req/min), `502` (Gemini n'a pas pu extraire un
snapshot valide), `500` (config serveur incomplète).

## 5. Recette MacroDroid

1. **Trigger** : selon ton flux — ex. un raccourci/notification manuel
   quand tu veux capturer l'état actuel de Lyft, ou un intervalle
   (ex. toutes les 15 min pendant un shift actif).
2. **Action "Prendre une capture d'écran"** ×3 — une par écran Lyft Driver
   (Wait Times, Recent Demand, Nearby Drivers), dans cet ordre précis.
3. **Action "Obtenir la position GPS"** pour récupérer lat/lng courants.
4. **Action "Fichier vers Base64"** sur chacune des 3 captures (variables
   locales `%wait_b64%`, `%demand_b64%`, `%nearby_b64%`).
5. **Action "HTTP Request"** :
   - Méthode : `POST`
   - URL : `https://hibzhsjgipybfihhzpxr.supabase.co/functions/v1/ingest-lyft-screenshots`
   - Headers : `Authorization: Bearer <ton INGEST_LYFT_API_KEY>` et
     `Content-Type: application/json`
   - Corps (JSON, variables MacroDroid entre `%...%`) :
     ```json
     {
       "wait_times_image_base64": "data:image/jpeg;base64,%wait_b64%",
       "recent_demand_image_base64": "data:image/jpeg;base64,%demand_b64%",
       "nearby_drivers_image_base64": "data:image/jpeg;base64,%nearby_b64%",
       "latitude": %lv_latitude%,
       "longitude": %lv_longitude%
     }
     ```

## 6. Vérifier

Une fois un snapshot inséré, la zone correspondante doit apparaître avec un
score ajusté par le Lyft Realtime Factor dans l'app (Hero card / HUD) sous
quelques secondes — `useDemandScores.ts` relit `platform_signals` en continu.
