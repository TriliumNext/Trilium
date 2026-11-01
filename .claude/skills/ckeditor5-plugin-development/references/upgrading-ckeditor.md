# Upgrading CKEditor (major versions)

Renovate opens a `renovate/major-ckeditor-monorepo` branch for each major `ckeditor5` release. The
bump itself is two version strings and a lockfile; the work is what the release breaks around it. This
page is the procedure, the CSS model CKEditor 49 introduced (the source of most visual breakage),
the traps already hit, and `ck_css.mjs`, which measures a stylesheet change instead of guessing at it.

## Procedure

1. **Read the release's breaking changes** from the installed changelog rather than the web:
   `awk '/^## \[49.0.0\]/{f=1} /^## \[48/{f=0} f' node_modules/ckeditor5/CHANGELOG.md`. Grep the repo
   for every removed or renamed API it names (`apps/client/src`, `packages/*/src`).
2. **Read CI on the Renovate PR, but find the root.** One missing export fails the build, every E2E
   job and the Docker image at once (`gh run view --job <id> --log-failed`, look for
   `MISSING_EXPORT`). The typecheck cascades too: once `apps/client` stops compiling, projects that
   read its declarations (share-theme, client specs, build-docs) report errors about exports that do
   exist. Fix the root errors first; the rest vanish. The CKEditor test job writes a blob report, so
   its log never names the failing spec — run the suite locally instead.
3. **Run the CKEditor suite locally** (`pnpm exec playwright install chromium` once in
   `packages/ckeditor5`, then `pnpm --filter @triliumnext/ckeditor5 exec vitest run`). Layout specs
   that measure real CSS (`tile_row_view`, `multicolumn_layout`) catch stylesheet breakage.
4. **Audit our CSS:** `node .claude/skills/ckeditor5-plugin-development/ck_css.mjs audit` lists every
   `var(--ck-…)` read, without a fallback, of a name neither CKEditor nor our CSS declares.
5. **Compare against the previous version** with the harnesses (below) until the only differences
   left are ones you decided to keep.
6. **Regenerate the `cke` icon font** (see SKILL.md, "The `cke` icon pack") — every bump.

## CKEditor 49's CSS model

v49 replaced the flat set of CSS variables with three layers: **foundation** scales
(`--ck-spacing-sm`, `--ck-radius-base`, `--ck-font-size-md`), **semantic** roles
(`--ck-spacing-padding-compact`, `--ck-border-radius-control`, `--ck-color-interactive-focus-border`),
and **component** tokens (`--ck-button-font-size`, `--ck-color-grid-gap`). Three consequences
account for nearly every regression the v49 upgrade caused:

- **Legacy names are no longer declared.** `--ck-spacing-small`, `--ck-font-size-small` and the rest
  are gone, so a bare `var(--ck-spacing-small)` resolves to nothing and a `calc()` around it becomes
  invalid (the tile row lost its 20px group gap that way). v49's own feature CSS reads them with the
  new name as fallback, and so do we: `var(--ck-spacing-small, var(--ck-spacing-sm))`. That keeps
  any scoped legacy override of ours working (snippet items set `--ck-spacing-large: 8px`, read by
  `snippets.css`). The mapping, from v49's own fallbacks:

  | Legacy | v49 | Legacy | v49 |
  |---|---|---|---|
  | `--ck-spacing-tiny` | `--ck-spacing-xs` | `--ck-spacing-large` | `--ck-spacing-lg` |
  | `--ck-spacing-small` | `--ck-spacing-sm` | `--ck-spacing-medium-small` | `--ck-spacing-md` |
  | `--ck-spacing-medium` | `--ck-spacing-base` | `--ck-font-size-small` | `--ck-font-size-sm` |
  | `--ck-spacing-standard` | `--ck-spacing-base` | `--ck-color-error-text` | `--ck-color-feedback-error` |

- **Component tokens are computed at `:root`.** `--ck-button-font-size: var(--ck-font-size-md)` is
  declared on `:root`, so it is resolved there and inherited as a value. A scoped override of the
  name it reads — our dropdown panels' `--ck-font-size-base: 0.9rem`, the toolbar's
  `--ck-border-radius: 6px`, its `--ck-color-focus-border` — no longer reaches the component. The
  override goes on the **component token** at the same scope instead:

  | Where | Legacy override (kept, still read by some rules) | Component tokens set beside it |
  |---|---|---|
  | `div.ck.ck-dropdown__panel` (`ckeditor-theme.css`) | `--ck-font-size-base: 0.9rem` | `--ck-button-font-size`, `--ck-input-font-size`, `--ck-labeled-field-label-font-size`, `--ck-toolbar-text-font-size` |
  | `.ck.ck-toolbar` (`theme-next/notes/text.css`) | `--ck-focus-ring: 1px solid transparent` | `--ck-button-focus-border-color: transparent`, `--ck-toolbar-text-font-size: 13px` |
  | toolbar `:focus-visible`, `div.ck.ck-dialog` | `--ck-focus-ring: 1px solid <focus color>` | `--ck-button-focus-border-color: <focus color>` |
  | `.ck.ck-color-selector` | `--ck-border-radius` (via the toolbar) | `--ck-color-selector-padding`, `--ck-color-selector-grids-fragment-padding`, `--ck-button-border-radius`, `--ck-color-grid-*`, `--ck-color-interactive-focus-border` |
  | `.ck.ck-list-styles-list` | `--ck-spacing-large` (no longer read there) | `--ck-list-styles-list-padding` |
  | `.ck.ck-editor__editable_inline` (`ckeditor-theme.css`) | — | `--ck-editor-editable-padding: 0 .6em`, plus `.9em` first/last-child margins |

  To find what a component reads: `ck_css.mjs props new font-size 'button'` (which rule sets the
  property) and `ck_css.mjs readers new button-font-size` (who reads a token).

- **The focus color chain is inverted.** v48 derived the ring from `--ck-color-focus-border`; v49
  declares `--ck-color-focus-border: var(--ck-color-interactive-focus-border)`, which reads
  `--ck-focus-border-color` (CKEditor's blue). Our `body`-level `--ck-color-focus-border` therefore
  colors nothing that reads the new names; a focused button's border is
  `--ck-button-focus-border-color`, a color tile's ring `--ck-color-interactive-focus-border`.

### Traps

- **`--x: inherit` is the custom property's own inheritance.** It copies the parent's `--x`, not
  "inherit the font size". To undo `--ck-toolbar-text-font-size: 13px` inside toolbar dropdowns the
  panel sets it to `var(--ck-font-size-base)`, not `inherit`.
- **Nested selectors reach further than they read.** v49 ships native CSS nesting;
  `.ck.ck-toolbar { & .ck-button__label { … } }` is a descendant selector, and a toolbar dropdown's
  panel is a descendant of the toolbar — so toolbar text rules also hit menu items.
- **A `var()` of an undefined name invalidates the whole declaration**, so a `box-shadow` reading one
  missing color renders as `none`, not as a partial shadow.

## Where CKEditor's CSS reaches

A content-style change shows in four places, and each loads it differently:

| Place | Loads |
|---|---|
| Editor (and read-only text) | `ckeditor5/ckeditor5.css`, then the theme files `src/index.ts` imports (`blockquote.css`, `content_colors.css`, …), then the client chain (`ckeditor-theme.css`, `theme-light.css`, the theme, `style.css`) |
| Printing, shared pages | `src/theme/ck-content.css` = `ckeditor5-content.css` + `content_colors.css` + Trilium's content rules; shared pages add the share theme, which restyles code blocks, quotes and lines itself |
| HTML export (server, desktop) | `ckeditor5-content.css`, `ckeditor5-content-colors.css`, `ckeditor5-multicolumn.css`, concatenated by `apps/server/src/services/export/zip/factory.ts`; each build script copies them |
| HTML export (standalone) | `ck-content.css?raw` — its `@import`s are left unresolved, so standalone exports carry no CKEditor content styles (predates v49) |

`src/theme/content_colors.css` keeps CKEditor 48's content colors (v49's code-block background is an
opaque `#f5f5f5`, also in the dark theme). It must load **after** CKEditor's stylesheet: same
selectors, so order decides.

## Comparing two versions: `ck_css.mjs`

```bash
S=.claude/skills/ckeditor5-plugin-development/ck_css.mjs
node $S stage 48.5.2     # the previous version becomes the "old" side; the installed one is "new"
node $S run all          # DIFF lines: context | element | property: old → new
node $S clean            # always — staged files sit in packages/ckeditor5/src
node $S audit            # undeclared --ck-* reads in our CSS
node $S readers new spacing-large          # who reads a token (new | <version> | <path>)
node $S props 48.5.2 padding 'list-styles' # who sets a property, in a version's stylesheet
```

`stage` downloads the version's `dist/ckeditor5.css` and `ckeditor5-content.css` with `npm pack`
(cached in the OS temp dir) and copies them and `harness/*` into `packages/ckeditor5/src` as
`zz_ckcss_*`, where the package's Vitest browser config runs them in Chromium. Both sides load
**today's** Trilium stylesheets (`harness/kit.ts`, `CONTEXTS`), so every difference is one the
CKEditor change causes:

- **`content`** renders one note with every content element (headings, inline code, highlight,
  link, font sizes, mention, kbd, quote, code block, line, table and image with captions, lists,
  to-do list, page break, admonition) in `app`, `app-dark`, `share` and `export`, and diffs ~20
  visual properties per element.
- **`ui`** builds a real `ClassicEditor` with a toolbar (button, heading dropdown, font color with
  Trilium's palette, insert table) plus a dialog and a balloon, and diffs size, padding, radius, font,
  icon size and the `:focus` border, shadow and outline of each.

To learn which rule produced a value, add the element's key and properties to the spec's `PROBE`
map; `RULE` lines then list every matching rule with nested selectors resolved. Extend the fixture or
`record()` calls for anything not yet covered — a difference in an element the harness does not
render goes unnoticed.

Caveats: programmatic `focus()` counts as `:focus-visible`; values are at the default 16px root
size; CSS that `?inline` imports has its `@import`s resolved, `?raw` does not; the harness cannot see
rules that depend on the app's DOM around the editor beyond the wrapper classes it sets.

## State after the v49 migration

- No watchdog: `onTextEditorError()` and the `editor-error` toast (`references/tooling-and-packaging.md`).
- Content in every context matches v48, except the editable's corner radius (2px → 0, invisible).
- Left as v49 ships them, deliberately: control sizing (toolbar buttons 32px, 4px radius, 14px text;
  inputs 32px; dialog buttons 4px radius) and the color selector's button icons (22.1px → 20.6px,
  sized from the button text).
