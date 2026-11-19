# Worked sketches

Each section names the decisions of SKILL.md ("Decide first") for one kind of content, and the
places that change. A section marked "(built)" says what the shipped design took, as a pattern for
the next one. The others are starting points, not settled designs: the link parameter of each one
is the decision to confirm with the maintainer first.

## Markdown headings and anchors (built)

Markdown notes (`type === "code"` with `isMarkdownMime(mime)`) list their headings as `heading`
targets and their anchors (an `<a id>` without `href`) as `anchor` targets, as text notes do. What
it took:

- **The link parameter**: `?block=<id>`, as for text notes. A heading links once it owns a block
  id, which the source holds as a block marker, `<a data-trilium-block-id="<id>"></a>`
  (`formatBlockMarker()` in commons `block_reference.ts`), so a renamed heading keeps its links.
  An anchor links with `?bookmark=<name>`.
- **The index**: `indexMarkdownBlocks()` (commons `markdown_block_index.ts`) renders the source
  as the readers of the runtime render it and maps each block to its source lines, with the
  markers and anchors. It takes a `BlockIndexHost`: `serverBlockHost` (core
  `import/markdown.ts`) on the server, `PREVIEW_BLOCK_HOST` in the client.
- **The provider**: `references/markdown.ts` in core lists the targets with
  `findMarkdownTargets()` and answers `createReference` with `addMarkdownHeadingReference()`
  (commons `markdown_references.ts`), which places a marker on the heading's block through
  `placeMarkerOnBlock()`.
- **Shared with text notes**: `toReferenceTargets()`, `getHeadingText()`, `isAnchor()`,
  `findRequestedHeading()` and `sortAnchorNames()` (commons `reference_targets.ts`), and
  `drawBlockId()` (commons `block_reference.ts`). The text and Markdown providers read headings
  and anchors by the same rules, so a change to a rule goes there, not into one provider.
- **The editor**: `useBlockMarkers()` (`type_widgets/markdown/editor_block_references.ts`) draws
  the markers as chips through the CodeMirror extension `blockMarkers()`
  (`packages/codemirror/src/extensions/block_markers.ts`), and registers the targets of the
  document being edited for the `@` list and the link dialog (`registerOwnLinkTargets()` in
  `editor_utils.ts`). Picking a heading without an id inserts its marker. The hooks it returns go
  to the saver, so the ids that another writer gave the blocks meanwhile are taken over instead of
  ending in a conflict.
- **The view**: `useRevealLinkTarget()` in `Markdown.tsx` lands through `useLinkTargetLanding()`:
  `revealInSource()` in the source pane, `consumeBlockReference()` and `consumeBookmark()` in the
  preview.
- **Labels**: the chip of a Wikilink (`resolveWikilinkChip()`) labels what reference links label,
  in the order of `LABELED_TARGET_PARAMS` (`loadLinkTargetLabel()`).

## PDF outline entries (built)

The outline entries of PDF notes and attachments are link targets of kind `heading`, through the
ToC cache (SKILL.md, "ToC formats"). What it took, as a pattern for the next format:

- **Format**: `toc/pdf.ts` in core: `type === "file"` with `mime === "application/pdf"`, its own
  properties `{ "reader": PDF_TOC_READER }`, a `page` field per heading, and
  `getLinkParams()` giving `?page=<n>&heading=<id>`. The page lets a viewer that cannot find the
  heading open the right page.
- **Reader**: one reader for every platform, `readPdfOutline()` in commons `pdf_toc.ts`, over the
  part of a pdf.js document it needs (`PdfOutlineSource`). Titles go through `normalizeTocTitle()`,
  levels stay those of the file, and a heading without a destination inherits the page of the
  first heading below it.
- **Generators**: the server's in `apps/server/src/services/toc/pdf.ts` (`unpdf`, imported on the
  first read); on standalone and mobile the PDF viewer builds (`trilium-build-toc`, see the
  `developing-pdf-viewer` skill).
- **Contract**: `toc/fixtures/toc_contract.pdf` and its JSON are what every reader must agree on;
  the server spec, the viewer spec and a core spec of the `PUT` compare with them. Regenerate both
  with the script beside them after a change of the reader or of the ids.

## DOCX and ODT headings and bookmarks (built)

- **Notes**: `type === "file"` with the Word or OpenDocument text MIME type (`DOCX_MIME`,
  `ODT_MIME`), and attachments of role `file`.
- **Formats**: `docxTocFormat` and `odtTocFormat` in `services/toc/office.ts`, one factory with a
  reader version each (`DOCX_TOC_READER`, `ODT_TOC_READER`), since `officeparser` reads the two
  with parsers that change on their own. Bump the version of a format when an upgrade changes its
  headings or bookmarks; the contract fixture of the format fails until then.
- **Reader**: the headings are the `h1` to `h6` of the HTML that `convertOfficeToHtml()` writes
  for the preview (`readPreviewHeadings()` in `services/toc/office_headings.ts`), with levels made
  into depths by `createLevelTracker()` (an empty heading is left out as if absent), note marks
  left out and `<br>` read as a space. The cache and the marking of the preview read the same
  HTML, so their ids agree by construction.
- **Bookmarks**: the names from the document's main part (`readZipPart()` of
  `services/utils/zip_records.ts`, so a part with a wrong CRC-32 gives none), without those an
  editor makes (`_…`), those that another source of ids in the preview gives (ODT `xml:id`,
  `text:id`, `table:name`, `draw:name`, note ids `footnote-…`), and those that more than one
  element has as id. The preview has no slug ids (`generateIds: false`), which could equal a
  bookmark's name. Stored in the format's properties, listed as anchors with `?bookmark=`.
- **Parameter**: `?heading=<id>` alone; a reflowed preview has no page. An id that no element has
  opens the top of the preview.
- **The view**: the preview route marks the start tags (`data-toc-heading`, `data-toc-bookmark`);
  `OfficePreview` and the attachment view take the target with `takeLinkTarget()` and land with
  `showDocumentTarget()`.
- **Contract**: `toc/fixtures/toc_contract.docx`, `toc_contract.odt` and their JSON, written by
  `generate-office-toc-contract.mts`; `office.spec.ts` runs them through the real `officeparser`
  under both runners.

## EPUB tables of contents (built)

- **Notes**: `type === "file"` with either EPUB MIME type (`EPUB_MIME_TYPES`), and attachments of
  role `file`.
- **Format**: `epubTocFormat` in `services/toc/epub.ts`, an object of its own whose properties are
  `{ reader }` only (`EPUB_TOC_READER`); it loads the pass, the reader and the marking from
  `epub_pass.ts` with `await import()`. Bump the reader when the reading of a table of contents,
  the placing of markers or an upgrade of `officeparser` changes the entries, their levels or which
  are shown.
- **Reader**: the entries of the book's own table of contents, the EPUB 3 navigation's
  `epub:type="toc"`, else the EPUB 2 NCX (`readBookToc()` in `services/toc/epub_package.ts`, over
  the XML tokenizer of `toc/xml.ts`), not the preview's headings: `officeparser` keeps nothing of
  where a chapter starts. An entry without a title is left out as if absent
  (`createLevelTracker()`), as the DOCX and ODT readers leave out an empty heading.
- **The pass**: `convertOfficeToHtml()` runs `runTocPass()` (`toc/epub_pass.ts`) before converting
  an EPUB. It inflates only the text parts (128 MiB budget, declared sizes checked first, length
  and CRC-32 proved by `readEntryContent()` of `services/utils/zip_records.ts`), places one empty
  anchor `<a id="trilium_toc_<n>">` per destination by the kind of its target (before an outermost
  `<a>`, in a table row's first cell, before an empty element, else after the start tag; the
  chapter's `<body>` for a whole chapter), and rewrites the archive with `rewriteZip()`, copying
  every other entry compressed. Its outcome (`marked`, `none`, `refused`, `failed`) reaches the route through
  `onTocPass`; a `failed` preview is sent uncached, a `refused` book is a permanent failure.
- **Landing**: `findLandings()` finds each marker in the preview, resolves the converter's empty
  `<a id name>` to the element after it, and checks it against the book's own id when only the
  target can give that id; an entry without a place of its own lands where the first entry of its
  subtree does. Several entries on one element share its `data-toc-heading`
  (`writePreviewMarks()` of `toc/preview_marks.ts`, which the DOCX and ODT marking uses too).
- **The preview has no slug ids**: EPUB is in `NO_GENERATED_IDS` of `office_preview.ts`.
- **Contract**: `toc/fixtures/toc_contract.epub`, `toc_contract_ncx.epub`, `toc_contract_ids.epub`
  and their JSON, written by `generate-office-toc-contract.mts`; `epub.spec.ts` runs them through
  the real pass and `officeparser` under both runners.

## Spreadsheet sheets

- **Notes**: `type === "spreadsheet"`, whose content is the workbook JSON.
- **Kind**: a new `sheet` kind, flat. Named ranges could be a second kind.
- **Parameter**: a new `sheet` parameter with the sheet id from the JSON, which stays when the
  sheet is renamed. Title: the sheet name.
- **The view**: the spreadsheet widget activates the sheet when `viewScope.sheet` is set.
