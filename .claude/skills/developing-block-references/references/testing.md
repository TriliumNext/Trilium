# Testing block references

## Where each layer is tested

| Layer | Spec | Covers |
|---|---|---|
| Format, lookups, slicing | `packages/commons/src/lib/block_reference.spec.ts` | Parameter parsing, formatting, encoding; id validity; `generateBlockId()`; resolution in document order, duplicates, missing ends; slicing across nesting, single-column layouts, a lone aside, list numbering; `getListItemNumber()`; editable runs (lists, to-do items, columns, refusals). Uses a hand-built `BlockNode` tree |
| Embed helpers | `packages/commons/src/lib/content_embeds.spec.ts` | `resolveContentEmbed()` with `block`, cycle keys, `getNoteEmbedHref()` |
| Editor plugin | `packages/ckeditor5/src/plugins/block_reference/block_reference.spec.ts` | Conversion of each block kind, inline ids dropped; `assignBlockReference` (ranges, list items, tables, layouts, read-only, undo); `assignBlockId()`; every post-fixer rule; `linkedBlockChanged`; the range editor; the handle menu triggers |
| Reveal and flash | `packages/ckeditor5/src/plugins/block_reference/block_reference_read_only.spec.ts` | Show, reveal (tabs, collapsed sections), scroll and `MIN_TOP_GAP`, broken ranges, `showAnchor()`, `getBlockRangeElements()` |
| Ids in other plugins | `ck/tabs/tabs.spec.ts`, `ck/content_embed/inline_source.spec.ts`, `ck/collapsible_headings/collapsible_headings.spec.ts`, `ck/internallink.spec.ts`, `ck/referencelink.spec.ts`, `ck/note_link_toolbar.spec.ts`, `ck/link_menu.spec.ts` (`ck` = `packages/ckeditor5/src/plugins`) | Tab ids, `<code>` and legacy `<pre>` placement, ids dropped on new headings, heading ids, pasted links and title redraws, _Jump_ |
| Excerpts in the editor | `packages/ckeditor5/src/plugins/content_embed/content_embed.spec.ts` | `data-block` storage, `onBlockChange` and `setEmbedBlock()` (no reload, no undo step, removed embed, destroyed editor), link to excerpt and back, reset to the excerpt size |
| Copy, paste, consume | `apps/client/src/services/block_reference.spec.ts` | Consume, highlight, copy (block, tab, public link), `buildReferenceConfig()`, the handle menu, clipboard parsing, the context menu rows, paste as link and as excerpt with their toasts |
| Labels | `apps/client/src/services/block_excerpts.spec.ts`, `link.spec.ts` | Excerpt rules, the cache, non-text and protected notes; labels for own and other notes, the excerpt fallback; in-place jumps |
| Rendering | `apps/client/src/services/content_renderer.spec.ts`, `content_renderer_text.spec.ts` | `TextEmbed` with or without an editor; slicing, broken references, self-embeds, the static nested path, the lazy load of `block_reference.ts`, ids on Mermaid drawings |
| Tooltips | `apps/client/src/services/note_tooltip.spec.ts` | Jump instead of quick edit, highlight and scroll |
| Reveal on navigation | `apps/client/src/widgets/type_widgets/text/ReadOnlyText.spec.tsx` | Reveal after render, a link to the open note, another note context, a hidden widget. The main spec of `useLinkTargetLanding()` and `useSameNoteSwitch()` (`Office.spec.tsx` and `Pdf.spec.tsx` cover the visibility path); `EditableText.spec.ts` mocks it |
| Editor host | `apps/client/src/widgets/type_widgets/text/EditableText.spec.ts`, `config.spec.ts`, `CKEditor.spec.tsx` | `revealLinkTargetWhenReady()`, `followLink()`, `getBlockData()`, `watchEditorBlocks()`; `referenceSource`; no handle on mobile; the `isExcerpt` getter |
| Excerpt box | `apps/client/src/widgets/type_widgets/text/TextEmbed.spec.tsx`, `ContentEmbed.spec.tsx`, `utils.spec.ts`, `embed_boxes.spec.ts` | Range to the editor and back to the host, preview after close; badge, pencil, focus; view scope, the `excerpt` class, `refreshEmbeddedNote()`; nested Compact boxes, seen keys |
| Block-mode saves | `apps/client/src/widgets/react/editor_save_race.spec.tsx` | Reads and saves through `/blocks`, the range following the saves, `noteSavedDataStore` untouched, nothing saved after a failed read |
| Menus | `apps/client/src/menus/note_context_menu.spec.ts`, `link_context_menu.spec.ts` | Reference rows, the pinned paste target; convert to excerpt |
| Server ranges | `packages/trilium-core/src/services/block_ranges.spec.ts`, `routes/api/notes.spec.ts` | Byte-exact reads, list copies, ids dropped, in-list replacement, whole-list properties, splits; the routes with 400 and 404 |
| Backlinks, import, export | `packages/trilium-core/src/services/notes.spec.ts`, `export/markdown.spec.ts`, `import/single.spec.ts` | `internalLink` from block links and Wikilinks; ids dropped on Markdown export; ids kept by safe import |
| Shared pages | `packages/trilium-core/src/share/content_renderer.spec.ts`; share-theme `src/index.spec.ts`, `content/in_page_links.spec.ts`, `content/mermaid.spec.ts`, `page/toc.spec.ts` | Slicing, broken references, self-embeds, `?block=` kept on links, heading labels, the placeholder keeping its id; the highlight on load, in-page jumps, ids on drawings, the copy-link address |

## Not covered by any spec

`EditableText` mounted with a real editor in block mode (its parts are tested alone); block links
in the zip, static and single HTML exports; the zip import round trip; Markdown export of
reference links and excerpts; the empty-slice path on shared pages; the static export's note
lookup; ids on asides and `<summary>` in the editor; tab and `<summary>` runs; captioned embeds in
slices; reversed lists cut at the end; the object case of `linkedBlockChanged`; Compact excerpts.
A change in one of these areas adds the spec.

## Running them

Run the narrowest set that covers the change:

```bash
pnpm --filter @triliumnext/commons test src/lib/block_reference src/lib/content_embeds
pnpm --filter @triliumnext/ckeditor5 test src/plugins/block_reference src/plugins/content_embed
pnpm --filter client test src/services/block src/services/link src/services/content_renderer src/widgets/type_widgets/text src/widgets/react/editor_save_race
pnpm --filter server test trilium-core/src/services/block_ranges trilium-core/src/routes/api/notes.spec trilium-core/src/share/content_renderer.spec trilium-core/src/services/notes.spec
pnpm --filter standalone test trilium-core/src/services/block_ranges trilium-core/src/routes/api/notes.spec trilium-core/src/share/content_renderer.spec trilium-core/src/services/notes.spec
pnpm --filter @triliumnext/share-theme test src/index src/content src/page/toc
```

Where `pnpm` cannot start a script, run `../../node_modules/.bin/vitest run <patterns>` from the
package's directory.

- **Core specs run twice**, under the server and the standalone runner, which use different SQLite
  and HTML environments (`writing-unit-tests` skill).
- **ckeditor5 specs run in a real Chromium** (`ckeditor5-testing` skill); point `CHROME_BIN` at a
  system browser where Playwright's cannot run. Model fixtures use `_setModelData()` with
  `blockId` attributes; the data view shows `data-trilium-block-id`.
- **Client specs run in happy-dom**: `t()` returns `undefined` unless `services/i18n` is mocked,
  and nested CSS is dropped (`writing-unit-tests` skill).
- **See each spec fail first.** Ids are easy to keep by accident (the post-fixer, the clipboard), so
  a spec that never ran red might pass for another reason.
