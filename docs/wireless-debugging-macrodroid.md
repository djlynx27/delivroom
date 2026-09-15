# Raccourci MacroDroid "Wireless Debugging Toggle"

Sixième flux de la série `*-macrodroid.md`. Contrairement aux autres, ne
touche à aucun code Delivroom ni Edge Function — c'est un outillage pur
appareil, utile parce que la session ADB Wireless Debugging (utilisée pour
construire/déboguer les autres macros de cette série) se coupe régulièrement
et nécessite de replonger dans `Paramètres → Options développeur` à chaque
fois.

## 1. Prérequis — permission accordée une seule fois

```bash
adb shell pm grant com.arlosoft.macrodroid android.permission.WRITE_SECURE_SETTINGS
```

Vérifié après coup (`adb shell dumpsys package com.arlosoft.macrodroid | grep WRITE_SECURE_SETTINGS`) :
`granted=true` pour l'utilisateur principal (le `granted=false, userId=150`
qui apparaît en plus est le profil Secure Folder du S23 Ultra — sans
rapport, voir `CLAUDE.md`).

**Cette permission n'a finalement pas servi directement** (voir §2, piste A
rejetée) — accordée en prévision, gardée au cas où une future macro
l'utilise réellement (ex. lire/écrire un autre paramètre secure).

## 2. Deux alternatives envisagées — une seule construite

| # | Piste | Statut |
|---|---|---|
| A | Action MacroDroid **Secure Settings** → écrire `adb_wifi_enabled` directement (1/0) | **Rejetée** — cette action délègue à une app compagnon tierce "Secure Settings" (Spikee), non installée, à récupérer sur **APK Pure** (source tierce non vérifiée). Refusé d'installer un APK non signé/non vérifié sans confirmation explicite. `pm grant WRITE_SECURE_SETTINGS` à MacroDroid lui-même (§1) ne suffit pas à contourner cette exigence — MacroDroid ne détecte pas la permission déjà accordée pour cette action précise |
| B | Action **Send Intent** → `android.settings.APPLICATION_DEVELOPMENT_SETTINGS` | **Construite et vérifiée** — ouvre directement l'écran Options développeur (Wireless Debugging est le 2e/3e item de cette liste), pas besoin de naviguer depuis Paramètres racine |

Alternative B ne bascule pas le toggle en un seul tap contrairement à A —
il reste un tap manuel sur "Wireless debugging" une fois l'écran ouvert.
Compromis accepté : zéro dépendance tierce, zéro app à sideloader.

## 3. Macro construite (2026-09-15)

| Trigger | Actions |
|---|---|
| `Shortcut Launched` (raccourci d'icône sur l'écran d'accueil, pas une tuile Quick Settings — voir §4) | 1. `Send Intent` → Target `Activity`, Action `android.settings.APPLICATION_DEVELOPMENT_SETTINGS`, aucun package/class/data (Android résout lui-même l'écran système). 2. `Popup Message` (Toast) → `Wireless Debugging - ouverture des parametres` |

Nom de la macro : **Wireless Debugging Toggle**. Icône ajoutée à l'écran
d'accueil du S23 Ultra via le menu contextuel de la macro → **Create home
screen shortcut** → icône par défaut MacroDroid conservée → **Add** dans le
picker du launcher Samsung.

## 4. Pourquoi pas une tuile Quick Settings

Same limite déjà rencontrée et documentée pour `Lyft Shift Stop`
(`docs/lyft-shift-start-macrodroid.md` §0 piste F) : les 16
`MacroDroidTileServiceN` sont bien déclarés côté Android
(`dumpsys package` confirme `BIND_QUICK_SETTINGS_TILE`), mais aucune des
tuiles numérotées n'apparaît dans l'écran natif "Modifier les tuiles" sur
cette build — seule la tuile générique "MacroDroid Enable/Disable" y est
listée. `Shortcut Launched` (icône d'accueil, mécanisme `ShortcutManager`
standard) contourne complètement cette limite : aucune dépendance au
panneau Quick Settings.

## 5. Piège rencontré — `adb shell input text`/`keyevent` corrompt les points

En tapant `android.settings.APPLICATION_DEVELOPMENT_SETTINGS` dans le champ
Action de `Send Intent`, chaque `.` suivi d'une lettre déclenche une
correction automatique du framework Android (capitalisation + insertion
d'un espace après le point) — **reproduit avec `input text`, avec
`input keyevent` caractère par caractère, et après changement d'IME
(HoneyBoard → Gboard/AOSP LatinIME)**, donc ce n'est pas un comportement du
clavier logiciel mais du traitement legacy `TextKeyListener` appliqué aux
événements clavier synthétiques (`adb shell input` injecte de vrais
`KeyEvent`, qui empruntent ce chemin même quand l'IME actif ne l'utilise
jamais pour une vraie frappe tactile).

**Contournement qui fonctionne** : taper tous les segments de texte SANS
aucun point d'abord (`androidsettingsAPPLICATION_DEVELOPMENT_SETTINGS`,
propre), puis repositionner le curseur avec `KEYCODE_DPAD_RIGHT` et insérer
chaque `.` séparément via `KEYCODE_PERIOD` — **sans taper aucun caractère
juste après**. La correction ne se déclenche que sur la frappe qui *suit
immédiatement* un point ; l'insérer dans un texte déjà présent, sans
frappe consécutive, l'évite entièrement. Reproductible, à réutiliser pour
tout futur champ MacroDroid nécessitant un point.

## 6. Vérifié

**Test actions** (menu contextuel de la macro, sans passer par le
raccourci) : l'écran **Developer options** s'est ouvert directement, et le
toast **"Wireless Debugging - ouverture des parametres"** s'est affiché
par-dessus — capturé par screenshot le 2026-09-15. Icône d'accueil créée et
visible dans le tiroir d'applications (`Wireless De...` sur la grille).

Test du tap direct sur l'icône réelle (plutôt que "Test actions") interrompu
par une coupure de la session ADB Wireless Debugging avant confirmation
finale — comportement attendu identique vu que `Shortcut Launched` est un
mécanisme standard MacroDroid déjà utilisé ailleurs dans ce repo, mais à
confirmer une fois manuellement si un doute subsiste.
