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

## 7. Alternative : capture automatisée via `scripts/scrape_lyft_metrics.py` + `scripts/server.py`

Plutôt que de faire prendre les 3 captures manuellement par MacroDroid (étape
2 ci-dessus), `scripts/scrape_lyft_metrics.py` (voir §5 de ce même dossier
`docs/`, ou directement le fichier) automatise tout via `uiautomator2` :
ouvre Lyft Driver, navigue jusqu'aux 3 écrans, capture, résout le GPS, et
POST vers cet endpoint lui-même. `scripts/server.py` est un petit bridge
HTTP qui tourne sur le PC pour que MacroDroid puisse déclencher ce script à
distance (le téléphone n'a pas d'accès SSH/ADB direct au PC).

### 7.1 Configuration (une seule fois)

```bash
# Génère une valeur aléatoire, distincte de INGEST_LYFT_API_KEY
echo "LYFT_BRIDGE_API_KEY=<génère un token aléatoire>" >> .env
python scripts/server.py --selftest   # vérifie la logique offline avant de lancer le vrai serveur
python scripts/server.py              # écoute sur 0.0.0.0:5000
```

Garde ce process actif pendant tes shifts (ex. lancé au démarrage de
session Windows, ou manuellement avant de partir). Autorise le port 5000
dans le pare-feu Windows pour les réseaux privés/Tailscale si demandé.

### 7.2 Endpoint du bridge

```
GET/POST http://<IP-du-PC>:5000/run-lyft-scrape?token=<LYFT_BRIDGE_API_KEY>
GET       http://<IP-du-PC>:5000/health   # vérifie juste que le bridge répond, sans déclencher de scrape
```

`<IP-du-PC>` : l'IP Tailscale du PC (ex. `100.x.x.x`, visible dans l'app
Tailscale) si tu veux pouvoir déclencher hors du wifi maison, ou son IP
locale (`192.168.x.x`) sinon. Réponse :

```json
{ "status": "triggered", "timestamp": "2026-08-29T20:15:00.000Z" }
```

`"status": "already_running"` si un scrape est déjà en cours (le bridge
refuse d'en lancer un second en parallèle — `uiautomator2` ne supporte pas
deux sessions concurrentes sur le même appareil). `401` si `token` est
absent ou incorrect.

### 7.3 Recette MacroDroid

1. **Trigger** : au choix — raccourci manuel, ou intervalle pendant un shift actif.
2. **Action "HTTP Request"** :
   - Méthode : `GET`
   - URL : `http://<IP-du-PC>:5000/run-lyft-scrape?token=<LYFT_BRIDGE_API_KEY>`
3. (Optionnel) Teste d'abord `http://<IP-du-PC>:5000/health` dans un
   navigateur depuis le téléphone pour confirmer que le PC est joignable
   avant de configurer l'action HTTP Request.

Le bridge lui-même n'appelle aucune API vision — il se contente de lancer
`scrape_lyft_metrics.py`, qui POST ensuite vers `ingest-lyft-screenshots`
(§1-§4 ci-dessus) exactement comme le flux MacroDroid manuel.

## 8. Déclenchement 100% automatique — lancement de l'app Delivroom

Plutôt qu'un raccourci ou un intervalle (§7.3), la macro peut se déclencher
chaque fois que tu ouvres la PWA Delivroom sur le S23 Ultra — plus aucune
action manuelle pendant un shift.

### 8.1 Recette MacroDroid

1. **Trigger** : `Application Launched` → sélectionne l'app/PWA Delivroom
   (`com.delivroom.app` si installée via Capacitor, ou le paquet du
   navigateur/TWA si lancée comme raccourci d'écran d'accueil).
2. **Action "HTTP Request"** :
   - Méthode : `GET`
   - URL : `http://<IP-du-PC>:5000/run-lyft-scrape?token=<LYFT_BRIDGE_API_KEY>`
3. **Constraint (limite de fréquence)** : `Application Launched` peut se
   déclencher très souvent (chaque retour au premier plan). Deux niveaux de
   protection, à ne pas confondre :
   - **Contrainte MacroDroid** (recommandé, évite même l'appel HTTP inutile) :
     ajoute une contrainte `Variable Value` sur une variable locale
     `%last_lyft_scrape_trigger%` (timestamp), avec condition "il y a plus de
     5 minutes" — sinon la macro s'arrête avant même de faire la requête.
   - **Backstop côté serveur** (déjà actif, aucune config requise) :
     `scripts/server.py` refuse tout nouveau déclenchement survenu moins de
     5 minutes après le précédent, même si MacroDroid retente quand même —
     réponse `{"status": "rate_limited", "retry_after_seconds": N}` (toujours
     `200`, jamais une erreur qui ferait échouer la macro). `already_running`
     reste un cas distinct : un scrape *en cours* (pas encore terminé), pas
     lié à ce délai de 5 minutes.

Le bridge, `scrape_lyft_metrics.py` et `ingest-lyft-screenshots` restent
exactement les mêmes qu'en §7 — seul le trigger MacroDroid change.
