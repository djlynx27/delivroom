# GitHub Actions Supabase Migration Setup

## Configuration rapide

Pour que le workflow auto-applique les migrations à chaque push sur `main`, tu dois:

### 1. Créer un access token Supabase

1. Va sur https://app.supabase.com → Ton compte (coin sup droit) → **Settings** → **Access tokens**
2. Clique **Generate new token**
3. Donne-lui un nom genre `"GitHub Actions"`
4. Copie le token complet

### 2. Ajouter les secrets GitHub

1. Va sur GitHub → Ton repo Delivroom → **Settings** → **Secrets and variables** → **Actions**
2. Clique **New repository secret** et ajoute:

| Secret Name             | Valeur                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | Le token que tu viens de copier                                                                                                                          |
| `SUPABASE_PROJECT_ID`   | Le project ref exact (20 caractères alphanumériques), l'URL API `https://<ref>.supabase.co`, ou l'URL dashboard `https://app.supabase.com/project/<ref>` |
| `SUPABASE_DB_PASSWORD`  | Le mot de passe de la base Postgres Supabase (Database password dans Project Settings)                                                                   |

### 3. Test automatique

1. Fais un commit avec une modification dans `supabase/migrations/` ou `supabase-seed.sql`
2. Push sur `main`
3. Va sur GitHub → **Actions** et observe le workflow s'exécuter
4. Si ✅, les migrations sont appliquées sur ton projet distant Supabase

## Que fait le workflow?

- ✅ Déclenche à chaque push sur `main` touchant migrations/seed
- ✅ Installe Supabase CLI dans GitHub
- ✅ Lie le projet Supabase puis push les migrations depuis `supabase/migrations/`
- ✅ Applique le seed de démo depuis `supabase-seed.sql`
- ✅ Log le succès/erreur

## Troubleshooting

| Problème                                           | Solution                                                                                                                      |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| "Invalid access token"                             | Assure-toi d'avoir copié le token complet depuis Supabase (Settings → Access tokens)                                          |
| "Invalid project ref format"                       | Mets `SUPABASE_PROJECT_ID` avec le project ref exact (20 caractères alphanumériques), l'URL API, ou l'URL dashboard du projet |
| "password authentication failed for user postgres" | Ajoute/mettre à jour `SUPABASE_DB_PASSWORD` avec le mot de passe DB du projet (Settings → Database)                           |
| "Project not found"                                | Vérifie que `SUPABASE_PROJECT_ID` correspond bien au bon projet Supabase                                                      |
| "Migrations failed"                                | Regarde les logs du workflow pour l'erreur SQL exacte → corrige `supabase/migrations/`                                        |

## Désactiver temporairement

Si tu veux arrêter le workflow:

1. Va sur `.github/workflows/supabase-migrations.yml`
2. Change `on: push:` en commentaire ou supprime cette section
3. Push
