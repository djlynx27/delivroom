---
name: git-workflow
description: Gestion de workflows Git — commits conventionnels, branches, PRs, rebases, résolution de conflits, et synchronisation entre outils (Lovable, Cursor, Claude Code). Utilise ce skill dès que l'utilisateur mentionne Git, GitHub, commits, branches, merge, rebase, pull request, ou synchronisation de repo. Calibré pour le workflow Lovable → GitHub → Cursor/Claude Code.
---

# Git Workflow

Workflow Git optimisé pour développeurs solo avec stack IA (Lovable + Cursor + Claude Code).

## Workflow de référence (Delivroom)

```
Lovable (UI gen)  →  GitHub (djlynx27/Delivroom)  →  Cursor / Claude Code (fixes)
                            ↓
                    Vercel / Lovable deploy
```

## Convention de commits

```bash
# Format: type(scope): description courte
feat(map): add zone score overlay on Mapbox
fix(supabase): resolve RLS policy for anonymous reads
chore(deps): update @supabase/supabase-js to 2.45
refactor(scoring): extract weather factor into separate module
docs(readme): add Edge Function deployment steps
style(ui): fix zone card padding on mobile
test(api): add Ticketmaster integration test
perf(scoring): batch Gemini calls to reduce latency

# Types: feat | fix | chore | refactor | docs | style | test | perf | ci
```

## Branches — Naming

```bash
feature/zone-score-overlay
fix/gps-icon-rendering
chore/supabase-migration-v2
hotfix/push-notification-spam
release/v1.2.0
```

## Commandes quotidiennes

```bash
# Début de journée — sync
git fetch origin
git pull origin main --rebase

# Créer une branche
git checkout -b feature/ma-feature

# Stager sélectivement
git add -p             # Revue hunk par hunk (recommandé)
git add src/           # Tout un dossier

# Commit
git commit -m "feat(scoring): add weather factor to zone score"

# Pousser
git push -u origin feature/ma-feature

# Voir l'état
git status
git log --oneline -10
git diff HEAD~1        # Diff avec le commit précédent
```

## Sync Lovable ↔ GitHub ↔ Cursor

```bash
# Après changements Lovable (via leur interface)
git fetch origin
git pull origin main

# Après changements Cursor — push vers GitHub pour sync Lovable
git add .
git commit -m "fix(map): correct GPS icon rendering"
git push origin main
# → Lovable se sync automatiquement si connecté

# Éviter les conflits : toujours pull avant d'éditer localement
```

## Résolution de conflits

```bash
# Voir les conflits
git status  # "both modified" = conflit

# Ouvrir et résoudre manuellement (chercher <<<<<<<)
# Après résolution:
git add fichier-resolu.ts
git rebase --continue  # ou git merge --continue

# Annuler un rebase si ça part en vrille
git rebase --abort
```

## Rebase vs Merge

```bash
# Rebase (préféré pour branches feature — historique propre)
git checkout feature/ma-feature
git rebase main
git push -f origin feature/ma-feature  # -f car historique réécrit

# Merge (pour intégrer une feature terminée)
git checkout main
git merge --no-ff feature/ma-feature  # --no-ff préserve le contexte
git push origin main
```

## Récupération d'urgence

```bash
# Annuler le dernier commit (garder les changements)
git reset HEAD~1

# Annuler le dernier commit (tout perdre)
git reset --hard HEAD~1

# Voir l'historique des déplacements HEAD (sauvetage)
git reflog

# Récupérer un commit "perdu"
git checkout <hash-du-reflog>

# Annuler un fichier modifié
git checkout -- src/components/Map.tsx

# Stash (mettre de côté temporairement)
git stash
git stash pop
git stash list
```

## .gitignore type (React + Vite + Supabase)

```gitignore
# Dépendances
node_modules/
.pnp
.pnp.js

# Build
dist/
dist-ssr/
*.local

# Environnement (JAMAIS commiter)
.env
.env.local
.env.production

# Supabase local
supabase/.temp/
supabase/config.toml  # Si données sensibles

# IDE
.vscode/settings.json
.idea/
*.suo

# OS
.DS_Store
Thumbs.db
```

## PR Template (GitHub)

```markdown
## Changements
- [ ] Feature X ajoutée
- [ ] Bug Y corrigé

## Tests effectués
- [ ] Testé sur mobile (Chrome Android)
- [ ] Build Vite sans erreur
- [ ] Edge Function déployée

## Screenshots
<!-- Si changements UI -->
```

## Alias Git utiles

```bash
git config --global alias.lg "log --oneline --graph --decorate -20"
git config --global alias.st "status -sb"
git config --global alias.undo "reset HEAD~1"
git config --global alias.aliases "config --get-regexp alias"
```
