---
name: ckeditor5-reviewing
description: >-
  Review or audit CKEditor 5 plugin code in the Trilium (TriliumNext Notes)
  monorepo, or a PR/diff touching packages/ckeditor5-* or the packages/ckeditor5
  build. Use when checking a Trilium CKEditor 5 plugin for correctness and idiom:
  schema / conversion / command / UI / widget code, CKEditor-specific defects
  (asymmetric upcast/downcast, unconsumed upcast elements, missing inline-widget
  position mapping, command refresh/isEnabled bugs, memory leaks, t() gaps,
  editing/UI split violations), and Trilium integration defects (plugin not
  registered in plugins.ts, button missing from toolbar.ts, import/file-extension
  lint failures, wrong augmentation module, .po localization gaps, wrong test
  environment). Pairs with the ckeditor5-plugin-development and
  ckeditor5-testing skills and delegates their checklists.
---

# Reviewing CKEditor 5 plugins in Trilium

A workflow and defect catalog for **reviewing** CKEditor 5 plugin code in the Trilium monorepo — a
distinct task from writing it. This skill orchestrates the review and hunts both CKEditor-specific
and Trilium-integration bugs; it **delegates the per-dimension "is this idiomatic?" checklists** to
the companion skills rather than duplicating them:

- **`ckeditor5-plugin-development`** — its `references/review-checklist.md` (architecture, schema,
  conversion, commands, UI, a11y) and `references/conventions.md` (naming, imports, JSDoc, TS).
- **`ckeditor5-testing`** — its review checklist and patterns for the test side (Vitest, happy-dom
  vs. `@vitest/browser-webdriverio` browser mode, real `ClassicEditor.create`).

Use those for "does this follow the conventions"; use this skill for **how to drive the review**
and **what subtle things tend to be wrong**.

## Scope & sources

This skill reviews **CKEditor 5 plugin code in the Trilium monorepo** (scope `@triliumnext/`). The
CKEditor 5 library itself is the **external `ckeditor5` dependency pinned at 48.2.0** — its docs
([ckeditor.com/docs](https://ckeditor.com/docs)) and source
([github.com/ckeditor/ckeditor5](https://github.com/ckeditor/ckeditor5)) are *external references*,
not the code under review. The Trilium plugins live in `packages/ckeditor5-{admonition,collapsible,
footnotes,keyboard-marker,math,mermaid}`; they are assembled by the build/aggregator package
`packages/ckeditor5` and wired into the editor UI from `apps/client`.

## When to use

Reviewing a PR or diff that touches a Trilium CKEditor 5 plugin (`packages/ckeditor5-*`), the
aggregator (`packages/ckeditor5`), or the toolbar config in `apps/client`; auditing an existing
plugin; sanity-checking your own feature before opening a PR. For *writing* the feature, use
`ckeditor5-plugin-development`; for *writing tests*, use `ckeditor5-testing`.

## Review workflow

1. **Scope the diff against Trilium's structure.** What surface changed — editing
   (schema/conversion/command), UI (componentFactory/buttons/dropdowns/balloons), a widget, config?
   Which Trilium plugin package (`packages/ckeditor5-<x>`)? Does it also touch the aggregator
   (`packages/ckeditor5/src/plugins.ts`, `src/index.ts`) or the toolbar
   (`apps/client/src/widgets/type_widgets/text/toolbar.ts`)? This tells you which checklists, defect
   groups, and integration checks apply.
2. **Read model-first.** The model is the source of truth; trace the feature in order
   **schema → conversion → command → UI**. Confirm each layer is present and consistent (e.g. a
   new model element has a schema registration *and* upcast *and* downcast *and* an insertion path).
3. **Check registration & wiring (Trilium-specific).** A correct plugin that nobody loads is still
   broken. Confirm:
   - the plugin is exported and added to the right array in `packages/ckeditor5/src/plugins.ts`
     (`CORE_PLUGINS` / `TRILIUM_PLUGINS` / `EXTERNAL_PLUGINS` → `builtinPlugins`) so it actually
     loads into the editor classes in `packages/ckeditor5/src/index.ts` (AttributeEditor[Balloon],
     ClassicEditor[Decoupled], PopupEditor[Balloon]);
   - any new toolbar component is added to `apps/client/src/widgets/type_widgets/text/toolbar.ts`,
     otherwise the button never appears even though the plugin loaded.
4. **Check conventions (Trilium-specific).** Imports come from the `ckeditor5` aggregate (or
   cross-plugin `@triliumnext/ckeditor5-<x>`) **with explicit file extensions**; augmentation uses
   `declare module 'ckeditor5'` (never `@ckeditor/ckeditor5-core`); any license header matches the
   package's existing convention (it's not uniform across packages); new UI strings are in
   `lang/en.po` + `lang/contexts.json`. These are enforced by `eslint-config-ckeditor5`
   (`require-file-extensions-in-imports`, `allow-imports-only-from-main-package-entry-point`,
   `no-legacy-imports`) and `stylelint-config-ckeditor5` — a diff that breaks them fails lint.
5. **Run the tests for the affected package.** Use Vitest via
   `pnpm --filter @triliumnext/ckeditor5-<f> test` (math + mermaid run sequentially). Note the test
   environment: admonition/collapsible use **happy-dom**; math/mermaid/footnotes/keyboard-marker use
   **`@vitest/browser-webdriverio` browser mode** (NOT Playwright). Coverage ≠ correctness: confirm
   the *change itself* is tested, not just that lines are hit. A bug fix with no new/changed test is
   a red flag even when coverage stays green.
6. **Observe behavior.** Attach the CKEditor Inspector (model / view / schema / commands), then:
   round-trip `editor.getData()` → `setData()` (does content survive a save?); exercise selection
   edge cases (collapsed vs. ranged, inside objects/limits, at attribute boundaries); toggle
   read-only.
7. **Apply the dimension checklists** (delegate to the two companion skills).
8. **Hunt defects** with `references/defect-patterns.md` — the high-value, easy-to-miss failure
   modes (CKEditor-general + Trilium integration).
9. **Verify each finding before reporting it** (see below). Reproduce it, or cite the exact line
   and the rule it breaks. Discard the ones that don't hold up.
10. **Report** findings: severity-tagged, `file:line`, with the concrete fix or question.

## Triage / severity

- **Blocker** — data loss (content dropped on `getData()`), crashes/console errors, undo
  corruption, security (unsanitized HTML/XSS), schema corruption; **plugin not registered in
  `plugins.ts`** (feature silently never loads).
- **Major** — incorrect behavior in real selections, accessibility gaps (no keyboard path, missing
  labels/`addKeystrokeInfos`), memory leaks, command enabled where the schema disallows it; **button
  missing from `toolbar.ts`**; **lint-failing imports** (missing file extension / wrong package /
  legacy `@ckeditor/*`) that block the build.
- **Minor** — convention/naming issues, missing `t()`, missing `lang/en.po` entries, redundant
  converters, non-idiomatic but working code.
- **Nit** — style preferences with no behavioral impact; mark them as optional.

Lead with blockers/majors; don't bury them under nits.

## Verify before reporting (avoid false positives)

A noisy review erodes trust. Confirm a finding is real before raising it. Common **false
positives** to *not* raise:

- "Missing downcast" when the code uses a **two-way** helper (`conversion.attributeToElement(...)`
  registers both directions) — count two-way helpers, not just `for('dataDowncast')`.
- "`getAttribute('data-x')` should be `.dataset`" inside a **converter callback** — that's a view
  element, not DOM; `.dataset` would silently drop the value (see the plugin-dev `conversion.md`
  view-element pitfall).
- "Boolean attribute should be set to `false`" — the idiom is to **remove** it (yields `undefined`).
- "Button state not updated" when it's `bind()`-ed to the command (reactive, not imperative).
- "Listener never removed" when added via `this.listenTo()` (auto-cleaned in `destroy()`).
- "Plugin not registered" when it's pulled in transitively via another plugin's
  `static get requires()` rather than listed directly in `plugins.ts` — check the dependency chain
  before flagging.
- "Import should be from `@ckeditor/ckeditor5-*`" — Trilium deliberately imports from the `ckeditor5`
  aggregate (with file extensions); the deep `@ckeditor/*` path is the *lint failure*, not the fix.

When unsure, phrase it as a **question** ("Is `<mark>` intended to round-trip through `getData()`?
I don't see a `dataDowncast`.") rather than a false assertion.

## Reference map

| File | Use it for |
|------|-----------|
| `references/defect-patterns.md` | The bug catalog — CKEditor-general groups (conversion, schema, commands, UI, lifecycle, localization, undo, tests) plus a **Trilium integration** group. For each: the symptom, how to spot it in a diff, why it's wrong, and the fix. The core of a correctness review. |

## Provenance & source references

The CKEditor-general defect patterns are distilled from the companion skills and the CKEditor 5
library at the pinned **48.2.0**; `docs/…` / `packages/…` paths in those patterns point into the
**external CKEditor 5 repository** ([github.com/ckeditor/ckeditor5](https://github.com/ckeditor/ckeditor5)),
not the Trilium code under review. The Trilium-specific paths (`packages/ckeditor5-*`,
`packages/ckeditor5/src/{plugins,index}.ts`, `apps/client/src/widgets/type_widgets/text/toolbar.ts`,
`lang/en.po`) point into the **Trilium monorepo**. To refresh, re-check those paths against the
current Trilium tree and bump the CKEditor version if the `ckeditor5` pin changes.
