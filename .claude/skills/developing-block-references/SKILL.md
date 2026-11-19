---
name: developing-block-references
description: >-
  Use when changing, debugging or reviewing block references in text notes: the
  `data-trilium-block-id` ids, links to blocks (`?block=a`, `?block=a:b`), copying or pasting a
  reference (block handle menu, the Copy and Paste submenus, Copy public link, tab references),
  following one (in-place jumps, `consumeBlockReference()`, the reveal and flash of
  `block_reference_read_only.ts`), reference link labels and their excerpt cache, excerpts
  (include-note embeds with `data-block`) and editing them in place (`GET`/`PUT
  /api/notes/:noteId/blocks`, `getEditableBlockRun()`, the range editor), and what shared pages,
  exports, imports and backlinks do with them. Covers `packages/commons/src/lib/block_reference.ts`,
  `packages/ckeditor5/src/plugins/block_reference/`, `apps/client/src/services/block_reference.ts`
  and `block_excerpts.ts`, `packages/trilium-core/src/services/block_ranges.ts`. Also load it
  before adding or changing a block, widget, container or collapsing structure in the text editor,
  a model change that replaces, splits or copies blocks, a renderer of text note content, or an
  import or export path: each of these must keep ids and references working.
---

# Developing block references

A **block reference** points at one block of a text note (a paragraph, a heading, a list item, a
table, a code block, an embed, a tab) or at a range of consecutive blocks. The block carries an id
in the saved HTML; a link adds `?block=<id>` or `?block=<startId>:<endId>` to the note path; an
**excerpt** is an include-note embed that shows only those blocks, and can edit them in place.

The id is the whole contract. Every surface that renders, transforms, copies, imports or exports
text note HTML either keeps the id on the right element or breaks every reference to that block,
silently, in other notes. Most work on the text editor therefore touches this feature even when it
is about something else; the checklists in [references/checklists.md](references/checklists.md)
list what each kind of change must do.

| Topic | Where |
|---|---|
| Excerpts and editing them in place | [references/excerpts.md](references/excerpts.md) |
| Checklists for each kind of change | [references/checklists.md](references/checklists.md) |
| Every reader and writer of ids and `?block=` | [references/readers-and-writers.md](references/readers-and-writers.md) |
| Known gaps: current behavior that is a defect or a limitation | [references/known-gaps.md](references/known-gaps.md) |
| Specs and how to run them | [references/testing.md](references/testing.md) |

Related skills: `adding-link-targets` (headings of other notes in the link dialog and the `@` list,
the reference routes, landing on a link parameter), `developing-content-embeds` (the embed box
that excerpts live in), `ckeditor5-plugin-development` (`references/widgets.md` for a new widget),
`developing-share-pages` (the shared page that highlights `?block=`), `developing-vim-mode` (Vim
yanks and joins blocks).

## Decided behavior

These were chosen by the maintainer. Do not re-propose them; change them only on request.

- **Ids live in `data-trilium-block-id`, never in `id`.** Note content renders in the same document
  as the app, and imported HTML, ETAPI, scripts and sync all write content, so an `id` in a note
  could take over an id the UI looks up. A data attribute has no document-wide meaning, survives
  both sanitizers without a change, may repeat when a note shows twice, and stays apart from
  bookmark anchors (`<a id>`, `?bookmark=`).
- **Any non-empty string without `:` is a valid id**, so ids written by scripts or other tools
  work. Generated ids are 12 characters of `[A-Za-z0-9]`.
- **Links keep the colon readable**: `?block=a:b`, through `encodeBlockParameter()`.
- **A range is stored as its two ends only.** Blocks inserted between them join the range; an end
  moved before the start is read in document order.
- **Ids never move between blocks.** A block that other references point at keeps its identity;
  new ids are minted instead (the range editor's edge blocks, a heading given a reference).
- **Read-only notes get no ids from the editor.** The one exception is the server route that gives
  a heading of another note an id for the link dialog (`adding-link-targets` skill).
- **A broken reference says so**: a link shows a toast but still reveals the end that remains; an
  excerpt shows _Broken reference_; a label reads _Broken reference_ on screen.
- **A reference link's label is an excerpt of the block text.** A link to blocks of the note it is
  in shows only that text, without the note title or icon.
- **Links with any query create `internalLink` backlinks**, block links included.
- **New excerpts start at the _Full_ box size** (`EXCERPT_BOX_SIZE`). Whole-note embeds keep their
  own default.
- **The excerpt flag is computed, never saved.** Excerpts have no fullscreen; a pencil toggles
  editing in its place.
- **Editing an excerpt saves only its blocks, and the last writer wins** within the range, without
  a 409, as for whole-note saves.
- **The embed's range follows the edges live while editing**, not when the editor closes: leaving
  the host note while editing must not lose the new range.
- **List properties changed in an excerpt apply to the whole list**, with `start` shifted so the
  excerpt's items keep their numbers. The list is not split.
- **Reveal scrolling keeps the start of the range in view**: never `scrollIntoView({ block:
  "center" })`; at least 15% of the viewport stays above the range (`MIN_TOP_GAP`).
- **Shared pages highlight `?block=` with a module of their own**, independent of the share theme.
- **_Copy public link_ is in the block handle menu only**, for notes that are shared.

## The pieces

| File | Role |
|---|---|
| `packages/commons/src/lib/block_reference.ts` | `BLOCK_ID_ATTRIBUTE`, `generateBlockId()`, `drawBlockId()`, `isValidBlockId()`, `parseBlockRange()`, `formatBlockRange()`, `encodeBlockParameter()`, `resolveBlockRange()`, `resolveBlockReference()`, `sliceToBlockReference()`, `getListItemNumber()`, `getEditableBlockRun()`; written against `BlockNode` so one implementation serves the DOM and `node-html-parser` |
| `packages/commons/src/lib/content_embeds.ts` | `EXCERPT_BOX_SIZE`, `getEmbedKey()`, `resolveContentEmbed()`, `getNestedEmbedOptions()`, `getNoteEmbedHref()` |
| `packages/ckeditor5/src/plugins/block_reference/block_reference_editing.ts` | Schema, conversion, `removeDuplicateBlockIds()` post-fixer, `assignBlockReference` command, `assignBlockId()`, `getReferenceBlocks()`, range editor mode (`editRange()`, `giveIdsToEdgeBlocks()`, `getRange()`), `linkedBlockChanged` |
| `packages/ckeditor5/src/plugins/block_reference/block_reference.ts` | The block handle: opens the host's menu; the `blockReference` editor config type |
| `packages/ckeditor5/src/plugins/block_reference/block_reference_read_only.ts` | `showBlockReference()`, `showAnchor()`, reveal, scroll, flash, `getBlockRangeElements()`; shared by the app and shared pages |
| `packages/ckeditor5/src/theme/block_reference.css` | Flash, highlight and the tab rules of both |
| `packages/ckeditor5/src/plugins/content_embed/content_embed.ts` | The `block` attribute of an embed, link to excerpt and back, `setEmbedBlock()` |
| `packages/ckeditor5/src/plugins/referencelink.ts` | Pasted reference links, title redraws of same-note block links |
| `packages/ckeditor5/src/plugins/note_link_toolbar.ts` | _Jump_ inside the note, resolved in the model |
| `apps/client/src/services/block_reference.ts` | `buildReferenceConfig()`, the block handle menu, copy (block, tab, public link), `consumeBlockReference()`, tooltip highlights, the context menu rows, paste as link or excerpt |
| `apps/client/src/services/block_reference.css` | The broken-reference style |
| `apps/client/src/services/block_excerpts.ts` | Excerpt labels and their per-note cache |
| `apps/client/src/services/link.ts` | `loadReferenceLinkTitle()`, `getReferenceLinkTitleSync()`, in-place jumps (`showBlocksInPlace()`, `getBlockJump()`) |
| `apps/client/src/services/navigation_state.ts` | `ViewScope.block`, `VIEW_SCOPE_PARAMS`, `calculateHash()` |
| `apps/client/src/widgets/type_widgets/text/EditableText.tsx`, `ReadOnlyText.tsx` | Reveal on navigation; `EditableText` also edits a range |
| `apps/client/src/widgets/type_widgets/text/TextEmbed.tsx`, `TextEmbedEditor.tsx`, `ContentEmbed.tsx`, `utils.ts`, `embed_boxes.ts` | Excerpts: loading, the flag, the badge and pencil, the in-place editor |
| `apps/client/src/services/content_renderer.ts`, `content_renderer_text.ts` | Rendering only the referenced blocks |
| `apps/client/src/widgets/react/hooks/editor.ts`, `hooks/note.ts` | Block mode of `useEditorSpacedUpdate()` and `useNoteBlob()` |
| `packages/trilium-core/src/services/block_ranges.ts`, `routes/api/notes.ts` | `GET`/`PUT /api/notes/:noteId/blocks` |
| `packages/trilium-core/src/share/content_renderer.ts` | Excerpts and `?block=` links on shared pages and in the static export |
| `packages/share-theme/src/index.ts`, `content/in_page_links.ts`, `content/mermaid.ts` | The shared page's highlight, in-page jumps, the id on a drawn diagram |
| `docs/User Guide/User Guide/Note Types/Text/Block references.md` | The user-facing page |

## Storage

```html
<p data-trilium-block-id="eaJkN47U8kI4">A paragraph</p>
<figure class="include-note" data-note-id="pSH65l4YexoB" data-block="eaJkN47U8kI4:2ZrHG8GH3TGW"
        data-box-size="full"></figure>
```

Ids are scoped to a note: the same id can exist in two notes, and copying a block into another
note keeps its id. Within a note, the **first** element with an id is the one every lookup finds.

**Which element carries the id.** It sits on the view element the model block maps to:

| Content | Saved HTML |
|---|---|
| Paragraph, heading, block quote, collapsible, aside | On the element itself |
| Code block | `<pre><code data-trilium-block-id>` |
| Source embed (Mermaid, extended code block) | `<pre><code data-trilium-block-id>`; content saved before that has it on `<pre>`, and every reader checks `<pre>` first, then `<code>` |
| Table | `<figure class="table" data-trilium-block-id>` |
| List item | `<li><p data-trilium-block-id>`: any non-list attribute turns the item's bogus paragraph into a real `<p>`; unreferenced items keep `<li>text</li>` |
| Tab | `<section class="trilium-tab" data-trilium-block-id>` |
| Collapsible title | `<summary>`, which is a block of its own |
| Captioned embed whose element is not a `<figure>` (media `<section>`, source `<pre>`) | On the inner element, inside `<figure class="captioned-content-embed">`; the `<figcaption>` is its sibling |

**Ids in code.** Never put an id into a CSS selector or into HTML without escaping: an id can hold
any character but `:`. Look elements up by attribute presence and compare
`getAttribute(BLOCK_ID_ATTRIBUTE) === id`. Build hrefs with `encodeBlockParameter()`. In code the
browser loads, import values from `@triliumnext/commons/src/lib/block_reference.js` and only types
from the `@triliumnext/commons` index.

**Ids from `generateBlockId()`** use `crypto.getRandomValues()`, which works over plain HTTP, in
Node and in standalone's worker; `crypto.randomUUID()` does not.

## Link format and the commons helpers

```
#root/sVfN0uu8MEs2/pSH65l4YexoB?block=eaJkN47U8kI4
#root/sVfN0uu8MEs2/pSH65l4YexoB?block=eaJkN47U8kI4:2ZrHG8GH3TGW
https://example.com/share/abc?block=eaJkN47U8kI4         (public link: a query, not a hash)
[[pSH65l4YexoB?block=eaJkN47U8kI4]]                      (Markdown Wikilink)
```

- `parseBlockRange()` accepts one or two non-empty parts; `""`, `a:`, `:b`, `a:b:c` give `null`
  and count as broken everywhere. `formatBlockRange()` writes one id when both ends are equal.
- `calculateHash()` writes `block` with `encodeBlockParameter()`, so the parameter survives tab
  state, popups and detached windows until a widget consumes it.
- The `/blocks` API calls encode with `encodeURIComponent()`; both decode the same.
- `resolveBlockRange(root, range)` walks `root` in document order and returns `{ start, end }` in
  document order: `b:a` behaves as `a:b`. A missing end is `null`; the first occurrence of a
  duplicate id wins.
- `sliceToBlockReference(root, value)` keeps only what lies between the two ends, like
  `Range.cloneContents()`: the ancestors stay, holding only the children inside the range (a quoted
  paragraph keeps its quote, a list item its list). It returns `false` and changes nothing when an
  end is missing, so callers show _Broken reference_, never a partial slice. Extra steps:
  - `keepListNumbering()` sets `<ol start>` to the first kept item's number
    (`getListItemNumber()`, which counts down in a `reversed` list).
  - A multicolumn layout left with one column is replaced by that column's content
    (`unwrapSingleColumnLayout()`, counting element children: it assumes saved HTML, where a
    layout holds only columns).
  - An `<aside>` that is the only block left loses `data-position`, so it does not float.
- `getEditableBlockRun()` decides whether a range can be edited apart: see
  [references/excerpts.md](references/excerpts.md).

## Creating a reference: the editor plugin

`BlockReference` requires `BlockReferenceEditing` and is in `TRILIUM_PLUGINS`, so every text note
editor has it, including the nested editor of a text embed. The attribute, chat and memo editors do
not: code outside the plugin looks it up with `editor.plugins.has()`.

### Schema and conversion

- **Who can hold `blockId`**: an attribute check allows it on every element for which
  `schema.isBlock()` is true, so elements registered later are covered; `$container` is extended
  for block quotes, collapsibles and asides; `tab` allows it explicitly. The check returns
  `undefined`, not `false`, for other elements, which would veto the containers.
- **Upcast**: a generic low-priority `attributeToAttribute` on `element`. It sets the id on every
  top-level item of the model range the element's own converter produced, and only if that
  converter did not consume the attribute. Invalid ids and ids on inline content are dropped.
- **Downcast**: to `mapper.toViewElement()`, in the editing view as well as the data. The client
  finds blocks in the editing DOM to flash them, so the id must be on the **outer** editing element
  of the block. Source embeds consume `attribute:blockId` in their data downcast and write it on
  `<code>`.
- **The clipboard keeps ids**: drag and drop and cut and paste must keep them. Copies are handled
  by the post-fixer.
- `DropDisallowedAttributes` strips `blockId` from an element inserted or renamed where the schema
  does not allow it.

### Unique ids: `removeDuplicateBlockIds()`

A post-fixer that keeps ids unique without minting any. It looks only at inserted elements that
have an id, so typing never costs more than reading the differ.

| Situation | Result |
|---|---|
| No other element has the id | Kept |
| An older element has it and is now empty, and the inserted one is not | The id moves to the inserted element |
| An older element has it otherwise | The inserted element loses it |
| An earlier inserted element in the same change has it | The later one loses it |

So: a copy pasted in the same note loses the id; a drag keeps it (the source is removed in the
same change); cut and paste keeps it; Enter in the middle or at the end leaves it on the first
part; Enter at the start moves it with the text; loaded duplicates keep the first. A childless
object (an embed without a caption) counts as empty, so it hands its id to a non-empty copy.

### The command and its relatives

| API | Does | Undo |
|---|---|---|
| `assignBlockReference` command | Gives the first and the last block of `getReferenceBlocks()` an id if they have none; returns `{ startId, endId, count }`; `value` is the count | One undo step: Undo right after a copy removes the id behind the copied link |
| `assignBlockId()` | Gives one model element an id (headings in the link dialog and the `@` list) | Not undoable (`enqueueChange({ isUndoable: false })`) |
| `assignTabReference` command | Gives one tab an id | One undo step |
| `editRange()` | Turns on range editor mode for an excerpt editor | See [references/excerpts.md](references/excerpts.md) |

`getReferenceBlocks()` builds the referenceable blocks from the selection: a block inside an
object becomes the **outermost** object around it (a paragraph in a table cell becomes the table,
in an aside the aside, in a tab panel the whole tabs block), except that `multicolumnLayout` is
exempt, so a paragraph in a column stays the paragraph. Duplicates are removed; a target that
cannot hold the attribute is skipped. The command is disabled in read-only mode.

### `linkedBlockChanged`

`BlockReferenceEditing` fires `linkedBlockChanged` 300 ms after the data changes
(`LINKED_BLOCK_DELAY`) with the ids of the changed blocks and their ancestors, or `null` when a
non-object container was inserted or removed. `ReferenceLink` redraws the titles of links to blocks
of the same note (DOM only: no model change, no save), so their labels follow edits. Formatting
changes are ignored; removing an object reports only its own id.

### The host: `blockReference` editor config

The plugin calls the client through the editor config, not through a component lookup:

```ts
blockReference: {
    openHandleMenu(origin, blocks, onClose): void;   // blocks = getDraggedBlocks(editor)
    copyReference(): void;
}
```

`buildReferenceConfig(source)` in the client's `services/block_reference.ts` builds it from the
`referenceSource` that `CKEditor.tsx` passes. The source reads the note and its path from refs on
every call, because switching notes reuses the editor; never capture them when the editor is
built. An editor without the config has no handle menu and no copy rows.

### Where a reference is created

| Entry | Path |
|---|---|
| Block handle: left click on the `BlockDragHandle` button (unless it opens its Insert menu in an empty paragraph), or right click on it or on the `BlockToolbar` button | `openBlockHandleMenu()`: the full block menu (header with the block type or a count, insert items, Collapse, Cut, Copy, _Copy reference_, _Copy public link_, AI, Sort, Delete) |
| Text context menu, _Copy_ submenu | _Copy reference to this block_ / _these N blocks_ (`block_reference.copy` with `count`, the command's `value`), _Copy link to this tab_ |
| Tabs block ⋮ menu | _Copy reference to this tab_ (`copyTabReference()`) |
| Link dialog, `@` list | Heading targets (`adding-link-targets` skill) |

The handle menu's header counts `getDraggedBlocks()`, widened over containers and collapsed
sections; _Copy reference_ uses `getReferenceBlocks()` on the selection. For a collapsed heading
the header names the section, the reference points at the heading.

**Copying** (`copyBlockReference()`): run the command, resolve both ids in the editing DOM, flash
them, build the href with `calculateHash()`, copy `text/html` (a reference link labeled from the
editing DOM, since the ids are not saved yet) and `text/plain` (the bare href, for code and
Markdown notes), then `source.save()` so the ids reach the server before the link is pasted
elsewhere. If an id is not in the editing DOM, nothing is copied and nothing is said. The flash
(`flashBlockRange()`) and the link (`copyReferenceLink()`) are shared with
`copyMarkdownReference()` in `markdown/editor_block_references.ts`, which flashes the preview of a Markdown
note and labels the link from its parsed blocks.

**Copy public link** (`copyBlockShareLink()`): `getNoteShareLink()` is read when the menu opens; it
is `null` for a note that is not shared and in the `export-only` scope. It copies plain text
`<share URL>?block=…`. With a sync server, the link points there, and the shared page finds the
block only after the next sync.

**Pasting.** <kbd>Ctrl</kbd>+<kbd>V</kbd> needs no code: `ReferenceLinkEditing` upcasts
`a.reference-link` with its href and the stored title. The _Paste_ submenu adds _Paste reference as
a link_ and _Paste reference as an excerpt_ (`pasteBlockReference()`):

1. `editor.capturePasteTarget()` pins the target before the clipboard read, which can prompt.
2. `pasteClipboardReference()` reads the clipboard with `getClipboardBlockReference()`: the first
   block link in `text/html`, else `text/plain`. A full URL counts when it has the `/#root` form,
   whatever its host.
3. `froca.getNote()` must find the note, so a reference from another instance pastes nothing.
4. The link, or an excerpt at `EXCERPT_BOX_SIZE`, goes through `target.paste()`: the clipboard
   pipeline, so a selection is replaced and the paste is one undo step.

The Markdown editor's _Paste_ rows (`markdown/block_reference_menu.ts`) go through the same
`pasteClipboardReference()` and insert a Wikilink or an excerpt block into the source.

## Following a link

| Path | When | Code |
|---|---|---|
| In-place jump | A click on a link to blocks of the note it is in, when the link's innermost `.ck-content` is inside a split (`[data-ntx-id]`) showing that note and both ends resolve | `showBlocksInPlace()`, `getBlockJump()` in `link.ts`; no `setNote()`, no history entry, no `viewScope.block` |
| Navigation | Every other click, a URL, a restored tab, and broken ranges (so the toast shows) | `viewScope.block` → `NoteContext.setNote()` → the type widget calls `consumeBlockReference()` |
| _Jump_ in the link toolbar, the tooltip's _Jump to block_ | Inside the note being shown | `jumpInNote()` resolves in the **model**, which skips embeds |
| Tooltip | Hovering a block link (desktop only) | `highlightBlockReference()`, kept until the tooltip closes |
| Shared page | `?block=` in the page URL; same-page links | `showLinkedBlocks()` (waits for the Mermaid drawings), `content/in_page_links.ts` (a fragment wins over `block`) |

**Consuming on navigation** follows the rules of the `adding-link-targets` skill, "Landing on the
target": wait for the content (`revealLinkTargetWhenReady()` in `EditableText`, the blob of
`ReadOnlyText`), land through `useLinkTargetLanding()`, which also handles a link to the open note
and leaves a hidden widget out, and check that the widget shows that note. Clear `viewScope.block` once used: `setNote()` returns early
when the path and the view scope are unchanged, so a consumer that leaves `block` set makes the
next click on the same link do nothing.

**The reveal** (`showBlockReference()`, shared with shared pages):

1. Resolve the range in the container. The end that remains of a broken range is still revealed
   and flashed; in the app, `consumeBlockReference()` also shows the toast
   `block_reference.not_found`. Shared pages show nothing for a broken range.
2. Reveal the last end, then the first, so the first stays shown when they sit in different tabs.
   Revealing opens collapsed `<details>` (in the editor the collapsible plugin writes that back to
   the model without an undo step), selects the tab (`revealTab()`) and expands collapsed headings
   (`revealCollapsedHeadings()`; in the editor `HiddenBlocks.revealAroundDomNode()`).
3. Scroll the nearest overflowing ancestor (else the document) so the whole range is centered with
   at least 15% of the viewport above it (`MIN_TOP_GAP`). `getBlockBoxes()` measures a tab, which
   is `display: contents`, from its title to its panel.
4. Flash the outermost elements of the range (`getBlockRangeElements()`) with the
   `block-reference-flash` class, removed by a timer (`FLASH_DURATION_MS`), not by `animationend`,
   which bubbles from descendants and never fires on hidden elements. The flash is a box shadow, so
   the block's own background is untouched.

`block_reference_read_only.ts` must import no values from CKEditor: shared pages and read-only
views load it lazily (`loadBlockJump()` in `link.ts`).

**DOM lookups take the first match in document order**, which can be inside a rendered embed when
ids were copied between notes. That is why the link toolbar resolves in the model.

## Labels

| Function | Output |
|---|---|
| `loadReferenceLinkTitle($el, href, hostNoteId?, storedTitle?, content?, isExcerpt)` | On screen: the note title and a `<small>` with `¶` and the excerpt; _Broken reference_ with `block-reference-broken` |
| `getReferenceLinkTitleSync(href, storedTitle?, content?, isExcerpt)` | The text saved inside the `<a>`: `Title - excerpt` once cached and not broken, else the title |

- **A link to blocks of the same note** (`hostNoteId`, or `content` given) shows the block text
  alone, with a `bx-paragraph` icon unless the block is a heading; that text is also what is saved.
  In an excerpt editor (`isExcerpt`), a block outside the excerpt is read from the saved note.
- **The excerpt** (`block_excerpts.ts`): one block up to 60 characters; a range, both ends up to 30
  each, joined with ` … `; a heading in full; a tab by its title; block links inside the block left
  out; a block without text reads _Block_ (`block_reference.untitled`).
- **The cache** keeps 20 notes, keyed by note id and valid while `blobId` matches, with one shared
  request per note. Non-text and protected notes get no excerpt. `link.ts` imports
  `block_excerpts.ts`, never `block_reference.ts` (a cycle).
- **Updates**: same-note links in an editor follow edits (`linkedBlockChanged`); every other label
  is computed when the link renders.
- **Elsewhere**: Markdown Wikilink chips call `loadBlockReferenceLabel()`; shared pages label a
  same-note heading link with the heading text (`getLinkedHeadingText()`) and other links with the
  note title.

## Excerpts

An excerpt is a `contentEmbed` whose `block` attribute (`data-block`) holds a range. In short:

- _Convert link to note excerpt_ on a block link, _Paste reference as an excerpt_ and _Reset size_
  all use `EXCERPT_BOX_SIZE`. _Convert to link_ goes back to `#root/<noteId>?block=…`.
- The renderer sanitizes, slices, then post-processes only what remains; a missing end renders
  `<p class="block-reference-broken">`. Only text notes are sliced.
- `isExcerpt` comes from `block` at render time and is never saved: the badge, no fullscreen, and
  the pencil that toggles the `editable` flag.
- Cycle detection keys an excerpt as `noteId:block` (`getEmbedKey()`), so a note can embed blocks
  of itself.
- Editing in place reads and writes only the run of blocks through `/api/notes/:noteId/blocks`,
  and the embed's range follows the edges live.

Read [references/excerpts.md](references/excerpts.md) before changing any of it.

## Traps

- **Replacing a block element in two changes loses its id**: the old element is gone before the
  new one is inserted. Replace it in the same `model.change()`, or carry the id over.
- **Copying attributes copies the id.** A new element made from an old one's attributes must strip
  `blockId` (`collapsible_headings_editing.ts` does), or the post-fixer decides who keeps it.
- **Merging blocks loses the second block's id**: <kbd>Backspace</kbd> at the start of a block and
  Vim's `J` keep the first block's attributes. References to the second block break.
- **The handle and Undo**: the command is an undo step, so Undo after a copy breaks the copied link.
- **A new `display: contents` block** needs a branch in `getBlockBoxes()` and in the flash CSS.
- **A new collapsing or hiding structure** needs a branch in the reveal, or links into it land on
  a hidden block. Collapsed list items are not expanded today.
- **`FLASH_DURATION_MS` must match the animation** in `theme/block_reference.css`.
- **The client's `block_reference.ts` stays off the startup path.** `note_tooltip.ts` and
  `content_renderer_text.ts` import it dynamically; `pnpm dev:check-startup` catches an eager
  import (`measure-startup-requests` skill).
- **`node-html-parser`'s `setAttribute()` and `removeAttribute()` rewrite every attribute of the
  element** and turn backslash sequences into control characters. Server code that writes note
  content splices the stored string at `node.range` offsets instead.
- **Slicing and runs assume saved HTML.** In the editing view a layout holds handle elements next
  to its columns.
- **Sanitize before slicing**: the client keeps `data-*` through a DOMPurify hook
  (`sanitize_content.ts`); a sanitizer that drops it breaks every excerpt.
- **Every `[data-ntx-id]` element must name a tracked note context**: the in-place jump calls
  `getNoteContextById()`, which throws for an unknown id.

Before reporting something as a bug, or designing around it, check
[references/known-gaps.md](references/known-gaps.md).

## Testing

The spec map, the commands and the cross-runtime rules are in
[references/testing.md](references/testing.md). In short: commons specs run in
`packages/commons`; the plugin specs run in a real Chromium (`ckeditor5-testing` skill); core specs
need both the server and the standalone runner; client specs run in happy-dom.

## Documentation

- The User Guide page is `docs/User Guide/User Guide/Note Types/Text/Block references.md`, and the
  excerpt box is described in the Include Note page. Any change to what the user sees updates them
  in the same change (`writing-documentation` skill), with a changelog entry.
- Strings live in the client catalogue under `block_reference.*`, `block_handle_menu.*`,
  `note_tooltip.jump-to-*` and `link_context_menu.convert_link_to_note_excerpt`; the editor's own
  under `text-editor.ck`; the server's under `content_renderer.*`.
- `/api/notes/:noteId/blocks` is documented in `apps/server/internal.openapi.yaml`, which generates
  the API Reference page of the User Guide. A change to the routes updates it, then `docs.mjs sync`.
