# Code-style conventions (Trilium)

Conventions for Trilium's CKEditor 5 plugins. Each `@triliumnext/ckeditor5-<feature>` package and
`packages/ckeditor5` lints with **`eslint-config-ckeditor5`** + **`eslint-plugin-ckeditor5-rules`**
(theme CSS with `stylelint-config-ckeditor5`), so Trilium inherits the upstream CKEditor naming /
CSS-BEM / JSDoc / TypeScript rules below, on top of Trilium-specific packaging rules. (The root
ESLint config **skips `packages/*`** — each package lints itself.) Use these both to write
idiomatic plugins and to review them. Items below note the enforcing rule where one exists.

## License & headers (per package — not uniform)

These are **inconsistent across the packages** — match the package you're editing, don't assume one
rule. The `package.json` `license` field varies (`GPL-2.0-or-later` for admonition/collapsible,
`ISC` for footnotes/math, `GPL-3.0` for keyboard-marker, `SEE LICENSE IN LICENSE.md` for mermaid).
The CKSource license header is present in some packages (e.g. admonition) and absent in others;
when present it's this block before imports:

```ts
/**
 * @license Copyright (c) 2003-2024, CKSource Holding sp. z o.o. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */
```

Follow the existing files in the package you touch; don't add or strip headers wholesale.

## Naming

- Variables/functions/params: `lowerCamelCase`. Classes/mixins: `UpperCamelCase` (mixins end
  in `Mixin`). Global constants: `ALLCAPS`. Private members: `_` prefix (`this._balloon`,
  `_createButton()`).
- Methods are **verbs** (`execute`, `getNextNumber`); properties/variables are **nouns**.
  Booleans use an auxiliary-verb prefix: `isEnabled`, `hasChildren`, `canObserve`, `mustRefresh`.
- **Commands:** action + feature → `insertTable`, `uploadImage`, `addAbbreviation` (not
  `tableInsert`). **Buttons:** verb+noun or noun → `insertTable`, `bold`.
- **Plugins:** feature or feature+sub-feature, `UpperCamelCase` → `Bold`, `ImageResize`,
  `TableClipboard`.
- Acronyms: two-letter stay upper (`getUI`); longer follow camelCase position rules
  (`domError`/`DomError`, `getCKEditorError`). Proper names keep their casing (`CKEditorError`).
- Model/view names follow the feature, lowerCamelCase for elements (`simpleBox`,
  `simpleBoxTitle`, `placeholder`); attributes lowerCamelCase (`linkHref`, `highlight`).

## Files & CSS

- File names: **all lowercase, kebab-case**; a single code entity drops separators
  (`DataProcessor` → `dataprocessor.ts`). Descriptive multi-word test files may use dashes.
- CSS: **BEM**, all lowercase, mandatory `ck-` prefix. Block `ck-dialog`; element
  `ck-dialog__header` (double underscore); modifier `ck-dialog_hidden` /
  `ck-toolbar__group_collapsed` (single underscore); key-value `ck-dropdown-menu_theme_lark`.
  IDs follow the same rules with `ck-` prefix. CSS vars inside `.ck-content` must be
  `--ck-content-*` (`ck-content-variable-name`).
- **Theme CSS is global — scope every selector.** Vite injects `packages/ckeditor5/src/theme/*.css`
  app-wide the first time any text note renders (including the geo map's detail pane mounting
  `NoteDetail` on a text note). There is no scoping boundary, and `!important` there beats even
  Popper's inline styles on Bootstrap tooltips and popovers. A selector that is not anchored to
  `.ck`, `ML__` or `data-ml-*` silently restyles unrelated UI everywhere — and only *after* an
  editor has mounted, which presents as a "works until you open X" bug in a feature that has
  nothing to do with the editor. Real case: `[role="tooltip"] { position: fixed !important }` in
  `math_form.css` collapsed the geomap marker preview (a MapLibre popup wrapping the app tooltip)
  to a 0×0 box, and read as a MapLibre/Firefox positioning bug. When debugging that symptom, dump
  `getComputedStyle` on the broken element and scan stylesheets with `el.matches(rule.selectorText)`
  — pay particular attention to bare tag and attribute selectors.

## Imports & modules

- **Library symbols always come from the `ckeditor5` aggregate**
  (`import { Plugin, ButtonView, Command, _setModelData } from 'ckeditor5';`) — never deep
  `@ckeditor/ckeditor5-*` paths (`allow-imports-only-from-main-package-entry-point`,
  `no-legacy-imports`). The only allowed `@ckeditor/*` deep imports are the dev/debug packages
  `@ckeditor/ckeditor5-icons` and `@ckeditor/ckeditor5-inspector`.
- **Cross-plugin** imports inside `packages/ckeditor5` are relative
  (`import Kbd from './keyboard_marker/keyboard_marker.js';`), as are same-plugin imports
  (`import FooEditing from './foo_editing.js';`). The former plugin packages were the one
  remaining workspace-package import.
- **All imports include file extensions** (`.ts`/`.js`/`.json`) — `import './augmentation.js';`
  even though the source is `.ts` (`require-file-extensions-in-imports`).
- SVG icons import with the `?raw` suffix (`import fooIcon from '../theme/icons/foo.svg?raw';`) and
  are surfaced via `export const icons = { fooIcon };` in `index.ts`.

## Plugin specifics

- Provide `static get pluginName()` (`return 'Foo' as const;` — PascalCase, matching the package
  folder) and `static get requires()` returning the sub-plugins with `as const`
  (`return [ FooEditing, FooUI ] as const;`).
- **No `isOfficialPlugin`/`isPremiumPlugin` flags** — Trilium plugins do not set them.

## Type augmentation (`src/augmentation.ts`)

Register the plugin's types into the **`ckeditor5` aggregate module** (not
`@ckeditor/ckeditor5-core`). Import `./augmentation.js` for side effects from `index.ts`.

```ts
import type { Foo, FooEditing, FooUI } from './index.js';
import type FooCommand from './foocommand.js';

declare module 'ckeditor5' {
	interface PluginsMap {
		[ Foo.pluginName ]: Foo;
		[ FooEditing.pluginName ]: FooEditing;
		[ FooUI.pluginName ]: FooUI;
	}
	interface CommandsMap { foo: FooCommand; }   // optional — only if the plugin adds a command
	interface EditorConfig { foo?: { /* … */ }; } // optional — only if the plugin adds config
}
```

## Package & workspace

- A new plugin needs **no packaging at all** — it is a folder under
  `packages/ckeditor5/src/plugins/` and is registered by editing `plugins.ts`. See
  `references/tooling-and-packaging.md` for the registration flow.
- The former plugin packages showed an older shape, still visible in history:
  scope `@triliumnext/`, `"type": "module"`, `"main": "src/index.ts"` (ships TS source — no
  per-package dist), a `peerDependencies` entry for `ckeditor5` matching the repo's pin, pulled in with
  `workspace:*`. Don't copy it for new work.

## TypeScript config

Each package has its own `tsconfig.json`: `composite: true`, `target: es2019`, `strict`,
`module`/`moduleResolution`: `NodeNext` (hence the `.js` import extensions). A `tsconfig.test.json`
extends it for tests.

## Localization

User-facing strings go through `editor.t( … )`, passing **the English text itself** as the message
id. The English entry then goes under `text-editor.ck` in
`apps/client/src/translations/en/translation.json`, keyed by the slug of that text. Two silent
traps: the function must be *named* `t`, and its first argument must be a literal — anything else
renders English forever. There are no `lang/en.po`/`contexts.json` catalogs (removed) and no host
`translate` config (retired). Full rules in `references/ui-and-localization.md`.

## Visibility & documentation

- Public by default. Mark `@protected` / `@private` in JSDoc. Protected members are reachable
  from tests (tests live in the same package) — that's the idiom for testability.
- TS non-public members get `@internal` so they're stripped from `.d.ts`
  (`non-public-members-as-internal`; needs `stripInternal: true`).
- Block comments `/** … */` are for JSDoc only; everything else uses line comments `//`,
  preceded by a blank line, capitalized, ending with a period, one space after `//`.

## Errors

Throw `CKEditorError` with a kebab id and a documenting `@error` JSDoc block explaining cause
and fix (`ckeditor-error-message`):

```js
/**
 * Why this happened and how to fix it.
 *
 * @error ckeditor5-example-error
 */
throw new CKEditorError( 'ckeditor5-example-error', this );
```

## TypeScript rules

- **No `enum`** — use `const X = { … } as const;` + `type X = typeof X[keyof typeof X]`
  (`no-enum`).
- Use `as const` where exact literal types matter (e.g. `pluginName`).
- Don't hardcode `'$root'`: check `node.is( 'rootElement' )` not `name === '$root'`
  (`no-literal-dollar-root`). (Exception: view listener `context: '$root'` for tree bubbling.)
- Pass explicit context to APIs that silently default to `$root`
  (`require-explicit-data-context`): `editor.data.parse( html, '$documentFragment' )`,
  `document.createRoot( '$inlineRoot' )`.

## Formatting

- **Tabs** for indentation (display as 4). LF endings, no trailing spaces. Lines ≤120 chars
  (hard max 140).
- Spaces inside `( … )` and around operators: `if ( a > b ) { c = ( d + e ) * 2; }`. No space
  for empty `()`. Single quotes for strings. Braces on the same line as the head.
- Multi-line calls: first param on a new line, one tab per param, closing paren at the
  statement's indentation.
- Class member order: constructor → getters/setters → iterators → public instance → public
  static → protected instance → protected static → private instance → private static.
- Getters must be fast, side-effect-free, non-throwing, and shouldn't allocate new instances
  each call (cache).
- Avoid >3 positional args (use an options object); extract complex conditions into named
  functions with early returns. Format only the code you actually touch (don't reflow
  unrelated code in a PR).
