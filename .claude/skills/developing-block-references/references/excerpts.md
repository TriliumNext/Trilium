# Excerpts

An excerpt is an include-note embed that shows a range of blocks of a text note, and in an
editable host can edit them in place. The embed box itself (sizes, title row, caption, toolbar,
undo, saves) belongs to the `developing-content-embeds` skill; this file covers what the range adds.

```html
<figure class="include-note" data-note-id="pSH65l4YexoB" data-block="a1:b2" data-box-size="full">
</figure>
```

## In the editor (`content_embed.ts`)

| Step | Code |
|---|---|
| Schema | `block` in the `contentEmbed` attributes |
| Upcast | `data-block`, for embeds of a note (never of an attachment), when non-empty |
| Downcast | `getEmbeddedEntityAttributes()` writes `data-note-id` and `data-block`, in data and editing |
| Attribute change | `redrawEmbeddedEntity()` rewrites the entity attributes, then redraws |
| Redraw deduplication | The `shownContents` key is the JSON of the entity attributes, so it includes the range |
| Loading | `loadEmbeddedContent()` calls `editor.config.get("contentEmbed")?.loadNote?.(noteId, wrapper, boxSize, block, onBlockChange)`; `bindContentEmbedHandlers()` forwards it by name to `EditableText`'s `contentEmbedHandlers.loadNote` |
| Range change from the excerpt editor | `onBlockChange(block)` → `setEmbedBlock()` (below) |

The range is passed to `loadNote` explicitly, like the box size: at conversion time the new
`data-block` might not be in the DOM yet, and reading it back would load the old range.

**Link to excerpt.** `getEmbeddedNote(href)` accepts a note href whose only parameter is a valid
`block`, and `canConvertLinkToEmbed()` uses it, so _Convert link to note excerpt_
(`link_context_menu.convert_link_to_note_excerpt`) appears for block links:

| Href | Converts |
|---|---|
| `#root/a/b` | The whole note (_Convert link to an included note_) |
| `#root/a/b?block=x:y` | An excerpt of `x:y` |
| `#root/a/b?block=x&card=c` | No: another parameter |
| `#root/a/b?block=` or `?block=a:b:c` | No: malformed |
| `#root/a/b?viewMode=attachments&attachmentId=…` | An attachment embed |

**Excerpt to link.** `ConvertEmbedToLinkCommand` writes `#root/<noteId>?block=<encoded>`.

**New excerpts** start at `EXCERPT_BOX_SIZE` (`"full"`, commons `content_embeds.ts`) from every
path: link conversion (which also turns the title on), _Paste reference as an excerpt_
(`getExcerptHtml()`) and _Reset size_ (`getDefaultEmbedBox()`). A new way to create one must use it
too.

## Loading and rendering on the client

`loadEmbeddedNote(noteId, el, boxSize, { noteEditor, histories, block, onBlockChange, seenNoteIds,
isNested })` in `widgets/type_widgets/text/utils.ts`:

- The range comes from the editor plugin (editable host), from `prepareContentEmbeds()` in
  `embed_boxes.ts` (read-only views read `data-block`), or from the embed's dataset in
  `refreshEmbeddedNote()`.
- The view scope `{ block }` goes to the title link, `ContentEmbed`, `CompactContentEmbed` and
  `openContentEmbedMenu()`, so _Open in new tab_ and the menu open the note at the blocks.
  `NoteContext.setNote()` copies the scope, so the excerpt keeps its own.
- `getRenderedContent(note, { …, block, onBlockChange })` renders it. In an editable host
  (`noteEditor` set) a text note goes through `renderEditableText()`: `TextEmbed` with the range,
  and an editor only when `isEditableBlockRange()` finds an editable run in the content it read. A
  read-only host renders the static preview.

`renderTextContent()` sanitizes into a `.ck-content` element, calls `sliceToBlockReference()`, then
`postProcessRichContent()` on what remains, so math, diagrams, highlighting, labels and nested
embeds cost only the excerpt. The whole blob is still fetched. A missing end, or an empty note,
renders `<p class="block-reference-broken">Broken reference</p>`. Only text notes are sliced: an
excerpt of another note type renders the whole note.

**Nesting.** On screen a box renders its content with `embedBoxes: true`, so nested embeds become
Compact boxes, and only an embed already on the path (`seenNoteIds`) becomes a link. The static
path (print, export: `embedsAsReferenceLinks`) turns deeper embeds into reference links with
`replaceWithReferenceLink()`, whose href comes from `getNoteEmbedHref()` and keeps `?block=`.

**Cycles.** Keys are `getEmbedKey(noteId, block)`: the note id for a whole note, `noteId:block` for
a range. A note can embed blocks of itself; an excerpt whose slice contains that same excerpt stops
at the second level.

## The excerpt flag and the title row

`isExcerpt = !!block`, computed when the embed renders and never saved:

- `mountEmbedBox(el, box, { content, isExcerpt, hasCaption, isNested })` toggles the `excerpt` class
  on `.include-note-wrapper`. CKEditor does not rewrite a UIElement's attributes, so the class
  survives widget selection; on the `<figure>` it would not.
- `ContentEmbed` takes `isExcerpt`: `ExcerptBadge` in the title row, no fullscreen button or
  controls at any size, and `ExcerptEditButton` (`bx-pencil`, `block_reference.edit_excerpt`) in
  the fullscreen button's place.
- `CompactContentEmbed` takes no `isExcerpt`: a Compact excerpt has no badge and no pencil.
- `CKEditor` passes `isExcerpt` into the editor config, so a link inside the excerpt editor to a
  block of the same note that the excerpt does not hold reads its label from the saved note.
- The flag comes from `block` alone, not the note type.

`ExcerptEditButton` is **enabled** while the content registered tools with `hasEditableFlag`
(`TextEmbed`'s `canEdit`) and a text editor holds the embed (`findTextEditorAround()`), and
**active** while the figure has `data-editable="true"`. A click runs `selectEmbedAt()` and
`toggleContentEmbedEditable`, the path of the toolbar toggle, so the flag stays in the model and is
undoable. Turning it on expands an Expandable box and focuses the content through
`useFocusAfterRender()`: `focus()` on a box that is still hidden does nothing.

## The editable unit: `getEditableBlockRun(root, value)` (commons)

A range can be edited apart only as a **run of whole siblings**: the ids sit at the outer edges of
the run, so writing it back cannot drop or duplicate content around it.

1. Resolve both ends in document order.
2. Take the paths from `root` to each end; below their deepest common node, `first` and `last` are
   the children that hold the start and the end. When the start contains the end, the run is the
   start alone.
3. The start must be at the front of `first` at every level, the end at the back of `last`.
   Whitespace text and an empty `<label>` (the checkbox of a to-do item) are not content; any other
   element is, even an empty one.
4. Blocks that fill a whole `<li>` widen to the `<li>`, so the editor shows the bullet, number or
   checkbox and Enter adds an item.
5. The run's parent must be the root or one of `RUN_CONTAINERS`: `ASIDE`, `BLOCKQUOTE`, `DETAILS`,
   `DIV`, `LI`, `OL`, `SECTION`, `UL`. A run inside a `<p>` or a table row is not editable.

| Range | Run | Editable |
|---|---|---|
| One paragraph anywhere | The paragraph | Yes |
| Consecutive top-level blocks | Those blocks | Yes |
| Paragraphs inside one quote | Those paragraphs; the quote stays outside | Yes |
| Items 2 to 4 of a list | The three `<li>` | Yes, in a copy of the list |
| One to-do item | Its `<li>`, past the checkbox label | Yes |
| A paragraph to item 2 of a three-item list | None | No: item 3 is in the same list |
| A list item's second paragraph | That paragraph | Yes, without the list |
| A paragraph in a column | The paragraph, inside the column `<div>` | Yes |
| One code block or source embed | None: the id is on `<code>`, and `<pre>` is not a run container | No (content with the id on `<pre>` is) |

The client calls it on the content it rendered (`isEditableBlockRange()` in `content_renderer.ts`)
to decide whether the embed gets an editor; the server calls it on every read and write.
`node-html-parser` drops comments by default while the client's `DOMParser` keeps them, so a
comment at a container edge makes the client refuse a run the server would take. That is harmless,
since the client decides whether the toggle shows; a change that lets the server decide must
handle it.

## The server (`block_ranges.ts`, `routes/api/notes.ts`)

Core routes, so they run on the server, in desktop and in standalone.

| Route | Does |
|---|---|
| `GET /api/notes/:noteId/blocks?block=a:b` | `{ content }`: `getBlockRangeContent()`, the exact source text of the run, `content.slice(first.range[0], last.range[1])`. A run of list items comes as a shallow copy of the list, sliced so `<ol start>` is the first item's number |
| `PUT /api/notes/:noteId/blocks?block=a:b`, body `{ content, attachments? }` | `replaceBlockRangeContent()`, then `noteService.updateNoteData()` with the result, so revisions, links, attachments, sync and the WebSocket refresh work as for a full save; 204 |

Errors: 400 without `block`, without `content`, or for a note that is not a text note with
available content; 404 when the note or a block is missing or the range is not editable apart.

**Writing** (`replaceBlockRangeContent(content, block, fragment)`):

1. Find the run of `block` as the note **stores** it (the client sends its stored range, not the
   one the fragment now holds).
2. Remove from the fragment every block id that also exists outside the run: a block pasted into
   the excerpt from elsewhere in the note would bring a duplicate. The original keeps its id.
3. Splice:
   - Not a list run: the fragment replaces the characters of the run.
   - A list run, and the fragment is one list with the same tag and `class`: its items replace the
     run inside the original list. When its opening tag differs, it replaces the original's:
     style, `reversed` and `start` belong to the whole list, and `start` moves back by the items
     before the run (`getListItemNumber(editedList, -index)`), so the excerpt's items keep the
     numbers set in the excerpt. Tags are compared after `getOpenTag()` writes both first-item
     numbers, so an unchanged list keeps its bytes.
   - A list run, and the fragment is anything else (items became paragraphs, a bullet list became
     numbered, a to-do list became bullets): the list splits around the fragment, each side a copy
     that starts at the number its first item had; an empty side is left out. CKEditor merges
     adjacent lists of the same kind on the next load.
4. Return the new content, or `null` when the run is not found.

**Why strings.** `node-html-parser` drops comments when it serializes, and its `setAttribute()` /
`removeAttribute()` rewrite every attribute of the element and turn backslash sequences into control
characters. Splicing by `node.range` touches only the run. The fragment is re-serialized after the
duplicate check, which is safe because CKEditor produced it. `removeBlockIds()`, `getOpenTag()` and
the list numbering still call those two methods on the elements they change.

The routes do not check `#readOnly` or a read-only database; the client does
(`useEditableEmbed()`, `NoteSaves.canEdit()`, which also refuses the host note itself).

## The editor in range mode (`block_reference_editing.ts`)

`EditableText` calls `editor.plugins.get("BlockReferenceEditing").editRange()` in
`onEditorInitialized`, **before** `setData()`. The mode cannot be turned off; a range editor stays
one.

**`giveIdsToEdgeBlocks()`**, a post-fixer registered after `removeDuplicateBlockIds()`: the blocks
at an edge are the root's first child, its first child, and so on, while each can hold `blockId`;
the walk does not enter objects, so a table at the edge counts as one block. When no block at an
edge has an id, the outermost one gets a fresh one.

| Action in the editor | Range afterwards |
|---|---|
| Typing inside the blocks | Unchanged |
| Enter at the end of the last block | `a:<new>`: the new paragraph gets an id, `b` stays on its text |
| Enter at the start of the first block | `<new>:b`: the id stays with the text |
| Deleting the last block | `a:<id of the new last block>`, or a fresh id on it |
| Deleting everything | One empty paragraph with a fresh id |
| Undo of any of these | The previous range: the new id belongs to the same undo step |

Moving the old end id onto a new paragraph was rejected: a separate reference to that block would
then point at the new paragraph.

**`getRange(preferred?)`** returns `{ startId, endId }` from the edges, or `null` while an edge has
no id. An edge can have several (a quote with an id around a paragraph with one); the ids of
`preferred` win, otherwise the outermost. The client passes the excerpt's range, so the range does
not jump to the quote's id.

## The client side of editing

**`EditableText` in block mode** (the `block` prop):

- `getData()` returns `getBlockData(editor, block)`: `editor.getData({ trim: "none" })`, since the
  default trimming returns `""` for one empty paragraph and saving `""` would delete the blocks and
  their ids; and `block`, the formatted `getRange()`. The whole-note rule that saves an
  empty-looking document as `""` is skipped.
- Every data change runs `watchEditorBlocks()`, which reports a range that differs from the one it
  reported last. The reporter is created once, so its baseline is the opening range.

**`useEditorSpacedUpdate({ block })`** (`hooks/editor.ts`) loads with `loadBlocks()`
(`GET …/blocks`) through `useNoteBlob(…, { load })` and saves with `PUT …/blocks`. `noteSavedDataStore`, which holds
whole-note content for the note type switcher, is left alone.

- **`blockRef` is the range as the note stores it.** It is seeded once and replaced only by the
  `block` a successful save reported. Every read and save uses it, read at request time. It must
  not follow the `block` prop: `TextEmbed` feeds each reported range back as the prop at once, and
  a save to a range the note does not store yet would replace the wrong blocks.

  1. The excerpt shows `a:b`. Enter after `b`; the new paragraph gets `n`.
  2. The save sends `PUT …?block=a:b` with `a`…`n`; the note now holds `a`…`b`, `n`, and `blockRef`
     becomes `a:n`.
  3. The next save sends `?block=a:n`. With `a:b` again, `n` would be saved twice.

- A failed read resolves to `null`: the editor stays empty and saves nothing. A save for a note
  that was deleted or changed type is skipped. A hidden range editor loads content saved elsewhere
  only once it is shown.

**`TextEmbed` and `TextEmbedEditor`.** `TextEmbed` keeps the current range in state for its preview
and the next editor, and mounts `TextEmbedEditor` while Editable is on. `TextEmbedEditor` is the
editor of whole included notes too: it gives the editor a note context and a component of its own
for the target note (so references copied inside point at that note), wraps it in
`NestedEmbedContext` (embeds inside stay read-only, one level of editors), and on close saves what
is left and hands the untrimmed fragment to `TextEmbed`. Until the target note is read again, that
preview lacks the ancestors of the run, such as a quote around it.

**The range follows live.**

1. `watchEditorBlocks()` reports a new range; `TextEmbed` stores it and calls the host's
   `onBlockChange`.
2. The plugin's `setEmbedBlock()` does nothing once the host editor is destroyed or the embed has
   left the document. Otherwise it sets `block` in a non-undoable change, so Undo in the host does
   not revert it, and in the same change records in `shownContents` that the wrapper already shows
   the new range: the redraw rewrites `data-block` and leaves the open editor alone.
3. The host saves within about a second, including the save before a note switch or a tab close.

An earlier design updated the range when the editor closed. Leaving the host note while editing,
the most natural way to finish, then lost it: the host showed another note by the time the save
landed. `refreshEmbeddedNote()` (the script API's `refreshIncludedNote()`) passes no
`onBlockChange`, so an embed redrawn that way edits its blocks but keeps its old range.

**Crash recovery.** `reportEditorError()` offers Reload; `reloadEditor()` saves and bumps
`rebuildKey`, and the new editor's `onEditorInitialized` calls `editRange()` before `setData()`.

## Sequences

**Opening.** Editable on → `TextEmbed` mounts `TextEmbedEditor`, which waits for the last save of a
previous editor of the note → `editRange()` → `GET …/blocks` → the fragment loads; its edges already
have ids, so nothing is reported.

**Leaving the host while editing.** The host's save before the switch already holds the new range;
the editor unmounts and its cleanup saves the rest with `PUT …?block=<blockRef>`. Reopening the
host shows the new range.

**Another editor saves the target note.** The range editor's `useNoteBlob()` sees the change and
reads `GET …/blocks?block=<blockRef>` again; with unsaved changes of its own, its next save wins
within the range. Changes outside the range are never touched by range saves.

## Consistency

| Situation | Result |
|---|---|
| Two editors change the same blocks | The last save wins within the range |
| Another editor changes other parts of the note | Kept: the range save splices only the run |
| A full editor of the note has unsaved changes when a range save lands | Its next save overwrites the range save, as between two full editors |
| The host saves the new range before the target note is saved | Both follow within a second; if the target's save fails, the excerpt shows _Broken reference_ until it succeeds |
| Sync between instances | Whole notes, as always |
| Links to the old range elsewhere | Unchanged: only the edited excerpt follows the new edges |

## Edge cases

| Case | Behavior |
|---|---|
| The range is not a run of whole blocks | No Editable toggle; the preview works |
| The range breaks while its editor is open | Saves answer 404, the save badge shows the error, the note is unchanged |
| The range broke before the editor opened | The read fails; the editor stays empty and saves nothing |
| The excerpt shows blocks of the host note | Not editable, like any embed of the host note |
| Protected note without a session | The protected placeholder; the routes answer 400 |
| `#readOnly` note or read-only database | No toggle |
| An embed inside the excerpt editor | Read-only |
| A lone `<aside>` | Floats in the editor (the run is the raw source) but not in the preview (the slice drops `data-position`) |
