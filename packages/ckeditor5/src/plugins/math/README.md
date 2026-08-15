# Math

TeX equations, rendered with KaTeX (what Trilium configures) or MathJax. An equation is either an
inline `mathtex-inline` widget or a block `mathtex-display` one, both carrying the source in an
`equation` attribute. Editing happens in a balloon dialog backed by a MathLive `<math-field>`, with
a plain LaTeX textarea beside it and a live preview.

Load the `Math` glue plugin; it pulls in `MathEditing` and `MathUI`. `AutoformatMath` is separate
and opt-in — it turns `$$` or `\[` at the start of a block into an equation prompt.

## Files

| File | Role |
|---|---|
| `math.ts` | Glue plugin; also declares the `ckeditor5` module augmentation, including the `math` config key |
| `math_editing.ts` | Schema, conversion, the `math` command, and the data-processor hook that preserves newlines |
| `math_command.ts` | The `math` command — inserts or updates an equation |
| `math_ui.ts` | Toolbar button, `Ctrl+M`, and the balloon that hosts the form |
| `math_live_edit.ts` | In-place editing: mounts a `<math-field>` in the widget and announces the session |
| `math_live_balloon.ts` | The balloon shown for as long as that field is mounted |
| `mathlive_loader.ts` | One lazy load of MathLive, plus static markup rendering for previews |
| `symbols.ts` | The symbol gallery's own table, grouped as OneNote's equation ribbon groups its |
| `structures.ts` | The structure galleries' table, OneNote's eleven less Accent and Matrix |
| `main_form_view.ts` | The dialog: input, display toggle, preview, save/cancel |
| `math_input_view.ts` | The MathLive `<math-field>` and LaTeX textarea, kept in sync |
| `math_view.ts` | The rendered preview |
| `autoformat_math.ts` | The `$$` / `\[` shorthand |
| `utils.ts` | Delimiter helpers, `renderEquation`, balloon positioning |
| `typings_external.ts` | Types for KaTeX and MathJax, which are read off globals |

## Storage formats

Which one is produced depends on `config.math.outputType` (Trilium uses `span`):

- `span` — `<span class="math-tex">\(x^2\)</span>`, display equations use `\[…\]`
- `script` — `<script type="math/tex">x^2</script>`, display uses `math/tex; mode=display`

Upcast is deliberately more permissive than downcast: it also reads Quill's
`<span class="ql-formula" data-value="…">`, so content pasted from other editors survives.

## Rendering

`renderEquation` supports KaTeX, MathJax 2, MathJax 3 and a caller-supplied function, and finds the
engine on `window` rather than importing it — Trilium loads KaTeX lazily via `config.math.lazyLoad`
and the loader runs at most once (`window.CKEDITOR_MATH_LAZY_LOAD` caches the promise). Note the
custom-function engine is handed the target element directly and **skips preview handling
entirely**, so no preview element is created on that path.

## Known rough edges

Longstanding, preserved deliberately; none are regressions from the move into this package.

- **The `value` binding on the input is fragile.** `MathUI` binds `mathInputView#value` to the
  command, but `MathInputView` assigns its own `value` whenever the MathLive field or the textarea
  reports a change. Writing a bound property directly severs the binding, so from the first edit
  onward the form no longer tracks the command. `_addFormView()` compensates by pushing the
  command's equation in by hand each time the dialog opens — that assignment looks redundant with
  the binding but is not.
- **The preview element is never hidden or removed by hand.** Both `MathUI#destroy()` and
  `_removeFormView()` look it up with `getElementById` *after* the form view has already been
  destroyed or removed from the balloon, and the preview lives inside that view — so the lookup
  finds nothing. Harmless, because the element goes away with its parent, but the code reads as if
  it does something.
- `AutoformatMath` sets `command.display = true` before opening the dialog, but `MathCommand`
  recomputes `display` from the selection on the next model change, which lands first. Typing `$$`
  may therefore open the dialog in inline rather than display mode.

## Provenance

Vendored, then reworked.

Forked from [isaul32/ckeditor5-math](https://github.com/isaul32/ckeditor5-math) by Sauli Anto,
**ISC** licensed — see [`LICENSE`](./LICENSE) next to this file. ISC is permissive and combines with
this repository's AGPL-3.0-only license.

It is not tracked against upstream and could not easily be: the source was ported to TypeScript and
through several CKEditor 5 API renames, the MathLive-based input view and its preview are Trilium's
own, and Trilium added the `\gdef` macro isolation and offline font bundling.

It lived at `packages/ckeditor5-math` until it was folded into this package, which had always been
its only consumer. Points worth recording from that move:

- The package's `mathlive` and `@ckeditor/ckeditor5-icons` dependencies moved to this package —
  they are the only runtime dependencies the math feature needs, and MathLive is by far the
  heaviest thing the editor bundles.
- `math_input_view.ts` used to re-declare `window.mathVirtualKeyboard`. MathLive declares it
  itself; the duplicate was harmless in a separate package but collides here, so it is gone.
- The **AutoMath** paste feature was removed before the move (see 5f833734c2): it listened for
  `inputTransformation` on the `Clipboard` facade rather than `ClipboardPipeline`, so it had never
  fired, and once fixed it proved too narrow to keep.
- The package's `tsconfig.test.json` referenced an uninstalled `@types/mocha`, so nothing ever
  typechecked its tests. Being in this package, they are typechecked now.
