#!/usr/bin/env bash
# scripts/setup-android-signing.sh
#
# USAGE : bash scripts/setup-android-signing.sh
#
# Ce script génère un keystore Android, affiche le SHA-256 pour
# assetlinks.json, et prépare les valeurs à insérer comme GitHub Secrets.
#
# Prérequis : Java/keytool installé (JDK 11+)
# Sur Windows : utiliser Git Bash ou WSL

set -euo pipefail

KEYSTORE_FILE="android.keystore"
ALIAS="delivroom"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║     Delivroom — Génération du keystore Android          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

if [[ -f "$KEYSTORE_FILE" ]]; then
  echo "⚠️  $KEYSTORE_FILE existe déjà. Supprime-le pour en créer un nouveau."
  echo ""
else
  echo "📝 Génération du keystore (valable 27 ans)..."
  keytool -genkeypair \
    -v \
    -keystore "$KEYSTORE_FILE" \
    -alias "$ALIAS" \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -dname "CN=Delivroom Driver, OU=Mobile, O=Delivroom, L=Montreal, ST=Quebec, C=CA"

  echo ""
  echo "✅ Keystore généré : $KEYSTORE_FILE"
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  SHA-256 pour public/.well-known/assetlinks.json"
echo "════════════════════════════════════════════════════════════"
echo ""
keytool -list -v -keystore "$KEYSTORE_FILE" -alias "$ALIAS" \
  | grep -A 1 "SHA256:" | head -2
echo ""

echo "════════════════════════════════════════════════════════════"
echo "  GitHub Secrets à configurer :"
echo "  (Settings → Secrets and variables → Actions → New secret)"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "  ANDROID_KEYSTORE_BASE64  →  copier la valeur ci-dessous :"
echo ""
base64 "$KEYSTORE_FILE"
echo ""
echo "  ANDROID_KEYSTORE_PASSWORD  →  mot de passe du keystore"
echo "  ANDROID_KEY_ALIAS_PASSWORD →  mot de passe de la clé (idem si identique)"
echo ""
echo "════════════════════════════════════════════════════════════"
echo ""
echo "📋 Étapes suivantes :"
echo ""
echo "  1. Copier le SHA-256 ci-dessus"
echo "  2. Remplacer 'REMPLACER_PAR_SHA256_DU_KEYSTORE' dans :"
echo "     public/.well-known/assetlinks.json"
echo ""
echo "  3. Ajouter les 3 GitHub Secrets dans :"
echo "     GitHub → Repo → Settings → Secrets and variables → Actions"
echo ""
echo "  4. ⚠️  SAUVEGARDER $KEYSTORE_FILE en lieu sûr"
echo "     (hors du dépôt Git — déjà dans .gitignore)"
echo ""
echo "  5. Mettre à jour le domaine dans twa-manifest.json et"
echo "     assetlinks.json si tu as un domaine custom (pas vercel.app)"
echo ""
echo "  6. Lancer la CI : git tag v1.0.0 && git push --tags"
echo ""
