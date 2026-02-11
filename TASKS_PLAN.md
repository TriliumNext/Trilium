# Tasks Plan: Graph Search + Filter + Split View

## Convention
- Priorité: `P0` (must), `P1` (important), `P2` (nice-to-have)
- Estimation: en jours ouvrés
- Statut initial: `TODO`

## Epic 1: Mod+Click ouvre en split à droite

### T1.1 (P0, 0.5j, TODO)
Implémenter `mod+click` sur node dans `NoteMap.tsx`.

- Fichier: `apps/client/src/widgets/note_map/NoteMap.tsx`
- Règle:
  - clic normal => comportement actuel (ouvrir dans split actif)
  - `metaKey || ctrlKey` => `openNewNoteSplit` avec `notePath=node.id`
- Vérification:
  - macOS `Cmd+clic` fonctionne
  - Windows/Linux `Ctrl+clic` fonctionne

### T1.2 (P0, 0.5j, TODO)
Gérer cas limites UX.

- Si split non disponible: fallback propre (open note normal + toast optionnel).
- Si note invalide/supprimée: ne pas casser l'UI.

### T1.3 (P1, 0.25j, TODO)
Ajouter une entrée courte dans documentation dev/utilisateur.

---

## Epic 2: Search dans le graph (MVP)

### T2.1 (P0, 0.5j, TODO)
Ajouter une barre de recherche dans `NoteMap`.

- Input texte + clear.
- Debounce 150-250ms.

### T2.2 (P0, 0.75j, TODO)
Filtrer localement les nodes par titre (contains, case-insensitive).

- Maintenir la source dataset intacte.
- Calculer un `filteredGraphData` dérivé.

### T2.3 (P0, 0.5j, TODO)
Highlight + fade.

- Matched nodes: accent visuel.
- Non-matched nodes/links: opacité réduite.

### T2.4 (P1, 0.5j, TODO)
Focus/zoom sur le premier résultat (ou résultat sélectionné).

- Action clavier `Enter` dans la search bar.
- Bouton reset zoom.

---

## Epic 3: Filter front (MVP)

### T3.1 (P0, 0.75j, TODO)
Filtre par type de note.

- Multi-select simple (text, code, file, etc.).
- Appliqué au même pipeline que search.

### T3.2 (P1, 0.5j, TODO)
Option "conserver voisins directs" des notes matchées.

- Permet du contexte autour du résultat.

### T3.3 (P1, 0.5j, TODO)
Persist léger de l’état UI (session/tab).

- Search query, types sélectionnés, toggle neighbors.

---

## Epic 4: Filtres style Obsidian (V1.5)

### T4.1 (P1, 1j, TODO)
Parser de requête simple.

- Syntaxes minimales:
  - `type:<value>`
  - `rel:<value>`
  - `-rel:<value>`
  - texte libre

### T4.2 (P1, 0.75j, TODO)
Intégrer parser au pipeline de filtrage.

- Combinaison logique claire (AND par défaut).

### T4.3 (P2, 0.5j, TODO)
Aide inline (cheat-sheet) sous le champ de recherche.

---

## Epic 5: Qualité, tests, perf

### T5.1 (P0, 0.75j, TODO)
Tests interaction.

- `mod+click` déclenche `openNewNoteSplit`.
- clic normal reste inchangé.

### T5.2 (P0, 0.75j, TODO)
Tests filtres/search.

- couverture sur matching et non-régression UI de base.

### T5.3 (P1, 0.5j, TODO)
Perf guardrails.

- Debounce confirmé.
- Limiteur soft si très gros graph.

### T5.4 (P1, 0.25j, TODO)
QA manuelle desktop + mobile fallback.

- Mobile: comportement sans mod key reste cohérent.

---

## Dépendances et ordre recommandé
1. Epic 1 (`mod+click`)
2. Epic 2 (search MVP)
3. Epic 3 (filters MVP)
4. Epic 5 (tests/perf de stabilisation)
5. Epic 4 (DSL v1.5)

## Plan de PR conseillé
1. PR #1: `mod+click split` + doc courte
2. PR #2: search bar + highlight + zoom/focus
3. PR #3: filtres type + neighbors + persistance légère
4. PR #4: parser de filtres v1.5 + polish
5. PR #5: tests/perf/refactor final
