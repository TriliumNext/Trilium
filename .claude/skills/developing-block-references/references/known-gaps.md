# Known gaps

Current behavior that is a defect or a limitation, so it is not mistaken for a design, nor
designed around without knowing. **Remove an entry in the change that fixes it.** Entries under
"To confirm" come from reading the code; reproduce them before building on them.

## Defects

| Gap | Where |
|---|---|
| Following a block link from the keyboard drops the block: a reference link opens the whole note, a text link with `?block=` falls through to `window.open()` (`EditableText.spec.ts` asserts the dropped scope) | `followLink()` in `EditableText.tsx`; `getNotePathFromUrl()` in `link.ts` |
| A failed fetch of a target note caches an empty document, so every link to that note reads _Broken reference_ until its `blobId` changes. `froca.getBlob()` resolves `null` instead of rejecting, so the `.catch` that drops the entry never runs; the spec mocks a rejection | `loadContent()` in `block_excerpts.ts` |
| Markdown Wikilink chips ignore `isBroken` and read "Title - Broken reference" | `resolveWikilinkChip()` in `markdown/editor_utils.ts` |
| A malformed `%` escape in a link throws `URIError` out of `parseNavigationStateFromUrl()`; only the paste path catches it | `goToLinkExt()`, `loadReferenceLinkTitle()` in `link.ts` |
| _Copy public link_ reports success when the clipboard write fails: `copyText()` does not await `writeText()` | `services/clipboard_ext.ts` |
| After `api.refreshIncludedNote()`, an embed of a whole note inside an excerpt of that note becomes a link: the refresh adds both `noteId` and `noteId:block` to the seen keys, the first render only the second | `refreshEmbeddedNote()` in `text/utils.ts` |
| A Compact excerpt shows no badge and no pencil (`CompactContentEmbed` takes no `isExcerpt`), though its wrapper has the `excerpt` class | `ContentEmbed.tsx`, `text/utils.ts` |
| An excerpt of a note that is not a text note renders the whole note, yet shows the badge, a disabled pencil and no fullscreen: `isExcerpt` comes from `block` alone | `text/utils.ts`, `content_renderer.ts` |
| Replacing an image with a drawing, and a link preview that changes shape, happen in two changes, so the block loses its id | `image_to_drawing.ts`, `link_embed/link_embed_commands.ts` |

## Limitations

| Limitation | Notes |
|---|---|
| Merging two blocks (<kbd>Backspace</kbd> at the start of the second, Vim `J`) drops the second block's id | References to it break |
| The reveal does not expand collapsed list items | Only `<details>`, tabs and collapsed headings |
| `ReadOnlyText` reveals right after the synchronous rendering; diagrams, math and embeds finish later and can move the target | Shared pages wait for the drawings |
| Mobile cannot copy references: no block handle (and none on Android in any layout), no text context menu | Following, labels, excerpts and native paste work; the tabs ⋮ copy is the likely exception |
| Labels of links to other notes are computed when the link renders | Same-note links in an editor follow edits |
| Labels and read-only excerpts download the whole target note | `GET …/blocks` could serve them, one request per reference |
| Only runs of whole siblings are editable in place | Part of a list or a quote stays read-only |
| An excerpt of one code block or source embed is not editable in place | The id is on `<code>`, and `<pre>` is not a run container |
| A read-only slice of a to-do item drops its checkbox; a slice of a captioned media or source embed drops its caption | `sliceToBlockRange()` |
| Only text notes are sliced in the app | An excerpt of a Markdown note renders the whole note; shared pages and the static export slice it |
| `refreshIncludedNote()` passes no `onBlockChange` | Its excerpts edit but keep their old range |
| The `/blocks` routes do not check `#readOnly` or a read-only database | The client enforces read-only |
| No conflict detection within a range | Decided: the last writer wins, as for whole notes |
| Markdown export drops ids on blocks written as Markdown | Excerpts keep `data-block` |
| Markdown import writes Wikilinks as `/id?…`, not `#root/…` | No backlink, no block navigation |
| Shared pages show no message for a broken range, and label a link to a block of another note with the note title, unless the block is a heading | |
| A public link copied with a sync server finds the block only after the next sync | `showLinkedBlocks()` ignores a failed lookup |
| Excerpts in the static export resolve notes through `shaca`, which the export path does not load: excerpts of notes outside the shared tree can show "not available" | Seen in the code, not reproduced |

## To confirm

| Suspicion | Where |
|---|---|
| A reversed `<ol>` that holds only the end of a range gets no `start`, so trimming its tail renumbers it | `keepListNumbering()` in commons `block_reference.ts` |
| A range that is a single tab, or a `<summary>`, passes `getEditableBlockRun()`; the excerpt editor would flatten it and the PUT would write the flattened HTML back into the tabs block or the `<details>` | `RUN_CONTAINERS` |
| With the caret in a collapsible's title, _Copy reference_ puts the id on `<summary>`, while the handle menu names the whole collapsible | `getReferenceBlocks()`, `getDraggedBlock()` |
