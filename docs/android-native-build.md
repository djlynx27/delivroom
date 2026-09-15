# Build & install natif Android (Capacitor) — usage privé

> **L'infrastructure Capacitor existait déjà avant cette page** :
> `@capacitor/{core,cli,android,filesystem,geolocation,background-runner,local-notifications,app}`
> installés, `capacitor.config.ts` configuré (`appId: com.delivroom.app`,
> `webDir: dist`), `android/` généré et déjà buildé une fois (`android/app/build/`
> présent dans le repo local). `src/lib/capacitorScanner.ts` implémente déjà
> le scan natif du dossier Screenshots (`@capacitor/filesystem`, gestion des
> permissions par version Android) — **rien de tout ça n'a été reconstruit
> ici.** Ce qui manquait et a été ajouté (2026-09-15) :
> 1. les 3 permissions de stockage explicites dans le manifest natif,
> 2. les scripts npm `build:apk` / `install:apk`,
> 3. un vrai build + install + validation sur le S23 Ultra (jamais fait
>    avant — voir `CLAUDE.md` §"Topologie réelle", qui documentait
>    `com.delivroom.app` comme **non installé** sur l'appareil).

## 1. Permissions natives (`android/app/src/main/AndroidManifest.xml`)

```xml
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
```

`maxSdkVersion` limite `READ/WRITE_EXTERNAL_STORAGE` aux anciennes versions
d'Android — sur le S23 Ultra (Android 14+), c'est `READ_MEDIA_IMAGES` seul
qui s'applique réellement ; les deux autres restent déclarées pour la
compatibilité avec un appareil plus ancien. Le plugin `@capacitor/filesystem`
ne déclare **aucune** permission dans son propre manifest (vérifié :
`node_modules/@capacitor/filesystem/android/src/main/AndroidManifest.xml`
est vide) — la déclaration app-level est obligatoire, ce n'est pas redondant
avec le plugin.

`ensureNativePermission()` dans `capacitorScanner.ts` route déjà la demande
runtime via `Filesystem.checkPermissions()`/`requestPermissions()`, qui
mappe automatiquement vers la bonne permission selon la version d'Android —
aucun changement de code JS nécessaire, seul le manifest natif était
incomplet.

## 2. Scripts npm

```json
"build:apk": "vite build && npx cap sync android && cd android && ./gradlew assembleDebug",
"install:apk": "adb install -r android/app/build/outputs/apk/debug/app-debug.apk"
```

**Piège Windows** : `npm run build:apk` échoue sur `cd android && ./gradlew`
si npm exécute le script via `cmd.exe` (comportement par défaut de npm sur
Windows) — `cmd.exe` ne reconnaît pas `./gradlew`. Contournement : lancer les
deux étapes séparément depuis Git Bash plutôt que via `npm run` :

```bash
npm run build   # vite build + sync PWA
npx cap sync android
cd android && ./gradlew assembleDebug && cd ..
npm run install:apk
```

`install:apk` fonctionne sans problème via `npm run` (une seule commande
`adb`, pas de `cd`/`&&` shell-dépendant).

## 3. Build + install — validé sur S23 Ultra (2026-09-15)

```bash
adb devices -l   # confirmer le device cible (transport_id)
cd android && ./gradlew assembleDebug
adb -t <transport_id> install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -t <transport_id> shell am start -n com.delivroom.app/.MainActivity
```

Résultat : `BUILD SUCCESSFUL` (2m18s, 249 tâches), install `Success`,
`dumpsys window | grep mCurrentFocus` confirme
`com.delivroom.app/com.delivroom.app.MainActivity` au premier plan —
app native réelle, pas le WebAPK Chrome habituel sur cet appareil.
`dumpsys package com.delivroom.app` confirme `firstInstallTime` à l'instant
du test (jamais installé avant sur ce device).

## 4. Permissions demandées une seule fois — vérifié

Au premier lancement, l'app a demandé la permission de localisation
(dialogue natif Android, choix Precise/Approximate + While
using/Once/Don't allow) — comportement standard Android, pas un bug
Delivroom. Accordée "While using the app" + Precise. Une fois accordée,
Android ne re-demande plus tant que la permission n'est pas révoquée
manuellement (`Paramètres > Apps > Delivroom > Permissions`) — comportement
plateforme, rien à configurer côté app pour ça.

La permission Filesystem (`READ_MEDIA_IMAGES`) n'a pas été testée en
conditions réelles dans cette session (aucun scan Maxymo déclenché) — le
flux `ensureNativePermission()` existant devrait la demander à la première
tentative de scan, à vérifier lors du premier usage réel du scanner natif.

## 5. Coexistence avec le WebAPK existant

Cette installation crée une **app séparée** à côté du WebAPK Chrome déjà
présent sur l'appareil (voir `CLAUDE.md` §"Topologie réelle") — même
`appId`/package `com.delivroom.app`, mais un artefact totalement différent
(APK natif signé debug vs raccourci WebAPK généré par Chrome). Les deux
peuvent coexister sans conflit ; ils ne partagent ni Service Worker ni
stockage (WebView isolé par app vs stockage Chrome partagé pour le WebAPK).
Basculer l'usage quotidien vers l'app native est une décision produit
séparée, pas testée/actée dans cette session — pour l'instant les deux
existent en parallèle, usage privé/perso comme demandé.

## 6. Prochaine fois qu'un rebuild est nécessaire

Après tout changement de code source (`src/`), refaire les 3 étapes du §3
dans l'ordre — `cap sync android` ne re-signe/réinstalle rien tout seul,
c'est `gradlew assembleDebug` + `adb install -r` qui poussent le nouveau
build sur l'appareil.
