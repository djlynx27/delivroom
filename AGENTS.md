# AGENTS.md — Delivroom

Ce fichier définit les règles d'autonomie bornée pour tous les agents AI intervenant sur ce dépôt.
Il est lu automatiquement par Claude Code, GitHub Copilot Agent et tout autre agent configuré.

---

## Identité et rôles agents

| Agent                       | Rôle                                                     | Scope autorisé                |
| --------------------------- | -------------------------------------------------------- | ----------------------------- |
| **Claude Code**             | Agent principal — architecture, debug, refactoring       | Tout le repo                  |
| **GitHub Copilot (Sonnet)** | Agent secondaire — complétion, review, refactoring ciblé | Fichiers ouverts              |
| **Gemini 2.5 Flash**        | Agent scoring — calcul score zones via Edge Function     | `score-calculator` uniquement |

---

## Bounded Autonomy — Règles d'exécution

### Ce que les agents font SANS demander permission

- Lire tous les fichiers du projet
- Exécuter les tests (`npm run test:run`)
- Exécuter le linter et le type-check
- Créer, modifier ou supprimer des fichiers source
- Implémenter des features, corriger des bugs, ajouter des tests
- Commiter et pusher sur `main` après validation complète
- Déployer des Edge Functions Supabase déjà existantes

### Ce qui REQUIERT confirmation humaine explicite

- Supprimer des tables ou colonnes en base de données (irréversible)
- Modifier des credentials ou secrets (`.env`, Supabase secrets, Vercel env)
- Déployer en production un nouveau Edge Function jamais testé
- Effectuer un `git push --force` ou `git reset --hard`
- Modifier la configuration de facturation Supabase / Vercel

---

## Protocole d'intervention

### 1. Context reconstruction (toujours en premier)

```bash
git log --oneline -10        # historique récent
npm run type-check -- --pretty false  # erreurs TypeScript
npm run lint                  # erreurs ESLint
npm run test:run              # régression tests
```

### 2. Identification des problèmes

Classer par sévérité avant d'agir :

- **P0 — Bloquant production** : corriger immédiatement
- **P1 — Régression** : corriger avant tout commit
- **P2 — Qualité** : corriger dans la même session si possible
- **P3 — Amélioration** : regrouper dans un commit dédié

### 3. Validation avant commit (obligatoire)

```bash
npm run test:run              # 0 test en échec
npm run type-check -- --pretty false  # 0 erreur TypeScript
npm run lint                  # 0 erreur ESLint (warnings tolérés)
npm run build                 # build réussi
```

### 4. Format de commit

```
type(scope): description courte en français ou anglais

Types: feat | fix | chore | test | refactor | docs | perf | ci
Exemples:
  feat(scoring): add weather multiplier for rain > 5mm
  fix(tripAnalytics): normalize zone label case in buildRankedSeries
  test(surgeEngine): add cosineSimilarity edge case tests
  ci(gitleaks): add secret scanning to CI pipeline
```

---

## Conventions de qualité

### TypeScript

- `strict: true` dans `tsconfig.app.json` — OBLIGATOIRE
- `noUncheckedIndexedAccess: true` activé
- Zéro `any` — utiliser `unknown` + type guard ou `z.infer<typeof schema>`
- Pattern AsyncState : `'idle' | 'loading' | 'success' | 'error'`

### Complexité cyclomatique

- Seuil ESLint : `complexity: ['warn', 10]`
- Cible architecturale ISO 25010 : M ≤ 10
- Pages React larges (DriveScreen, TodayScreen) : refactorer via sous-composants spécialisés

### Tests

Cibles ISO 25010 (seuils minimum enforced dans `vitest.config.ts`) :

| Métrique   | Seuil CI | Cible finale |
| ---------- | -------- | ------------ |
| Statements | 78%      | 80%          |
| Branches   | 65%      | 80%          |
| Functions  | 83%      | 85%          |
| Lines      | 80%      | 85%          |

Écrire au minimum :

- 1 test happy path par fonction publique
- 1 test edge case / valeur limite
- 1 test cas d'erreur / input invalide

---

## Architecture des modules

```
src/
├── lib/          # Logique pure — fonctions testables sans dépendances UI
├── hooks/        # React hooks — effets de bord, subscriptions, queries
├── components/   # UI components — pas de logique métier directe
├── pages/        # Screens — orchestration uniquement, complexité minimale
└── test/         # Tests Vitest — mirror de src/lib/
supabase/
└── functions/    # Edge Functions Deno — toujours corsHeaders + OPTIONS
```

### Règle de dépendances (SOLID / Dependency Inversion)

`pages/` → `hooks/` → `lib/` → types uniquement
Jamais : `lib/` ne dépend de `hooks/` ou `components/`

---

## Sécurité — OWASP Top 10 checklist

À chaque nouvelle feature, vérifier :

- [ ] Injection SQL/XSS : toutes les entrées utilisateur sont sanitisées
- [ ] Clés API : aucune dans `src/` (Gemini = Edge Function uniquement)
- [ ] RLS Supabase : chaque nouvelle table a des policies Row Level Security
- [ ] CORS : Edge Functions incluent `corsHeaders` + handler `OPTIONS`
- [ ] Auth : vérifier `session` Supabase avant toute mutation de données
- [ ] Logs : aucune donnée sensible (PII, clés) dans les `console.log`

---

## Multi-agent orchestration

### Séquencement recommandé

1. **Claude Code** — implémente la feature ou corrige le bug
2. **Copilot** — review inline, complétion de tests manquants
3. **CI GitHub Actions** — lint + tests + build + secret scan (automatique)
4. **Gemini** — scoring zones (autonome, via pg_cron toutes les 15 min)

### Kill switch

Si un agent produit un résultat inattendu ou dangereux :

1. `git stash` — mettre de côté les changements
2. `git log --oneline -5` — identifier le dernier commit stable
3. `git revert <sha>` — annuler proprement (ne pas utiliser `reset --hard`)
4. Documenter l'incident dans le commit message du revert

---

## Audit trail

Chaque session d'agent doit laisser une trace dans les commits :

- Commits atomiques par feature/fix (pas de mega-commits)
- Message décrivant le POURQUOI, pas le comment
- Si contournement d'un obstacle : noter `# WORKAROUND:` dans le code + explication dans le commit

---

_Dernière mise à jour : Mars 2026 — Architecture sprint "Vers une Architecture Logique et Physique Intégrée"_
