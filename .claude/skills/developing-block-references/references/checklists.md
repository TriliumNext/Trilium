# Checklists

Each list is what a kind of change must do so that ids, links and excerpts keep working. Work
through every item, and add a spec for each one the change touches ([testing.md](testing.md)).

## A new block, widget or container in the text editor

- [ ] **Can it hold an id?** It can when `schema.isBlock()` is true for it, when it inherits
      `$container`, or when it allows `BLOCK_ID` explicitly (as `tab` does; import the constant from
      `block_reference/block_reference_editing.js`). Decide whether users should reference it on
      its own.
- [ ] **Is it a pure layout object?** `getReferenceBlocks()` turns a block inside an object into
      the outermost object. A layout that should not swallow references to its content (like
      `multicolumnLayout`) joins the exemption there.
- [ ] **Upcast.** The generic converter sets the id on the model range your converter produced, so
      your converter must set `data.modelRange` (`safeInsert()` and `updateConversionResult()`)
      and must not consume `data-trilium-block-id`. When the id sits on another view element than
      the one you convert, read it yourself (`inline_source.ts` reads `<pre>`, then `<code>`).
- [ ] **Downcast.** The id lands on `mapper.toViewElement()` in both views. In the editing view it
      must be on the outer element of the block: copying and flashing look it up there, and copying
      silently does nothing when it is missing. To save it on another element, consume
      `attribute:blockId` in the data downcast, and keep reading the old place for content saved
      before.
- [ ] **Saved HTML.** Add its row to "Which element carries the id" in SKILL.md.
- [ ] **`display: contents`**: add a branch to `getBlockBoxes()` and to the flash and highlight
      rules in `packages/ckeditor5/src/theme/block_reference.css`.
- [ ] **Does it hide content** (collapsed, tabbed, paged)? Add a reveal to `reveal()` in
      `block_reference_read_only.ts` for the editor and for read-only content, without a model
      change in the editor (as `HiddenBlocks.revealAroundDomNode()` and
      `TabsEditing.showTabsAroundDomNode()` do). Read-only content must have run the structure's own
      setup first (`applyTabs()`, `applyCollapsedHeadings()` keep `WeakMap`s).
- [ ] **Does read-only rendering replace it** (a drawing, a box, a placeholder)? Copy the id onto
      the replacement: `content_renderer_text.ts` (Mermaid, unknown embed kinds), `embed_boxes.ts`
      (source embeds), core `share/content_renderer.ts` (`replaceWithUnavailable()`), share-theme
      `content/mermaid.ts`. Otherwise links to it land nowhere.
- [ ] **Slicing.** `sliceToBlockReference()` keeps the ancestors of the range with only the
      children inside it. A wrapper that looks wrong with one child left (a multicolumn layout)
      needs an unwrap step; a positioned element that should not float alone (an `<aside>`) loses
      its position. Check an excerpt of the block alone, of a block inside it, and of a range that
      starts inside it.
- [ ] **Editable runs.** `getEditableBlockRun()` accepts a run whose parent is in `RUN_CONTAINERS`.
      If a run of your element, or inside it, cannot stand alone in an editor (a tab without its
      tabs block, a `<summary>` without its `<details>`), the function must refuse it, or the range
      editor flattens it and the PUT writes the flattened HTML back.
- [ ] **Label.** `block_excerpts.ts` reads `textContent`; give the element a better name if that is
      empty or misleading (a tab uses its title).
- [ ] **Vim mode** reads every structure as lines; see the `developing-vim-mode` skill.
- [ ] **Specs**: conversion round trip with an id, the command on it (and inside it), the
      post-fixer on paste and Enter, the reveal, a slice, a label.

## A model change that replaces, splits, merges, converts or copies blocks

- [ ] **Replace in the same `model.change()`**, or carry the id over. A replacement made in two
      changes loses it (image to drawing and shape-changing link previews do today).
- [ ] **Copying attributes copies the id.** Strip `blockId` from a new element made from an old
      one's attributes, unless the new element takes the old one's place in the same change, when
      the post-fixer keeps one of them. Converting a run of blocks into one: the first keeps its id
      (`extended_code_block.ts`).
- [ ] **Merging** keeps the first block's attributes and drops the second's id. Decide whether the
      merged block should take it.
- [ ] **Undo**: a change that assigns an id is undoable unless it must not be (`assignBlockId()` is
      not, so a link already inserted keeps working).
- [ ] **Spec**: the id is where it should be after the change, and nowhere twice.

## A renderer or surface of text note content

Previews, tooltips, print, the static export, shared pages, revisions, a new view.

- [ ] **The sanitizer keeps `data-*`** (`sanitize_content.ts` hook on the client, `"*": ["data-*"]`
      in core `services/sanitizer.ts`). Sanitize before slicing.
- [ ] **Excerpts**: when the surface renders embeds, honor `block`: `sliceToBlockReference()` before
      any post-processing, the _Broken reference_ placeholder when it returns `false`, and
      `getEmbedKey()` for cycle detection.
- [ ] **Replacements keep ids** (see the widget checklist).
- [ ] **Labels**: reference links go through `loadReferenceLinkTitle()` with `hostNoteId`, so links
      to blocks of the same note show the block text.
- [ ] **Links to blocks** keep `?block=` where the surface can follow them.
- [ ] **Revealing**: a surface that can show a target uses `showBlockReference()` after the content
      and its asynchronous parts (diagrams, math) have rendered, or the target moves after the
      scroll.

## A reader or writer of note HTML on the server

Import, export, a transform, a migration, a route.

- [ ] **Change only the bytes you mean to.** Splice the stored string at `node.range` offsets; never
      `setAttribute()` / `removeAttribute()` on elements that are written back.
- [ ] **Keep `data-trilium-block-id`** on the element that carries it. Block ids are scoped to a
      note, so an import that remaps note ids leaves them alone.
- [ ] **Links**: decide whether the output can follow `?block=`. Share links keep it
      (`handleAttachmentLink()`); the zip and static exports rewrite hrefs to files and drop it
      today. A new link form that is not `#root/…` needs `findInternalLinks()` or
      `findMarkdownInternalLinks()` in core `services/notes.ts`, or it creates no backlink.
- [ ] **Markdown**: Turndown writes no attributes, so blocks that become Markdown syntax lose their
      ids; blocks kept as HTML keep them.
- [ ] **Core runs in standalone**: no Node built-ins; run core specs under both runners.

## A new way to create, copy or paste a reference

- [ ] Assign ids through `assignBlockReference` (undoable, a user action) or `assignBlockId()`
      (non-undoable, a side effect of inserting a link). Never `setAttribute()` a chosen id: the
      post-fixer does not fix a duplicate made that way.
- [ ] Never in a read-only editor; the command is disabled there.
- [ ] Save the note right after (`source.save()`), so the ids reach the server before the link is
      pasted elsewhere.
- [ ] Clipboard: `text/html` with an `a.reference-link` and `text/plain` with the href; the href
      from `calculateHash()`.
- [ ] Mobile has no block handle and no text context menu; say where the entry is unavailable.
- [ ] Strings in the client catalogue; the User Guide page.

## A new way to follow a link

- [ ] Parse with `parseNavigationStateFromUrl()`, and catch the `URIError` a malformed `%` escape
      throws.
- [ ] Keep the view scope: a path to `setNote()` without it drops the block.
- [ ] A same-note target goes through the in-place jump or `jumpInNote()`; a broken range goes to
      navigation so the toast shows.
- [ ] The consumer clears `viewScope.block`, or repeated clicks do nothing.
- [ ] The note panes of views leave block links to normal navigation (`useFollowLinksWithin()`).

## Changing excerpts or the `/blocks` routes

- [ ] Read [excerpts.md](excerpts.md) first.
- [ ] The client and the server must agree on `getEditableBlockRun()`: the client decides whether
      the toggle shows, the server refuses what it cannot write.
- [ ] `blockRef` moves only after a successful save; reads and saves use it.
- [ ] `editRange()` before `setData()`, including after a rebuild.
- [ ] New routes or parameters go into `apps/server/internal.openapi.yaml`.
