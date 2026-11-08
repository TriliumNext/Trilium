---
type: highlight
title: The text editor became a block editor
closes: [11926, 11925, 12069, 12399, 11958, 11982, 11829, 12063, 11795, 12358, 12467, 11798, 12085]
credits: [adoriandoran]
---

A text note used to be a document: one body of rich text, with other notes reachable only through links. It is now a composition. A note can embed another note and let you edit it where it sits, quote a few of its blocks and keep the quote current, or point at one paragraph of it instead of at the whole note.

*   [Editable transclusion](https://github.com/TriliumNext/Trilium/pull/11926): an included text or code note is edited inside the host note with the full editor, and one undo history covers both.
*   [Live excerpts](https://github.com/TriliumNext/Trilium/pull/11925) quote blocks of another note. They stay in sync, and an edit made in the excerpt is saved back to the source.
*   [Block references](https://github.com/TriliumNext/Trilium/pull/12069) link to a paragraph, heading, table or range of blocks. The target opens scrolled to the block and highlighted, and on a shared page every block has a public link of its own.

Layout caught up with content. [Multicolumn layouts](https://github.com/TriliumNext/Trilium/pull/11958) put two to four columns side by side and stack them on narrow screens. [Drawing canvases](https://github.com/TriliumNext/Trilium/pull/11829) are sketched in place with Excalidraw and saved with the note. Files are [attached](https://github.com/TriliumNext/Trilium/pull/11795) in one step, as inline embeds for PDFs and spreadsheets or as links, and YouTube videos and web audio or video play inside the note. A block handle moves blocks, images and tables, a "+" on an empty line opens the slash commands, and one [link dialog](https://github.com/TriliumNext/Trilium/pull/12358) serves web links, note links and anchors from a popover at the cursor.

The include box itself was [reworked](https://github.com/TriliumNext/Trilium/pull/11798): a compact title row with a caption, fullscreen, a link from the embed to its note and back, Markdown included as source, split or preview, code with folding and line numbers, and resizing by dragging a corner or an edge. [Content tabs](https://github.com/TriliumNext/Trilium/pull/12063) group blocks under a scrolling row of titles, above or below the content, with a menu to add, reorder or delete tabs and Ctrl shortcuts to move content between them.
