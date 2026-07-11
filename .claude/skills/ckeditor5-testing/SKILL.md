---
name: ckeditor5-testing
description: >-
  Testing CKEditor 5 plugins in the Trilium monorepo. Use when adding or
  reviewing unit tests for a packages/ckeditor5-* package, debugging a failing
  test, or setting up a package's test runner. Covers the two Vitest
  environments Trilium uses (happy-dom and the WebdriverIO browser mode), the
  per-package vitest.config.ts, testing against a real ClassicEditor, the
  model/view helpers imported from 'ckeditor5' (_setModelData / _getModelData /
  _getViewData and their {}/[] selection syntax), vi spies/mocks, idiomatic
  patterns for schema/conversion/command/UI tests, the pnpm --filter runner, and
  Trilium-specific conventions and gotchas. Complements the
  ckeditor5-plugin-development and writing-unit-tests skills.
---

# CKEditor 5 testing (Trilium)

Testing CKEditor 5 plugins in the **Trilium (TriliumNext Notes) monorepo**. **Tests are co-located
`*.spec.ts` next to the source** for the aggregator (`packages/ckeditor5`), in-aggregator plugins,
and any new code — matching the repo-wide convention. The existing standalone packages
(`packages/ckeditor5-<name>/`) keep their legacy `tests/` directories. Browser-mode packages gate
`src/**` at **100% coverage**, so every code change should ship with a test.

## Scope & sources

This skill covers testing CKEditor 5 plugins in the **Trilium (TriliumNext Notes) monorepo**
(`packages/ckeditor5-*`). The CKEditor 5 library is pinned to 48.2.0. For general (non-CKEditor)
Trilium testing, see the `writing-unit-tests` skill.

## When to use this skill

Adding/reviewing unit tests for a plugin, debugging a failing test, or configuring a package's
runner. For writing the feature itself, use the `ckeditor5-plugin-development` skill. For general
Trilium testing (Preact components, jQuery widgets, server routes), use `writing-unit-tests`.

## The current setup at a glance

- **Runner:** Vitest (`vitest@4.1.8`). **No shared factory** — each package has its own
  `vitest.config.ts` built with `defineConfig` directly.
- **Two environments**, chosen per package:
  - **happy-dom** (`environment: "happy-dom"`) — used by `admonition`, `collapsible`. Light, no
    coverage thresholds. happy-dom is **not a real browser**: `getBoundingClientRect()` returns
    zeros, layout is stubbed, `ResizeObserver` is stubbed. Fine for model/conversion/command
    logic; wrong for anything that measures the DOM.
  - **WebdriverIO browser mode** (`@vitest/browser-webdriverio`, headless Chrome) — used by
    `footnotes`, `keyboard-marker`, `math`, `mermaid`. Real DOM/layout. Gates `src/**` coverage
    at 100% (lines/functions/branches/statements). This is **not Playwright**.
- **Real editor, no test-editor factories.** Tests create a real `ClassicEditor` against a real
  DOM element (see below). There is **no** `ModelTestEditor`/`VirtualTestEditor`/`ClassicTestEditor`
  in Trilium — those live only in the upstream ckeditor5 monorepo's `tests/_utils`.
- **Helpers from `'ckeditor5'`:** `_setModelData`, `_getModelData`, `_getViewData` are imported
  from the `ckeditor5` package.
- **Test-file location:** **co-located `*.spec.ts`** next to the source is the default — the
  aggregator, in-aggregator plugins (`src/plugins/foo.spec.ts`), and new code, with vitest
  `include: ['src/**/*.spec.ts']` (as on `feature/collapsible_experiment`). The existing standalone
  packages instead use a `tests/` dir (`include: ['tests/**/*.[jt]s']`, no `.spec` suffix) — leave
  them; new standalone packages should use co-located `.spec.ts` too. `globals: true`. Coverage
  provider `v8`, `include: src/**` (test files themselves excluded from coverage). The aggregate
  (`packages/ckeditor5`) must also `exclude: ['**/ckeditor5-*/**']` + `allowExternal: false` or the
  imported sibling packages bleed in (see `references/running-and-config.md`).
- **Imports** from `'ckeditor5'`; in-package source imports use a file extension.
- **License key:** tests pass `licenseKey: 'GPL'` in the editor config.
- Some packages (`admonition`, `footnotes`, `keyboard-marker`) have a vitest config but **no
  tests yet** — adding tests is encouraged.

## Running tests

```bash
pnpm --filter @triliumnext/ckeditor5-math test     # one package (from anywhere)
# or, from the package dir:
vitest run
```

Debug a browser-mode package with a visible browser:

```bash
vitest --inspect-brk --no-file-parallelism --browser.headless=false
```

Root orchestration: `pnpm test:parallel` runs the light packages in parallel; `pnpm
test:sequential` runs `math` and `mermaid` **sequentially** (browser resource limits).
`pnpm test:all` runs both. Each package exposes `"test": "vitest"` and
`"test:debug": "vitest --inspect-brk --no-file-parallelism --browser.headless=false"`.

## Anatomy of a test

In the aggregate (`packages/ckeditor5`), use the shared **editor kit** —
`createTestEditor()` from `test/editor-kit.ts` builds a real `ClassicEditor` (`licenseKey: 'GPL'`,
auto-tracked) and the global `afterEach` in `test/setup.ts` (wired via `setupFiles`) destroys every
tracked editor, so specs **don't** write their own editor-teardown `afterEach`:

```ts
import { ClassicEditor, Essentials, Paragraph, _setModelData } from 'ckeditor5';
import { describe, it, expect, beforeEach } from 'vitest';

import { createTestEditor } from '../../test/editor-kit.js';
import MyPlugin from './myplugin.js';

describe( 'MyPlugin', () => {
	let editor: ClassicEditor;

	beforeEach( async () => {
		editor = await createTestEditor( [ Essentials, Paragraph, MyPlugin ] );
	} );

	it( 'loads the plugin', () => {
		expect( editor.plugins.get( MyPlugin ) ).toBeInstanceOf( MyPlugin );
	} );

	it( 'keeps the selection in a paragraph', () => {
		_setModelData( editor.model, '<paragraph>foo[]bar</paragraph>' );
		expect( editor.model.document.getRoot().getChild( 0 ).name ).toBe( 'paragraph' );
	} );
} );
```

Need the host element? It's `editor.sourceElement` (or `getEditorElement( editor )` from the kit).
Some legacy specs still hand-roll the create/destroy scaffold (`document.createElement('div')` +
`ClassicEditor.create(...)` + a teardown `afterEach`) — those are being migrated to `createTestEditor`.

Conventions visible here and across the suite:
- One top-level `describe` named after the unit, nested `describe`s for areas (`isEnabled`,
  `execute()`, …), small focused `it`s.
- Create the editor in `beforeEach` (return the Promise or use `async`/`await` — Vitest awaits it).
- Pass `licenseKey: 'GPL'` (the kit does this for you). List only the plugins the test needs
  (commands can also be instantiated directly, e.g. `new InsertMermaidCommand( editor )`).

## Model/view test data

`_setModelData()` / `_getModelData()` (and `_getViewData()`) stringify and parse the engine
structures, with a special selection syntax:

- `[]` — collapsed selection, **or** brackets around a range, anchored in an **element**.
- `{}` — selection anchored inside a **text node** (e.g. `foo{}bar` / `f{oo}bar`).
- Attributes render as `<$text bold="true">word</$text>`; elements as `<paragraph>…</paragraph>`.

```ts
_setModelData( model, '<paragraph>foo[]bar</paragraph>' );
expect( _getModelData( model ) ).toEqual( '<paragraph>foo[]bar</paragraph>' );
expect( _getViewData( editor.editing.view ) ).toEqual( '<p>foo{}bar</p>' );
```

These are dev/test utilities only — never ship them in production code.

## Assertions & spies (Vitest)

- Both **Jest-style** (`expect(x).toBe(y)`, `.toEqual()`, `.toBeInstanceOf()`,
  `.toHaveBeenCalledWith()`) and **Chai-style** (`expect(x).to.equal(y)`, `.to.be.false`,
  `.to.instanceOf()`) matchers work in Vitest. The existing Trilium tests mix both. There are
  **no** custom matchers — compare stringified model/view directly.
- Spies/mocks via `vi`: `vi.spyOn( editor, 'execute' )`, `vi.fn()`, `vi.useFakeTimers()`.

```ts
const spy = vi.spyOn( editor, 'execute' );
button.fire( 'execute' );
expect( spy ).toHaveBeenCalledWith( 'insertMermaid' );
```

## Stubbing the Trilium glue (`glob` / clipboard / jQuery `$`)

Many in-aggregate plugins reference a global `glob` (the Trilium bridge typed in
`src/augmentation.ts`), some hit `navigator.clipboard`, and some converters call jQuery `$(...)`.
Use the globals kit (`test/globals-test-kit.ts`): `installGlobMock({…})` and `mockClipboard({…})`
install the stub **and register their own teardown** (run by the global `afterEach` in
`test/setup.ts`), and `$` is a global passthrough from `setup.ts` — so specs **don't** hand-roll
`globalThis.glob` or delete anything. (Browser mode shares one page, so a leaked global would bleed
into later specs.) See `references/patterns.md` for the recipe.

## Reference map

| File | Use it for |
|------|-----------|
| `references/test-utilities.md` | Testing against a real `ClassicEditor` (lifecycle, `licenseKey: 'GPL'`), and the `_setModelData`/`_getModelData`/`_getViewData` helpers from `'ckeditor5'` + the `[]`/`{}` selection syntax. |
| `references/patterns.md` | Idiomatic recipes per concern (schema, conversion round-trips, commands, UI, keystrokes, events, async), all against a real editor; the `glob`/clipboard/jQuery-`$` stubbing recipe (via the globals kit's `installGlobMock`/`mockClipboard`); note on the 100% coverage gate for browser-mode packages. |
| `references/running-and-config.md` | Per-package `vitest.config.ts` (happy-dom shape and WebdriverIO browser shape), `pnpm --filter` commands, the debug command, `pnpm test:parallel`/`test:sequential` (math+mermaid sequential), coverage thresholds. |
| `references/test-conventions.md` | Trilium test **conventions & gotchas**: choosing happy-dom vs. browser mode, real-editor teardown, the both-assertion-styles note, sequential math/mermaid, and the pointer to `writing-unit-tests`. |

## Quick review checklist

When reviewing tests: editor created in `beforeEach` with `licenseKey: 'GPL'` and **destroyed**
in `afterEach` (plus `editorElement.remove()`); model/view asserted via
`_getModelData`/`_getViewData` with correct `[]`/`{}` selection syntax; spies via `vi`; behavior
covered for collapsed **and** ranged selections and schema-disallowed contexts; for browser-mode
packages, new `src/` lines covered (100% gate); no reliance on real layout when the package uses
happy-dom.
