# Tooling & packaging (Trilium)

How CKEditor 5 plugins are packaged, registered, built, and debugged in the **Trilium
(TriliumNext Notes)** monorepo. This is a pnpm workspace (pnpm 11 or later, `nodeLinker: hoisted`,
no nx/turbo) with packages under `packages/*` and apps under `apps/*`, org scope `@triliumnext/`.
The CKEditor 5 **library** is an external dependency on **48 or later**; there is no package
generator here — you add a plugin by hand, as a folder under `packages/ckeditor5/src/plugins/`.
Separate workspace packages are no longer the pattern (see "Where a new plugin goes" below).

## Where the editor lives

- `packages/ckeditor5` — `@triliumnext/ckeditor5`, the **editor build**. `src/index.ts` defines the
  editor classes; `src/plugins.ts` is the plugin registry; `src/plugins/` holds every plugin
  (admonition, collapsible, footnotes, keyboard_marker, mermaid, mention, snippets, …), each a
  folder with its tests co-located; `src/theme/` and `src/icons/` hold their assets; built with
  **Vite**.
  Nothing sits outside it any more: `mathlive` and the other former plugin-package dependencies
  are declared on the aggregate itself.
- `apps/client/src/widgets/type_widgets/text/` — the rich-text note widget that instantiates the
  editor (`config.ts`, `CKEditorWithWatchdog.tsx`, `toolbar.ts`).

The library's own packages (basic-styles, link, image, engine, ui, core, widget, typing, …) are
**upstream** and not present in this repo — they ship inside the `ckeditor5` npm aggregate.

## Where a new plugin goes

**A new plugin is a folder under `packages/ckeditor5/src/plugins/`**, written as a normal `Plugin`
class and registered in `TRILIUM_PLUGINS` (or `EXTERNAL_PLUGINS` if it derives from third-party
code). No package.json, tsconfig, vitest config or workspace wiring — just the code, its co-located
`*.spec.ts`, and one line in `plugins.ts`.

Trilium used to ship features as sibling `@triliumnext/ckeditor5-<feature>` packages. All of them
have been folded in: none had a consumer outside the aggregate, none was published, and each was
carrying a `ckeditor5-package-generator` scaffold — sample pages, its own ESLint/Stylelint/vitest
configs, typings — that no script or CI job ever ran. Folding them in also put them under the
aggregate's 100% coverage gate, which is where several latent bugs surfaced.

There are no exceptions left. Math was the final holdout — kept for a while because it owns
`mathlive` — but even that was a weak reason: `mathlive` is loaded through a dynamic `import()`,
so code-splitting never depended on the package boundary.

The package layout below is documented **only** so old branches and history stay readable.
Do not copy it.

## Plugin package layout (historical — no package uses this any more)

`package.json`:

```jsonc
{
  "name": "@triliumnext/ckeditor5-<feature>",
  "type": "module",
  "main": "src/index.ts",            // ships TS SOURCE — no per-package dist for consumers
  "license": "GPL-2.0-or-later",
  "peerDependencies": { "ckeditor5": "<exact pin from packages/ckeditor5/package.json>" },
  "scripts": {
    "lint": "eslint \"**/*.{js,ts}\" --quiet",
    "stylelint": "stylelint --quiet --allow-empty-input 'theme/**/*.css'",
    "test": "vitest",
    "test:debug": "vitest --inspect-brk --no-file-parallelism --browser.headless=false"
  }
}
```

The app bundles each plugin's TS source via Vite, so **there is no published `dist/` for
consumers**. An optional `dist/` "NIM build" (the upstream new-installation-method output) may be
generated for standalone use but is **gitignored and eslint-ignored** — never import from it inside
the monorepo.

Config files (typical set per package — not every package has all of them; e.g. collapsible
currently lacks `eslint.config.js`/stylelint + lint scripts):

- `tsconfig.json` — `composite: true`, `target: es2019`, `strict`, `module/moduleResolution:
  NodeNext`; plus `tsconfig.test.json` for tests.
- `vitest.config.ts` — Vitest (browser mode; see the `ckeditor5-testing` skill).
- `eslint.config.js` — `eslint-config-ckeditor5` + `eslint-plugin-ckeditor5-rules`.
- `stylelint-config-ckeditor5` for theme CSS.

Plugin packages have **no `vite.config.ts`** — only `packages/ckeditor5` builds;
each plugin just ships raw TS via `main: src/index.ts`, compiled by whatever bundles the editor.

`src/` files: `{feature}.ts` (glue), `{feature}editing.ts`, `{feature}ui.ts`, optional
`{feature}command.ts`, `augmentation.ts`, `index.ts`. Complex plugins add `constants.ts`
(`ELEMENTS`/`ATTRIBUTES`/`COMMANDS`/`CLASSES`), `utils.ts` (model-query helpers), and split
`schema.ts`/`converters.ts`. Assets: `theme/{feature}.css`, `theme/icons/*.svg`, `tests/`. (Localization has no
per-plugin files: the English catalog lives in the client — see `references/ui-and-localization.md`.) License and file headers vary per package — see
`references/conventions.md`.

`index.ts` re-exports the glue plugin, its sub-plugins and command types, and exposes icons:

```ts
import fooIcon from '../theme/icons/foo.svg?raw';
export { default as Foo } from './foo.js';
export { default as FooEditing } from './fooediting.js';
export { default as FooUI } from './fooui.js';
export const icons = { fooIcon };
```

## Registration flow — how a plugin reaches the editor

Four steps:

1. **Workspace dependency.** Add the package to `packages/ckeditor5/package.json`:
   `"@triliumnext/ckeditor5-<feature>": "workspace:*"`.
2. **Register in `packages/ckeditor5/src/plugins.ts`.** Import the plugin and add it to one of the
   arrays:
   - `CORE_PLUGINS` — the minimal set shared by every editor (incl. the attribute editor).
   - `TRILIUM_PLUGINS` — in-repo plugins living under `packages/ckeditor5/src/plugins/`.
   - `EXTERNAL_PLUGINS` — the workspace `@triliumnext/ckeditor5-*` packages.

   `TRILIUM_PLUGINS` + `EXTERNAL_PLUGINS` (and the rest) compose into `COMMON_PLUGINS`;
   `POPUP_EDITOR_PLUGINS` = `COMMON_PLUGINS` + `BlockToolbar`.

   ```ts
   import Footnotes from './plugins/footnotes/footnotes.js';
   const EXTERNAL_PLUGINS: typeof Plugin[] = [ Kbd, Mermaid, Admonition, Collapsible, Footnotes, Math, AutoformatMath ];
   ```

   `EXTERNAL_PLUGINS` is a historical grouping — it holds the features that began life as
   third-party or separate packages, while `TRILIUM_PLUGINS` holds the ones written here. Both
   now live under `src/plugins/`; put a new plugin in whichever array matches its provenance.
3. **Editor classes pick it up automatically.** The classes in `packages/ckeditor5/src/index.ts`
   expose those arrays via `static get builtinPlugins()`, so adding to the array is enough — no
   per-class edit needed (unless the plugin is editor-specific).
4. **Toolbar.** Add the component name (the `componentFactory` key) to Trilium's toolbar config,
   `apps/client/src/widgets/type_widgets/text/toolbar.ts`.

If a plugin only contributes type augmentation (e.g. config types) it may also be `import`ed for
side effects in `packages/ckeditor5/src/index.ts` (see the math/mermaid side-effect imports).

## The three editor classes (`packages/ckeditor5/src/index.ts`)

| Class | Base | Plugins | Role |
|-------|------|---------|------|
| `AttributeEditor` | `BalloonEditor` | `CORE_PLUGINS` | Editing attribute/relation values (minimal). |
| `ClassicEditor` | `DecoupledEditor` | `COMMON_PLUGINS` | The main text-note editor; decoupled (fixed) toolbar. |
| `PopupEditor` | `BalloonEditor` | `POPUP_EDITOR_PLUGINS` (+`BlockToolbar`) | Floating-toolbar text editor. |

There are no premium plugins any more: `SlashCommand`, `FormatPainter` and `Template` were each
replaced by an in-tree GPL plugin (`TriliumSlashCommands`, `TriliumFormatPainter`,
`TriliumSnippets`), so `ckeditor5-premium-features` is not a dependency and the editor config
always carries `licenseKey: "GPL"`. `_setModelData`/inspector aside, all symbols come from the
`ckeditor5` aggregate.

## Vite build

`packages/ckeditor5` builds with Vite (`vite.config.ts`); `vitest.config.ts` drives tests. Because
plugin packages expose `main: src/index.ts`, the aggregate and ultimately `apps/client` compile
the plugin TS sources directly through the bundler — there is no intermediate per-package build to
keep in sync. `src/index.ts` imports `ckeditor5/ckeditor5.css` and the Trilium theme CSS.

## How the client creates the editor

`apps/client/src/widgets/type_widgets/text/`:

- `config.ts` builds the `EditorConfig` (toolbar from `toolbar.ts`, language, feature config such as
  `syntaxHighlighting`, `moveBlockUp/Down`, mention feeds, etc.).
- `CKEditorWithWatchdog.tsx` wraps editor creation in the **custom `EditorWatchdog`**
  (`packages/ckeditor5/src/custom_watchdog.ts`, re-exported from `@triliumnext/ckeditor5`), which
  recreates the editor on a crash while preserving data.
- The client picks `ClassicEditor` (fixed toolbar) or `PopupEditor` (floating) per the note's
  editing mode; `AttributeEditor` is used elsewhere for attribute/relation inputs.

## CKEditor 5 Inspector

Indispensable debugging tool — shows the live **model**, **view**, **schema**, **commands**, and
selection. It is already a `devDependency` of the plugin packages.

```ts
import CKEditorInspector from '@ckeditor/ckeditor5-inspector';
// after the editor promise resolves:
CKEditorInspector.attach( editor );
// or named: CKEditorInspector.attach( { 'note-editor': editor } );
```

`@ckeditor/ckeditor5-inspector` (and `@ckeditor/ckeditor5-icons`) are the only `@ckeditor/*` deep
imports allowed in Trilium code; everything else imports from the `ckeditor5` aggregate. There is
also a bookmarklet that injects the inspector without code changes (blocked under a strict CSP).

## Per-package commands

Run scripts through the pnpm workspace filter:

```bash
pnpm --filter @triliumnext/ckeditor5-<feature> test        # vitest
pnpm --filter @triliumnext/ckeditor5-<feature> test:debug  # vitest, headed + inspector
pnpm --filter @triliumnext/ckeditor5-<feature> lint        # eslint-config-ckeditor5
pnpm --filter @triliumnext/ckeditor5-<feature> stylelint   # theme CSS
```

Tests run in a real headless Chrome that webdriverio downloads. Where that build cannot run — NixOS
being the case in point — set `CHROME_BIN` and `CHROMEDRIVER_PATH` to a matching system pair, which
`nix develop` already exports; don't start a driver by hand.

For test setup, model/view assertions, and command/UI test patterns, use the separate
**`ckeditor5-testing`** skill.

## Scope

Paths here (`packages/ckeditor5`, `packages/ckeditor5/src/plugins/<name>/`, `apps/client/...`) are **this
Trilium repository**. The CKEditor 5 library mechanics referenced (editor bases `BalloonEditor`/
`DecoupledEditor`, `EditorConfig`, the watchdog) come from the external `ckeditor5` package,
**48 or later**.
