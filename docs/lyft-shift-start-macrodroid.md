# `shift-tracker` START/STOP — macros MacroDroid "Lyft Shift Start" / "Lyft Shift Stop"

Cinquième flux de la série `*-macrodroid.md` (voir `navigate-deeplink-macrodroid.md`,
`ingest-lyft-screenshots-macrodroid.md`, `address-clipboard-macrodroid.md`,
`lyft-overlay-button-macrodroid.md`) : déclencher `shift-tracker` (Edge
Function, voir `supabase/functions/shift-tracker/index.ts`) en `START`/`STOP`
sur les vraies transitions de Lyft Driver, sans action manuelle dans Delivroom.

> Pas de fichier de config côté repo — comme les quatre autres recettes de
> cette série, MacroDroid ne lit aucun fichier du projet à l'exécution.

## 0. Ce qui a été cru cassé, et ce qui l'était vraiment (2026-09-14)

Le symptôme rapporté était : *"le trigger `Application Launched` ne se
déclenche pas quand Lyft Driver reste ouvert en permanence (Keep open)"*.

**Vérifié faux.** `Application Launched` s'appuie sur les événements Android
`MOVE_TO_FOREGROUND` (UsageStatsManager) côté MacroDroid — il se redéclenche
à chaque retour au premier plan de l'app, "Keep open" empêche seulement
Android de tuer le process en arrière-plan, pas le trigger de refirer.
**La macro `Lyft Shift Start` existait déjà** (créée le 2026-09-06,
`Application Launched → com.lyft.android.driver` → `HTTP Request POST` vers
`shift-tracker`) et s'est redéclenchée pendant le test en direct sur
l'appareil — confirmé par `mcp__supabase__query_logs` (`POST | 200` vers
`shift-tracker` dans la fenêtre exacte du test).

**Le vrai bug** : `public.sessions.id=24` était restée `active` (`ended_at
IS NULL`) depuis sa création le 2026-09-06, sans aucun heartbeat après le
premier, parce qu'**aucune macro `Lyft Shift Stop` n'existait**. `START`
(`shift-tracker/index.ts:222-224`) trouve toujours une session active et
répond `{ ok:true, alreadyActive:true }` sans rien créer — donc chaque test
"réussissait" (200 OK) sans qu'aucune vraie donnée ne bouge. Corrigé : session
24 clôturée manuellement (`ended_at = now()`, `total_hours` remis à `0` — elle
n'avait aucune vraie course associée, `total_earnings`/`total_rides` déjà
nuls) et macro `Lyft Shift Stop` construite (§3-4).

Pistes explorées et rejetées avant d'identifier le vrai bug, à ne pas
retenter sans nouvelle preuve :

| # | Piste | Rejetée parce que |
|---|---|---|
| A | Reconstruire une 2e macro "Application Launched" | Redondant — la macro existante fonctionne déjà, confirmé par les logs |
| B | Trigger `Notification` sur le passage online/offline | Testé en direct (`adb shell dumpsys notification` avant/pendant/après un aller-retour online↔offline réel) : **Lyft Driver ne poste aucune notification système à ce changement d'état.** Seule notif présente en permanence : `id=119`, canal `driver_shortcut` (raccourci de chat/support, `MessagingStyle`, texte `null`) — sans rapport avec le statut online. Piste définitivement fermée |
| C | Trigger `Screen Content` (OCR/accessibilité) sur le toggle Go Online/Offline | Rejetée par décision produit : dette de maintenance récurrente à chaque refonte UI Lyft — déjà vécue avec les coordonnées de capture Nearby Drivers et `Lyft_GPS_Google_Maps.macro` |
| D | Import JSON MacroDroid à l'aveugle via un broadcast `com.arlosoft.macrodroid.macro.IMPORT` | Ce broadcast n'existe pas — absent de la table des receivers exportés de MacroDroid (`dumpsys package com.arlosoft.macrodroid`). Pas de root sur l'appareil non plus, donc pas d'écriture directe dans `/data/data/com.arlosoft.macrodroid/` |
| E | Trigger `Application Closed` pour `Lyft Shift Stop` (construit puis retiré le même jour) | Faux-positif identifié après coup : `Application Closed` fire dès que Lyft Driver quitte le premier plan — donc aussi quand le chauffeur switch vers Google Maps/Waze pour naviguer pendant une course. Un STOP involontaire à chaque bascule nav aurait coupé le shift en plein milieu. Remplacé par `Quick Settings Tile` (§3) |
| F | Trigger `Quick Settings Tile` (MacroDroid tile 1) pour `Lyft Shift Stop` (construit, sauvegardé, puis retiré le même jour) | La macro fonctionnait (trigger sauvegardé, `MacroDroidTileService1`-`16` bien déclarés dans `dumpsys package com.arlosoft.macrodroid` avec `BIND_QUICK_SETTINGS_TILE`), mais l'écran natif Android "Modifier les tuiles" ne proposait que la tuile générique "MacroDroid Enable/Disable" — aucune des 16 tuiles numérotées n'était sélectionnable pour être ajoutée au panneau réel du S23 Ultra. Remplacé par `Floating Button` (§3), seul trigger manuel déjà avec un schéma JSON vérifié dans ce repo (`scripts/Lyft_Overlay_Button.macro`) |

## 1. Configuration (une seule fois)

```bash
# Secret dédié — jamais l'anon key ni la service_role key
supabase secrets set SHIFT_TRACKER_API_KEY=<génère un token aléatoire>
supabase functions deploy shift-tracker --no-verify-jwt
```

Garde le token généré en lieu sûr — c'est lui que MacroDroid envoie dans le
header `Authorization`. Ajouté à `.env.example` (le fichier ne documentait
jusqu'ici que `INGEST_LYFT_API_KEY` / `LYFT_BRIDGE_API_KEY`).

## 2. Endpoint

```
POST https://hibzhsjgipybfihhzpxr.supabase.co/functions/v1/shift-tracker
Authorization: Bearer <SHIFT_TRACKER_API_KEY>
```

```json
{ "action": "START" }   // ou "STOP"
```

`START` sur un shift déjà actif répond `{ "ok": true, "alreadyActive": true,
"session": {...} }` sans créer de doublon (`shift-tracker/index.ts:221-239`)
— idempotent, un déclenchement répété (va-et-vient de foreground) ne casse
rien. `STOP` sans session active répond `{ "ok": true, "message": "Aucun
shift actif" }` (`index.ts:294-296`) — idempotent aussi dans l'autre sens.

## 3. Architecture retenue — START auto, STOP manuel (mise à jour 2026-09-14)

| Macro | Trigger | Action | Constraint |
|---|---|---|---|
| **Lyft Shift Start** (créée 2026-09-06) | `Application Launched` → `com.lyft.android.driver` | `HTTP Request (POST)` → endpoint §2, body `{"action":"START"}` | Aucune |
| **Lyft Shift Stop** (reconstruite 2026-09-14) | `Floating Button`, identifiant `FinShiftLyft` | `HTTP Request (POST)` → endpoint §2, body `{"action":"STOP"}` | Aucune |

**START reste automatique** — pas de faux-positif possible : ouvrir Lyft
Driver signifie toujours "je commence/reprends un shift", peu importe combien
de fois ça se répète dans une journée (idempotent, §2).

**STOP est désormais manuel, volontairement** — voir pistes E/F du §0 :
`Application Closed` coupait le shift à chaque bascule vers Google Maps/Waze
pendant une course ; `Quick Settings Tile` fonctionnait côté MacroDroid mais
n'était pas ajoutable dans le panneau natif Android sur cette build. Fin de
shift = tap sur le bouton flottant rond visible en permanence à l'écran
(icône engrenage par défaut, non personnalisée) — geste volontaire, aucune
bascule d'app ne peut le déclencher par accident, et il ne dépend d'aucun
panneau système qui pourrait ne pas exposer la fonctionnalité.

Aucune constraint anti-spam sur les deux macros — laissé tel quel
volontairement : l'idempotence côté serveur (§2) rend un déclenchement
répété inoffensif (STOP sans session active est aussi un no-op, voir §2).

**Reste à faire manuellement, si souhaité (cosmétique, pas fonctionnel)** :
personnaliser l'icône du bouton (actuellement l'engrenage par défaut) via
`Configure` sur le trigger `Floating Button` → `ICON`, pour le distinguer
visuellement du bouton "Lyft Overlay Button" qui se superpose au même
endroit de l'écran (les deux boutons flottants s'empilent au même point de
départ tant qu'ils n'ont pas été déplacés manuellement une fois).

Un header parasite existe sur l'action HTTP de `Lyft Shift Start`
(`{setting_system=aod_content_type}: {app_name}`, probablement un
`Content-Type` mal configuré à la création) — sans impact, Deno (`req.json()`
dans `shift-tracker/index.ts`) ne dépend pas de ce header pour parser le
corps. Laissé tel quel, pas la peine de rouvrir une macro qui fonctionne pour
un header cosmétique.

## 4. Construction de "Lyft Shift Stop" — via ADB/uiautomator, pas par import JSON à l'aveugle

`HttpRequestAction` n'avait jamais été exporté depuis ce repo avant cette
session (seuls `SendIntentAction`, `DisableMacroAction`,
`ReadScreenContentsAction`, `SetVariableAction` avaient un schéma JSON
vérifié — voir les `.macro` dans `scripts/`). Précédent déjà documenté
(`ingest-lyft-screenshots-macrodroid.md`, macro `Lyft GPS Google Maps`) : un
JSON deviné à la main pour un champ jamais vérifié **échoue silencieusement à
l'import** (macro vide, sans trigger ni action).

### 4.1 Version initiale (Application Closed) — construite puis remplacée le même jour

Clonée depuis `Lyft Shift Start` (menu contextuel → **Clone macro**) puis
éditée en place via `adb shell input tap`/`input text` + captures d'écran à
chaque étape :
1. Renommée `Lyft Shift Start 2` → `Lyft Shift Stop`.
2. Trigger : `Configure` sur `Application Launched` → radio **Application
   Closed** → `OK` → re-confirmer l'app sélectionnée (`Lyft Driver`) → `OK`.
3. Action HTTP : `Content Body` → remplacer `{"action":"START"}` par
   `{"action":"STOP"}`.
4. Retour arrière → dialogue **Save changes** → **Save**.

**Piège rencontré et résolu** : `adb shell input text` ne peut pas taper le
caractère `"` directement — passer `\"` (échappé une fois pour le shell
distant du device, ex. `adb shell input text '\"'` en bash) plutôt que `\\\"`
ou toute autre combinaison ; toutes les autres variantes testées produisaient
soit rien, soit un caractère tronqué. Les accolades et `:` n'ont besoin
d'aucun échappement particulier.

### 4.2 Version intermédiaire (Quick Settings Tile) — construite, sauvegardée, puis retirée le même jour

Une fois le faux-positif Maps/Waze identifié (piste E, §0), le trigger a été
remplacé en place sur la même macro, action HTTP inchangée :
1. Trigger `Application Closed` → menu contextuel (tap simple sur la ligne
   trigger, pas besoin de long-press) → **Delete**.
2. `Triggers` → `+` → recherche texte "Quick Settings" (plus fiable que la
   navigation par catégorie, même leçon déjà notée dans
   `ingest-lyft-screenshots-macrodroid.md`) → **Quick Settings Tile**
   (catégorie *MacroDroid Specific*).
3. Sélectionner **MacroDroid tile 1** (`Disabled` = libre — `Pass_Through` et
   `Test3` occupaient déjà les tuiles 2/3, ne pas les toucher) → `OK`.
4. Mode d'interaction : **Toggle On/Button Press** (valeur par défaut, un
   simple tap suffit — pas besoin de `Toggle Off` ni `Long Press`) → `OK`.
5. Retour arrière → **Save changes** → **Save**.

Résultat affiché dans la liste des macros : trigger `Quick Tile On/Press —
MacroDroid tile 1`. Retiré ensuite (piste F, §0) car injoignable depuis le
panneau natif Android sur cette build.

**Piège rencontré** : dans l'éditeur de macro, un tap sur la ligne d'un
trigger ouvre directement son **Configure** (pas le menu contextuel complet)
quand on vient d'y toucher juste avant — repasser par un aller-retour
(`CANCEL` puis retaper la ligne) suffit à récupérer le vrai menu contextuel
(`Configure` / `Test trigger` / … / `Delete` / `Disable`). Le vrai menu
contextuel complet reste accessible via un tap simple sur la ligne du trigger
la première fois (bounds confirmés avec `adb shell uiautomator dump` —
méthode bien plus fiable que deviner des coordonnées depuis un screenshot mis
à l'échelle, adoptée pour le reste de la session).

### 4.3 Version retenue (Floating Button) — remplace 4.2 le même jour

1. Trigger `Quick Tile On/Press` → menu contextuel → **Delete**.
2. `Triggers` → `+` → recherche texte "Floating" → **Floating Button**
   (catégorie *User Input*, déjà confirmée dans
   `ingest-lyft-screenshots-macrodroid.md` : absente de *MacroDroid
   Specific*).
3. Champ **Identifier** : `FinShiftLyft` (reste interne à MacroDroid, aucune
   contrainte de format observée). Tout le reste laissé aux valeurs par
   défaut (icône = engrenage générique, taille Normal, opacité 100%,
   position 0,0 — sous la barre de statut, comme `Lyft Overlay Button` à
   l'origine).
4. `OK` → retour arrière → **Save changes** → **Save**.

Résultat affiché dans la liste des macros : trigger `Floating Button
(FinShiftLyft)`.

**Piège évité** : la permission `SYSTEM_ALERT_WINDOW` (Draw over other apps)
pour MacroDroid était déjà accordée (`adb shell appops get
com.arlosoft.macrodroid SYSTEM_ALERT_WINDOW` → `allow`) — probablement
accordée automatiquement à la création du trigger, MacroDroid gérant déjà un
bouton flottant existant (`Lyft Overlay Button`). Si le bouton n'apparaît pas
à l'écran sur un autre appareil, vérifier cette permission en premier.

## 5. Vérifié de bout en bout (2026-09-14)

**START** (`Application Launched`) : test réel, lancement de Lyft Driver puis
retour à l'écran d'accueil (Home) — à l'époque où STOP était encore
`Application Closed` (§4.1). `mcp__supabase__query_logs` sur `shift-tracker`
a montré 2 appels distincts à 4 secondes d'écart :

```
POST | 200 | .../shift-tracker   00:45:13 (Application Launched → START)
POST | 200 | .../shift-tracker   00:45:18 (Application Closed  → STOP)
```

Et `public.sessions` a confirmé une session propre créée puis fermée dans la
foulée (`id=25`, `started_at` = `ended_at` à 4s près) — pas un artefact
"toujours active" comme la session 24. Ce test validait la chaîne HTTP/auth
côté serveur avec l'ancien trigger `Application Closed` (§4.1) ; l'action
HTTP elle-même est restée identique à travers les 3 versions de trigger
(§4.1 → 4.2 → 4.3), donc cette validation reste pertinente pour la version
retenue.

**STOP** (Floating Button, §4.3) : testé en direct — tap sur le bouton depuis
l'écran d'accueil. `mcp__supabase__query_logs` confirme un `POST | 200 |
.../shift-tracker` à l'instant exact du tap (01:36:00 UTC). Chaîne complète
validée avec le trigger définitif, pas seulement l'action HTTP.

Vérification manuelle possible en tout temps :

```bash
curl -s -X POST https://hibzhsjgipybfihhzpxr.supabase.co/functions/v1/shift-tracker \
  -H "Authorization: Bearer <SHIFT_TRACKER_API_KEY>" -H "Content-Type: application/json" \
  -d '{"action":"STATUS"}'
```

Dans Delivroom, `useShift()` (`src/hooks/useShift.ts`) reflète le shift actif
au prochain focus/visibilitychange de l'onglet — pas besoin d'attendre le
poll de 45s si tu reviens sur l'app pendant un vrai shift.
