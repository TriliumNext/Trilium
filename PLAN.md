# Plan: Graph Search + Filter + Mod+Click Split View

## Objectif
Ajouter dans Trilium (vue graph) une expérience de navigation proche d'Obsidian:

- Recherche dans le graph.
- Filtres utiles pour réduire le bruit visuel.
- Zoom/focus sur résultats.
- `Mod + clic` (`Cmd` macOS, `Ctrl` Windows/Linux) pour ouvrir la note dans un split à droite.

## Périmètre réaliste

### V1 (MVP)
- Cible principale: **Note Map** (`apps/client/src/widgets/note_map/NoteMap.tsx`).
- `Mod + clic` sur node => ouverture dans un nouveau split (réutilisation `openNewNoteSplit`).
- Barre de recherche locale (filtre par titre + surbrillance + focus/zoom).
- Filtres front simples (texte + type de note).

### V1.5
- Mini DSL de filtres (ex: `type:`, `rel:`, `-rel:`, `color:`).
- Option "conserver le voisinage" (neighbors) autour des résultats.
- Améliorations UX (raccourcis clavier, reset rapide, état persistant léger).

### Hors scope immédiat
- Refonte complète du backend du calcul de graph.
- Extension directe au `relation_map` (possible en phase ultérieure).
- Langage de requête avancé complet type Obsidian Dataview.

## Architecture ciblée
- **Frontend Note Map**:
  - Étendre les interactions `onNodeClick`.
  - Ajouter une couche de filtrage/affichage au-dessus de `graphData`.
  - Ajouter composants UI (search input, chips/switches de filtres).
- **Command routing**:
  - Réutiliser `openNewNoteSplit` déjà présent côté app/split container.
- **Backend (optionnel v1.5+)**:
  - Si besoin de perf, enrichir endpoint `/api/note-map/:noteId/:mapType` avec paramètres de filtrage serveur.

## Phasage et estimations
- Phase 1: `Mod+clic` split -> **0.5 à 1 jour**
- Phase 2: Search + zoom/focus MVP -> **1 à 2 jours**
- Phase 3: Filtres front MVP -> **1 jour**
- Phase 4: DSL filtres + polish -> **1 à 2 jours**
- Phase 5: Tests + stabilisation -> **0.5 à 1 jour**

Total réaliste:
- MVP utile: **2 à 4 jours**
- Version plus "Obsidian-like": **4 à 7 jours**

## Risques
- Graphes volumineux: baisse FPS / interactions lourdes.
- Ambiguïté produit entre `Note Map` et `Relation Map`.
- Effets de bord sur navigation existante (clic normal vs mod+clic).

## Mitigations
- Limites de perf (debounce, cap node count, rendu simplifié).
- Scope clair: commencer par `Note Map`.
- Feature flag si nécessaire avant merge final.

## Critères de succès
- `Mod+clic` ouvre bien un split à droite sans casser le clic normal.
- Recherche trouve et centre une note de façon fiable.
- Filtres réduisent visuellement le graph sans latence notable sur cas standard.
- Pas de régression navigation/tab/split existante.
