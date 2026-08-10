# Footnotes

An inline `[n]` citation in the body text, paired with a numbered entry in a footnote section at the
end of the note. Footnotes renumber themselves: the numbering always follows the order the
references appear in the text, whatever order the entries were created in.

Load the `Footnotes` glue plugin; it pulls in `FootnoteEditing` and `FootnoteUI`.

## What a footnote is made of

Five model elements, all declared in `schema.ts`:

| Element | Where it lives | Notes |
|---|---|---|
| `footnoteSection` | `$root`, at the end | Object; holds every `footnoteItem` |
| `footnoteItem` | inside `footnoteSection` | Object; carries `data-footnote-id` + `data-footnote-index` |
| `footnoteContent` | inside `footnoteItem` | The editable body; takes anything `$root` takes |
| `footnoteReference` | wherever `$text` is allowed | Inline object; the `[n]` marker in the body |
| `footnoteBackLink` | inside `footnoteItem` | Inline, not selectable; the `^` link back up |

`data-footnote-id` is what actually pairs a reference with its entry — a short random string minted
per footnote. `data-footnote-index` is only the *displayed* number, and is rewritten freely as
things move around. Both are always strings; nothing in the plugin compares them numerically.

A footnote's content may hold anything the document root can, **except** a nested footnote section.

## The HTML it produces

The saved (data) view:

```html
<p>text<span class="footnote-reference" data-footnote-reference data-footnote-id="ab12"
             data-footnote-index="1" role="doc-noteref" id="fnrefab12"><sup><a href="#fnab12">[1]</a></sup></span></p>

<ol class="footnote-section footnotes" data-footnote-section role="doc-endnotes">
  <li class="footnote-item" data-footnote-item data-footnote-id="ab12" data-footnote-index="1"
      role="doc-endnote" id="fnab12">
    <span class="footnote-back-link" data-footnote-back-link data-footnote-id="ab12"><sup><strong><a href="#fnrefab12">^</a></strong></sup></span>
    <div class="footnote-content" data-footnote-content><p>…</p></div>
  </li>
</ol>
```

The editing view differs in one deliberate way: the section downcasts to a `<div role="doc-endnotes list">`
rather than an `<ol>`. An `<ol>` there caused the section to duplicate itself at random; the ARIA
role keeps it announced as a list. Upcast keys off the `data-footnote-*` attributes, not the tag or
the classes, so both shapes read back in.

## Behaviour worth knowing

- **Inserting.** `InsertFootnote` with `footnoteIndex: 0` (or no argument) appends a new entry and
  drops a reference at the caret, creating the section if it is the first one. With a non-zero
  index it inserts a *second reference* to the entry already holding that number, adding no new
  entry. The command disables itself wherever a reference is not schema-valid.
- **Renumbering.** Inserting any reference re-sorts the entries so they match the reference order in
  the body, then renumbers entries and their references together. Entries nobody references sort to
  the end.
- **Deleting.** Backspace in an *emptied* footnote removes that footnote, its references, and — if
  it was the last one — the whole section, then renumbers what remains and parks the caret in a
  neighbouring entry. Deleting the section removes every reference in the body.
- **Autoformat.** Typing `[^n]` inserts a reference: `n` must be an existing footnote's number, or
  exactly one past the end (which creates a new footnote). Anything else is left as literal text.
- **Toolbar.** A split button — the button inserts a new footnote, the dropdown also lists the
  existing ones so you can add another reference to one. The list is rebuilt on every open, since
  which footnotes exist changes as you edit.

## Known rough edges

These are longstanding and preserved deliberately; none of them are regressions from the move into
this package.

- Selecting a footnote entry and pressing Backspace removes it via CKEditor's default object
  deletion, which bypasses this plugin's handler — so the remaining footnotes are **not** renumbered.
  Only the empty-footnote path renumbers.
- Autoformat consumes the typed `[^n]` even when it declines to act (for example when the insert
  command is disabled), because the format callback returns `undefined` rather than `false` and
  `inlineAutoformatEditing` only skips its deletion step on an explicit `false`.
- Each time the toolbar dropdown opens, `addListToDropdown` appends a fresh `ListView` to the panel;
  the old ones are emptied and detached but stay in `panelView.children`.

## Files

| File | Role |
|---|---|
| `footnotes.ts` | Glue plugin; also declares the `ckeditor5` module augmentation |
| `footnote_editing.ts` | Command registration, delete handling, renumbering and reordering |
| `schema.ts` | The five model elements |
| `converters.ts` | Upcast/downcast for each element, in both data and editing views |
| `insert_footnote_command.ts` | The `InsertFootnote` command |
| `footnote_ui.ts` | The split button and its list of existing footnotes |
| `auto_formatting.ts` | The `[^n]` shorthand |
| `utils.ts` | Model/view tree query helpers |
| `constants.ts` | Element, class, attribute and command name tables |

Tests sit beside each source as `*.spec.ts` and run in the aggregate's WebdriverIO browser-mode
suite against a real `ClassicEditor`. Fixtures come from `test/footnotes-kit.ts` and build the
document with a model writer rather than `_setModelData()` — the parser coerces numeric-looking
attribute values (`data-footnote-index="1"`) to numbers where the plugin writes and compares
strings, and it reads `[^1]` as selection markers.

## Provenance

Vendored, then heavily reworked.

The original is the [Forum Magnum footnote
plugin](https://github.com/ForumMagnum/ForumMagnum/tree/master/public/lesswrong-editor/src/ckeditor5-footnote/src),
copyright (c) 2020 Bohan Niu, **ISC** licensed. Trilium took it by way of
[ThomasAitken/ckeditor5-footnotes](https://github.com/ThomasAitken/ckeditor5-footnotes), as the
*Technologies used* page in the User Guide records. [`LICENSE.md`](./LICENSE.md) next to this file
reproduces the original licence in full; ISC is permissive and combines with this repository's
AGPL-3.0-only licence.

It is **not** tracked against upstream and cannot easily be: upstream targets a much older
CKEditor 5, and the source here was ported to TypeScript and through the `Element` → `ModelElement`
/ `Writer` → `ModelWriter` rename wave. Treat it as Trilium-maintained code that happens to have
started elsewhere.

It lived at `packages/ckeditor5-footnotes` until it was folded into this package, which had always
been its only consumer. That package was never published and carried a
`ckeditor5-package-generator` scaffold — sample pages, its own ESLint/Stylelint/vitest configs —
that nothing invoked. Its vitest config declared a 100% coverage gate while containing no tests at
all, and CI never ran it with `--coverage`, so roughly 1300 lines went unexercised. The move added
the missing suite and fixed what it turned up:

- **Renumbering bug.** `_removeFootnote()` renumbered trailing footnotes with
  `` `${ index ?? 0 + i + 1 }` ``, which parses as `index ?? (0 + i + 1)`. Since `index` is
  non-null by that point, *every* trailing footnote was assigned the same number.
- The `modelQueryText` / `modelQueryTextAll` helpers and the `DATA_FOOTNOTE_ID` constant had no
  callers.
- The schema's `listItem` child check could never fire: since CKEditor 5 v41 the list feature models
  entries as ordinary blocks carrying `listItemId`/`listType`, so no `listItem` element exists.
- Assorted impossible guards — an `editor.plugins.has("Autoformat")` check inside a plugin that
  `requires` Autoformat, a `!index` test on a template-literal string, a `this.editor` null check
  inside a plugin method, a duplicated "index is nullish" throw.

Defensive guards that are unreachable but worth keeping are marked
`/* v8 ignore next -- defensive: … */` rather than deleted, so the coverage gate stays at 100%
without hiding anything.
