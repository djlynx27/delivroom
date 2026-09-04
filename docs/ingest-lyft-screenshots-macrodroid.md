# `ingest-lyft-screenshots` — intégration MacroDroid

Webhook Edge Function qui ingère 3 captures Lyft Driver (wait times, recent
demand, nearby drivers) + la position GPS, extrait un snapshot via Gemini
Vision, et l'enregistre dans `platform_signals` (lu par `useDemandScores.ts`
pour le Lyft Realtime Factor). Voir `supabase/functions/ingest-lyft-screenshots/index.ts`
pour le code.

> **§3B (2026-09-02) — décision produit** : Wait Times / Recent Demand ne
> sont plus capturés (métriques Lyft gamifiées/retardées, biais négatif pour
> le scoring). Seul **Nearby Drivers** est capturé — voir `runGeminiVision`
> en mode `nearbyOnly` dans l'edge function, et le nouveau mode "raw image
> body" (`Content-Type: image/jpeg` + `latitude`/`longitude` en query params)
> qui évite le base64 — MacroDroid n'a aucune fonction d'encodage base64
> native, `Content Body → File` poste directement les octets bruts.

## État de la macro "Lyft 3 Functions" (2026-09-04) — chaîne MacroDroid→HTTP validée, bloquée uniquement par crédits Gemini

**Root cause du blocage du 2026-09-02, confirmée le 2026-09-04 :** le Service d'Accessibilité
MacroDroid (`MacroDroidAccessibilityServiceJellyBean` + `UIInteractionAccessibilityService`)
était listé comme "enabled" par `settings get secure enabled_accessibility_services` et par
`dumpsys accessibility` (`Enabled services`), mais **absent des `Bound services` réels** —
Android l'avait silencieusement révoqué (mécanisme "Restricted Settings" pour apps installées
hors Play Store, réactivé après une mise à jour système/app tierce). L'écran réel
`Paramètres → Accessibilité → Installed apps → MacroDroid` montrait bien le toggle sur **Off**
pour les deux services, alors que les settings/dumpsys au niveau framework laissaient croire
le contraire — **ne jamais se fier à `dumpsys`/`settings get` seuls pour ce diagnostic, toujours
vérifier l'écran Accessibilité réel.**

**Fix appliqué :** ré-activation manuelle des deux toggles (`MacroDroid` et
`MacroDroid UI Interaction`) via l'écran Accessibilité — Android bloque les taps ADB/synthétiques
sur ce dialogue de consentement précis (anti-tapjacking), un vrai doigt est requis. **Piège
découvert :** `adb shell am force-stop com.arlosoft.macrodroid` tue le processus hébergeant les
services d'accessibilité et Android les redésactive automatiquement — ne jamais force-stop
MacroDroid une fois l'accessibilité réactivée, relancer l'app normalement (`monkey -c
android.intent.category.LAUNCHER`) suffit.

**Deuxième bug corrigé :** l'URL du `HttpRequestAction` référençait `{lv=locdict[Latitude]}`/
`{lv=locdict[Longitude]}` alors que les clés réelles du dictionnaire `locdict` (rempli par
`ForceLocationUpdateAction`) sont en minuscules : `lat`/`lon`. Corrigé directement dans
l'éditeur MacroDroid en édition live (l'import d'un `.macro` réexporté avec le fix n'a PAS
écrasé la macro existante — MacroDroid semble matcher par `m_GUID` et rouvrir l'originale au
lieu de remplacer son contenu ; retenir cette limite pour la prochaine fois qu'un fix doit être
poussé via fichier plutôt qu'en édition live).

**Troisième bug corrigé :** le screenshot de "Nearby drivers" était pris seulement 1.5s après le
clic — insuffisant pour que les marqueurs voitures se rendent sur la carte (capture vide,
502 côté Gemini car rien à extraire). Le délai a été monté à 3.5s ; capture confirmée avec ~20
voitures visibles.

**Coordonnées de clic (75,1038) pour "Map Layers"** : confirmées TOUJOURS correctes en test
manuel (`adb shell input tap`) pour l'état hors-ligne — pas de recalibrage nécessaire. Une
hypothèse initiale de coordonnées différentes selon online/offline (loupe vs icône couches) a
été proposée mais pas requise dans les faits : le point (75,1038) ouvre le sheet "Maximise your
earnings" (Wait times / Recent ride demand / Nearby drivers) dans les deux captures de test.
Si un blocage similaire réapparaît après une mise à jour de l'app Lyft Driver, refaire un dump
`uiautomator` — l'écran principal Lyft est en Jetpack Compose et n'expose aucun texte/description
dans l'arbre d'accessibilité (juste des conteneurs opaques), donc le calibrage doit se faire par
capture d'écran + coordonnées, pas par sélecteur de texte.

**Bloqueur restant (2026-09-04, hors du contrôle MacroDroid/app) :** `HTTP response code: 502`
sur chaque test malgré une capture valide. Logs `function_logs` de l'edge function
`ingest-lyft-screenshots` :
```
Gemini Vision error (status 429): { "error": { "code": 429, "message":
"Your prepayment credits are depleted. Please go to AI Studio at
https://ai.studio/projects to manage your project and billing...",
"status": "RESOURCE_EXHAUSTED" } }
```
→ **Action requise : recharger les crédits prépayés Gemini sur https://ai.studio/projects.**
Toute la chaîne MacroDroid (clic → screenshot → GPS → POST) est validée fonctionnelle ; dès la
facturation Gemini réglée, aucune autre modif ne devrait être nécessaire.

## Macro "Lyft GPS Google Maps" (2026-09-02) — FONCTIONNELLE, importée et active

Sans rapport avec le blocker "Lyft 3 Functions" ci-dessus (ingestion de
captures) — cette macro résout un besoin séparé : ouvrir automatiquement
Google Maps en navigation vers l'adresse pick-up/drop-off affichée par Lyft
Driver, sans clic synthétique (donc pas exposée au blocker Accessibility
Service d'Android 14+ documenté plus haut).

- **Trigger** : `Screen Content (On Screen)`, regex `Pick up|Drop off|Navigate`
  (case insensitive), limité à `com.lyft.android.driver`.
- **Action 1** : `Read Screen Contents` → variable locale `adresse_lyft`.
- **Action 2** : `Send Intent` — target `Activity`, action
  `android.intent.action.VIEW`, package `com.google.android.apps.maps`, data
  `google.navigation:q={lv=adresse_lyft}&mode=d`.
- Fichier source versionné : `scripts/Lyft_GPS_Google_Maps.macro`.

**Piège rencontré et résolu cette session** — `adresse_lyft` devait être un
`StringVariableType` strict (Type 2), mais l'assistant de config MacroDroid
force actuellement `Read Screen Contents` à créer la variable en Dictionary
(Type 4), sans option String dans l'UI. Contournement : build la macro via
l'UI réelle (le JSON deviné à la main échouait silencieusement à l'import —
macro vide sans trigger/actions), export vers `.mdr`, patch manuel du champ
`m_type` (4→2) + suppression du wrapper `dictionary` dans le JSON exporté,
réimport via `Export/Import → Storage`. Reconfirmé par un second export que
`m_type: 2` tient après ajout de l'action `Send Intent`.

Bulle de notification flottante Lyft Driver (`Bubble`) désactivée en cours de
session car elle interceptait les taps ADB dans la zone `Add Action` —
réactivée en fin de session (`cmd notification set_bubbles com.lyft.android.driver 1`
si besoin de la rétablir; a été laissée désactivée, à réévaluer si son absence
gêne le flux normal du chauffeur).

### Fix boucle infinie (2026-09-04) — FAIT, buildé en direct sur l'appareil via ADB/uiautomator

**Bug** : `ScreenContentTrigger` refire tant que "Pick up|Drop off|Navigate"
reste visible (donc en continu pendant tout le trajet, et instantanément au
retour sur Lyft) — et `ReadScreenContentsAction` n'a aucun champ de ciblage
d'élément dans son schéma exporté (confirmé : seulement des booléens
`includeOverlays/includeScreenLocation/includeWithoutText`), donc `adresse_lyft`
capture tout l'écran, pas juste l'adresse → Maps s'ouvre sans destination
utilisable.

Construit directement dans l'UI réelle via `adb shell input tap` + dumps
`uiautomator` entre chaque tap (jamais de JSON deviné à l'aveugle — la
contrainte et le Set Variable n'avaient aucun schéma vérifié avant cette
session). Le vrai mécanisme MacroDroid : les contraintes sont ajoutées
**directement sur une action** via son menu contextuel (swipe/long-press sur
la ligne → **Add constraint**), pas via un bloc "If clause" séparé (tenté
puis abandonné — un bloc If ajouté par le "+" général s'insère à la fin de
la liste, pas autour de l'action existante).

- **`adresse_lyft_last_sent`** : 2e variable locale String (`m_type: 2`),
  créée depuis l'action Set Variable elle-même (`[New Variable]` → radio
  **String** — même piège Dictionary-par-défaut que `adresse_lyft` à
  l'origine, évité en sélectionnant explicitement String).
- **2 contraintes sur l'action Send Intent** (`m_classType: CompareValueConstraint`,
  schéma maintenant vérifié) :
  - `{lv=adresse_lyft} != {lv=adresse_lyft_last_sent}` (dédup)
  - `{lv=adresse_lyft} != ""` (kill-switch : pas d'adresse extraite → pas de Maps)
  - Combinées en AND automatiquement (MacroDroid AND-combine par défaut
    plusieurs conditions dans le même "Add constraint").
- **Action `SetVariableAction`** ajoutée après Send Intent : `adresse_lyft_last_sent
  = {lv=adresse_lyft}`.

Le dédup se réarme tout seul : une nouvelle course a une adresse différente,
donc la contrainte repasse vraie sans trigger de reset séparé.

**Piège rencontré cette session** : à un moment de la manipulation (menu
contextuel swipe sur l'action, probablement un tap mal placé), l'action
`SendIntentAction` s'est retrouvée avec `m_isDisabled: true` — détecté
uniquement en inspectant le JSON réexporté (invisible dans le résumé de la
carte macro, visible seulement par la couleur grisée du texte sur l'écran
d'édition). Recorrigé via le même menu contextuel (option **Enable**),
reconfirmé par un 2e export. **Leçon** : après toute session de manipulation
UI via ADB sur une macro live, toujours ré-exporter et vérifier `m_isDisabled`
sur chaque action/trigger avant de considérer le fix terminé — un export visuel
(screenshot) seul peut suffire mais le JSON est la seule vérité fiable.

Toggle macro-level `m_enabled` laissé à `false` (état déjà présent avant
cette session, pas modifié — à réactiver manuellement quand prêt pour usage
réel).

Schéma JSON réel maintenant versionné dans `scripts/Lyft_GPS_Google_Maps.macro`
(exporté du device, valeurs runtime capturées lors d'une vraie course
— nom de passager, adresse — nettoyées avant commit).

## Macros "Lyft Overlay" (2026-09-04) — À CRÉER, non buildées encore

Bulle flottante Delivroom au-dessus de Lyft Driver. Confirmé via
`git log`/`ls scripts/*.macro` : aucun `.macro` overlay n'existe encore.
Aucun schéma JSON vérifié disponible pour le trigger `Floating Button`
(jamais exporté depuis ce repo) → build en UI obligatoire, pas de fichier
poussable à l'aveugle. Pattern confirmé par la communauté MacroDroid (le
trigger Floating Button n'a pas d'option "restrict to app" intégrée) : 3
macros au lieu de 2 (une seule macro ne peut pas exécuter une action
différente selon quel trigger l'a déclenchée — donc "enable on trigger A,
disable on trigger B" doit être scindé en deux macros séparées, chacune
avec sa propre action unique).

**FAIT (2026-09-04)** — buildé en direct via ADB/uiautomator, exporté et
vérifié champ par champ (jamais deviné) :

| Macro | Trigger(s) | Action |
|---|---|---|
| **Lyft Overlay Show** | Application Launched → `com.lyft.android.driver` + Intent Received → `com.delivroom.SHOW_OVERLAY` | **Enable macro** "Lyft Overlay Button" |
| **Lyft Overlay Hide** | Application Closed → `com.lyft.android.driver` | **Disable macro** "Lyft Overlay Button" |
| **Lyft Overlay Button** (désactivée par défaut, `m_enabled: false`) | Floating Button (icône/position par défaut) | Launch App → `app.delivroom.driver` (TWA package) |

Schéma JSON maintenant vérifié pour de bon (utile pour la prochaine fois) :
- `ApplicationLaunchedTrigger` sert aussi pour "Application Closed" —
  discriminé par le booléen `m_launched` (`true`=Launched, `false`=Closed),
  pas par un classType séparé.
- `DisableMacroAction` sert aussi pour "Enable macro" — discriminé par
  `m_state` (`0`=Enable, `1`=Disable), pas par le nom de la classe. Le champ
  `m_enable` est présent mais toujours `true` dans les deux cas — piège à
  ne pas confondre avec `m_state`.
- Le trigger Floating Button vit sous la catégorie **User Input**, pas
  *MacroDroid Specific* (confirmé après recherche exhaustive dans les deux
  catégories via le picker — la recherche texte intégrée du picker MacroDroid
  est bien plus fiable que la navigation par catégorie pour le trouver).

Trigger "Intent Received" de Lyft Overlay Show = l'action broadcast que
`scripts/server.py` (heartbeat) envoie déjà via
`MACRODROID_OVERLAY_RECOVERY_ACTION` (voir `.env.example`) quand Lyft est
au premier plan mais qu'aucune fenêtre MacroDroid n'est détectée dans
`dumpsys window` — maintenant un vrai trigger enregistré, plus un no-op.

**Piège rencontré cette session** (distinct de celui documenté plus haut sur
le fix boucle infinie) : construire une macro via un bloc "If clause"
générique (`Add Action` → `Conditions/Loops` → `If clause`) l'insère à la
FIN de la liste d'actions, pas autour de l'action existante qu'on visait à
wrapper — inutile pour gater une action déjà en place. Le vrai mécanisme
pour ajouter une contrainte à une action précise : swipe/long-press sur la
ligne de l'action dans l'éditeur de macro → menu contextuel → **Add
constraint** (documenté aussi dans la section fix boucle infinie ci-dessus).

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
