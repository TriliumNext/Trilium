# Readers and writers of block ids and `?block=` links

Every place outside the core of the feature that reads or writes `data-trilium-block-id`, the
`blockId` model attribute, `data-block` or a `?block=` link. A change to the format, or a new place
like these, checks this list. Grep `BLOCK_ID_ATTRIBUTE`, `blockId`, `data-trilium-block-id` and
`?block=` to find newcomers.

## Commons (`packages/commons/src/lib/`)

| Place | Does |
|---|---|
| `block_reference.ts` | The format, lookups, slicing, list numbers, editable runs, `generateBlockId()`, `drawBlockId()` |
| `content_embeds.ts` | `EXCERPT_BOX_SIZE`; `getEmbedKey()` (cycle keys); `resolveContentEmbed()` reads `data-block` (an empty value means the whole note); `getNestedEmbedOptions()`; `getNoteEmbedHref()` builds `?block=` |

## Text editor (`packages/ckeditor5/src/plugins/`)

| Place | Does |
|---|---|
| `block_reference/` | The feature itself |
| `content_embed/content_embed.ts` | `block` ↔ `data-block`; `getEmbeddedNote()`; link to excerpt and back; `setEmbedBlock()`; `getDefaultEmbedBox()` gives excerpts `EXCERPT_BOX_SIZE` |
| `content_embed/inline_source.ts` | Source embeds: reads the id from `<pre>`, then `<code>`; writes it on `<code>`; allows list attributes, so a referenced source embed can sit in a list |
| `content_embed/extended_code_block.ts` | Converting blocks into one keeps the first block's id |
| `collapsible_headings/collapsible_headings_editing.ts` | A blank heading made after a collapsed section drops the copied id |
| `tabs/tabs_editing.ts`, `tabs_commands.ts`, `tabs_ui.ts` | `tab` allows the id; `AssignTabReferenceCommand`; the ⋮ _Copy reference to this tab_ |
| `internallink.ts` | `getHeadings()` returns each heading's `blockId` (the link dialog) |
| `referencelink.ts` | Pasted reference links keep href and stored title; same-note block links redraw their titles on `linkedBlockChanged` (looked up with `plugins.has()`) |
| `note_link_toolbar.ts` | _Jump_ resolves the range in the model, then shows it |
| `drop_disallowed_attributes.ts` | Strips `blockId` where the schema refuses it |
| `vim/vim_registers.ts`, `vim/vim_editing.ts` | Yanks clone elements with their ids (the post-fixer then decides); `J` merges and drops the second id |
| `multicolumn/constants.ts` | Re-exports the layout classes that slicing reads |
| `index.ts` | Exports `assignBlockId` and `BlockReferenceHost`; imports the plugin for its augmentations |

## Client (`apps/client/src/`)

| Place | Does |
|---|---|
| `services/block_reference.ts` | Handle menu, copy (block, tab, public link), flash, consume, tooltip highlight, context menu rows, paste |
| `services/block_excerpts.ts` | Labels; looks ids up by attribute presence, compares with `===` |
| `services/link.ts` | Labels of reference links; in-place jumps |
| `services/navigation_state.ts` | `block` in `ViewScope`, `VIEW_SCOPE_PARAMS` and `calculateHash()` |
| `services/link_targets.ts` | Heading targets: `blockId`, `assignBlockId()` on `createLinkPath()`, `POST …/references` |
| `services/content_renderer.ts`, `content_renderer_text.ts` | Slicing, `isEditableBlockRange()`, highlight in previews (`highlightBlock`), ids copied onto Mermaid drawings and unknown-kind boxes |
| `services/note_tooltip.ts` | Highlight and _Jump to block_ in tooltips |
| `services/sanitize_content.ts` | The DOMPurify hook that keeps `data-*` |
| `widgets/type_widgets/text/CKEditor.tsx`, `config.ts` | `referenceSource`, the `blockReference` config, `isExcerpt` in the config, `assignBlockId()` |
| `widgets/type_widgets/text/EditableText.tsx`, `ReadOnlyText.tsx` | Consume on navigation; range editor mode |
| `widgets/type_widgets/text/embed_boxes.ts`, `utils.ts`, `TextEmbed.tsx`, `TextEmbedEditor.tsx`, `ContentEmbed.tsx` | Excerpts; ids copied onto source-embed boxes |
| `widgets/type_widgets/markdown/editor_utils.ts` | Wikilink chips label `?block=` |
| `widgets/react/hooks/editor.ts` | `/blocks` reads and saves |
| `widgets/EmbeddedNotePane.tsx` | Leaves block links to normal navigation |
| `menus/link_context_menu.ts`, `menus/note_context_menu.ts` | Convert to excerpt; the Copy and Paste rows |

## Core (`packages/trilium-core/src/`)

| Place | Does |
|---|---|
| `services/notes.ts` | `findInternalLinks()` and `findMarkdownInternalLinks()` (also `[[id?…]]`) make `internalLink` relations for links with a query; `findIncludeNoteLinks()` makes `includeNoteLink` for excerpts without recording the range |
| `services/block_ranges.ts`, `routes/api/notes.ts` | `GET`/`PUT /api/notes/:noteId/blocks` |
| `services/references/text.ts` | Reads the first valid id of each heading; splices a new one in, drawn with `drawBlockId()` (`adding-link-targets` skill) |
| `services/sanitizer.ts` | Keeps `data-*` on every element, so safe import keeps ids |
| `share/content_renderer.ts` | `renderText()` slices; the embed loop renders excerpts; `replaceWithUnavailable()` keeps the id; `handleAttachmentLink()` keeps `?block=` on share links; `getLinkedHeadingText()`; `preparePageContent()` adds slug ids and table-of-contents anchors beside block ids |
| `services/export/single.ts` | Leaves links and ids as they are |
| `services/export/zip.ts`, `zip/share_theme.ts`, `rewrite_links.ts` | Rewrite hrefs to files and drop `?block=` |
| `services/export/markdown.ts` | Drops ids on blocks written as Markdown, keeps them on blocks written as HTML (embeds with `data-block`, figures, headerless tables, `<details>`, layouts, asides); reference links stay HTML |
| `services/export/opml.ts` | Raw HTML, everything kept |
| `services/import/zip.ts` | Remaps note ids only; block links become whole-note links on a round trip, excerpts keep `data-block` |
| `services/import/markdown.ts` | Wikilinks become `href="/id?…"`, not `#root`, so no backlink and no block navigation |

`apps/server/src` has no reader or writer of its own.

## Share theme (`packages/share-theme/src/`)

| Place | Does |
|---|---|
| `index.ts` | `showLinkedBlocks()`: on `?block=` in `location.search`, loads `block_reference_read_only` lazily, waits for the drawings, reveals and flashes |
| `content/in_page_links.ts` | Same-path links jump in place; a fragment wins over `block`; a broken range falls through to a page load |
| `content/mermaid.ts` | The drawing takes the diagram's id, from `<pre>` first, then `<code>` |
| `page/toc.ts` | Copying a heading link removes `block` from the address |
