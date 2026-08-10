# Admonition

Info boxes / warning boxes: an `<aside class="admonition <type>">` container holding block content,
with five types (`note`, `tip`, `important`, `caution`, `warning`).

The feature is split the usual CKEditor way:

| File | Role |
|---|---|
| `admonition.ts` | Glue plugin; also declares the `ckeditor5` module augmentation |
| `admonition_command.ts` | The `admonition` command — wraps/unwraps blocks, owns the type names |
| `admonition_editing.ts` | Schema, upcast/downcast, post-fixer, Enter/Backspace break-out |
| `admonition_ui.ts` | The split button + type dropdown, and the user-facing type titles |
| `admonition_autoformat.ts` | `!!! <type> ` at the start of a block |
| `admonition_toolbar.ts` | Balloon toolbar shown when the selection is inside an admonition |
| `admonition_type_dropdown.ts` | Toolbar dropdown for switching an existing admonition's type |

## Provenance

The feature began as a copy of CKEditor 5's **block-quote** plugin
(`@ckeditor/ckeditor5-block-quote`, copyright CKSource Holding sp. z o.o.) and was then tailored to
admonitions — a different model element, a type attribute, its own styling and a different toolbar.
How much of upstream survives varies a lot per file, so the headers say so individually rather than
blanket-stamping the folder:

| File | Relationship to `ckeditor5-block-quote` |
|---|---|
| `admonition_command.ts` | **Substantially derived.** The block grouping/splitting/merging logic is upstream's; the type attribute, `forceValue`/`usePreviousChoice` handling and retyping are ours |
| `admonition_editing.ts` | **Substantially derived.** The post-fixer and Enter/Backspace break-out are upstream's; the schema, class-list upcast and downcast are ours |
| `admonition.ts` | Same glue-plugin shape as upstream's `BlockQuote`, plus our autoformat |
| `admonition_ui.ts` | **Ours.** Upstream has one toggle button; this is a split button with a type dropdown. Only the bind-and-focus idiom is shared |
| `admonition_autoformat.ts` | **Ours.** No upstream counterpart |
| `admonition_toolbar.ts`, `admonition_type_dropdown.ts` | **Ours.** No upstream counterpart |

CKEditor 5 is dual-licensed; the derived files are used under its
[GPL-2.0-or-later arm](https://ckeditor.com/legal/ckeditor-licensing-options), which combines with
this repository's AGPL-3.0-only license. GPL-2.0 §2(a) requires derived files to carry notice that
they were changed, which is what the headers on the two derived files do.

Separately, [aarkue/ckeditor5-admonition](https://github.com/aarkue/ckeditor5-admonition) was an
inspiration for the feature, the toolbar icon included — as recorded on the *Technologies used* page
of the User Guide.

It lived at `packages/ckeditor5-admonition` until it was folded into this package — it had no
consumers outside `@triliumnext/ckeditor5`, was never published, and shipped a
`ckeditor5-package-generator` scaffold (sample pages, its own ESLint/Stylelint/vitest configs) that
nothing invoked. Half the feature already lived here: `admonition_toolbar.ts` and
`admonition_type_dropdown.ts` were in the aggregate while the plugin they drive was in the package.

Two things were straightened out during the move:

- The package exported **two different** `ADMONITION_TYPES` — a tuple of names from the command
  module and a `Record<type, {title}>` from the UI module — and the barrel re-exported the UI one,
  shadowing the other. The tuple is now `ADMONITION_TYPE_NAMES` and is the only list of types; the
  record is gone, its titles now coming from `getAdmonitionTitle()`, which translates them.
- `theme/blockquote.css` did not belong to this feature at all — it is CKEditor's baseline
  `blockquote` styling, inherited from the fork. It moved to `src/theme/blockquote.css` and is
  imported from `src/index.ts` with the other global stylesheets.
