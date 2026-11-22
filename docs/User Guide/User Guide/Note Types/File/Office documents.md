# Office documents
Since v0.105.0, office documents stored in Trilium display an inline preview of their content, without the need to download them or open them in an external application.

## Supported formats

*   Microsoft Office formats: Word (`.docx`), Excel (`.xlsx`) and PowerPoint (`.pptx`).
*   The OpenDocument alternatives to the previous formats (Text, Spreadsheet, Presentation), created by editors such as LibreOffice and OpenOffice.
*   [Rich Text Format (RTF)](https://en.wikipedia.org/wiki/Rich_Text_Format).
*   [EPUB](https://en.wikipedia.org/wiki/EPUB) e-books.

> [!NOTE]
> Older Microsoft Office formats (`.doc`, `.xls`, `.ppt`) are not supported.

## How it works

The document is converted to a simplified representation on the server and rendered as read-only content, similar to a <a class="reference-link" href="../Text.md">Text</a> note.

The preview generally preserves:

*   Headings, paragraphs and text alignment.
*   Text formatting: bold, italic, underline, strikethrough, subscript/superscript, text and highlight colors, fonts and font sizes.
*   Bulleted and numbered lists.
*   Tables, including merged cells and cell background colors.
*   Embedded images.
*   Links and footnotes.

To keep links readable regardless of the theme, the default hyperlink color applied automatically by word processors is ignored; links that were deliberately given a custom color by the author keep it.

### Excel workbooks

A File note holding an Excel workbook (`.xlsx`) opens in a read-only spreadsheet, the same view as a <a class="reference-link" href="../Spreadsheets.md">Spreadsheet</a> note that cannot be edited: the sheets are listed in tabs at the bottom, and the grid scrolls in both directions however large the workbook is. Like a Spreadsheet note, it always takes the full width of the window, whatever the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Content%20width.md">Content width</a>.

A workbook stored as an <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Attachments.md">attachment</a> opens the same way once the attachment is opened on its own. If the file cannot be read as a workbook, the simplified preview described above is shown instead.

## Linking to a heading or a bookmark

Since v0.108.0, a link can point at a heading of a Word (`.docx`) or OpenDocument Text (`.odt`) document, at a chapter or section of an EPUB e-book, or at a bookmark of a Word or OpenDocument document. To create one from a text or Markdown note:

*   In the _Add link_ dialog, pick the document on the _Note_ page. Its headings are listed below the _Link title_, under _Link to a heading_, and its bookmarks under _Link to an anchor_. Check one, then press <kbd>Enter</kbd> or _Insert link_.
*   Alternatively, type `@` and pick the document: the menu then lists the same headings and bookmarks.

The headings are also listed in the table of contents of the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Right%20Sidebar/Outline%20tab.md">Outline tab</a>, which highlights the heading being read. Clicking a heading scrolls the preview to it, and right-clicking it and selecting _Copy reference_ copies a link to it.

The link shows the title of the document followed by the title of the heading, and opens the preview at the heading or the bookmark. When it cannot be found, for example once a new version of the file renamed the heading, the link opens the top of the document. A heading whose title is repeated among the headings beside it is found only in the very same file, so once a new version of the file is uploaded, a link to it opens the top of the document.

To link to a heading of a document stored as an attachment, edit a link to the attachment: the dialog lists the headings of the attachment.

The headings are those of the preview. In a Word document, they are the paragraphs in Word's built-in heading styles and in the _Title_ style. Some localized versions of Word, such as the German and the French ones, name these styles differently, and their headings show as plain paragraphs, which no link can point at. Bookmarks that the editor creates on its own, such as those of a table of contents, are not listed.

In an EPUB e-book, the headings are the entries of the book's own table of contents, as an e-book reader lists them. An entry whose part of the book cannot be shown, such as a chapter protected by DRM, is not listed.

> [!NOTE]
> Trilium keeps the headings of each document in an attachment of the note named `toc-cache.json`, read again whenever the file changes. Revisions, exports and copies of the note leave it out.

## Limitations

*   The preview is read-only. To edit the document, download it or open it in an external application; the content of the note is not affected by the preview. Alternatively copy and paste it into a text note.
*   The preview is a simplified rendering: complex layouts (columns, text boxes, headers and footers), charts and the precise styling of table borders are not reproduced.
*   Documents larger than 20 MB are not previewed, to keep the server responsive. A message says the document is too large to preview, and the usual download and open actions remain available.
*   If the document cannot be converted, a notice is displayed instead and the file can still be downloaded or opened externally.

## Relation with other features

*   The same preview is used when an office document is displayed in the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Note%20List.md">Note List</a> or embedded in a text note via <a class="reference-link" href="../Text/Include%20Note.md">Include Note</a>, as well as for office documents stored as <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Attachments.md">Attachments</a>. For a spreadsheet, the Note List and the list of attachments show only the top-left corner of its first sheet (20 rows by 15 columns); open the note or the attachment to see all of it in the read-only spreadsheet.
*   Independently of the preview, the text content of office documents is also extracted in the background so that it can be found with <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Navigation/Search.md">Search</a> via <a class="reference-link" href="../../Advanced%20Usage/Text%20Extraction%20(OCR).md">Text Extraction (OCR)</a>.
*   `.csv` and `.xlsx` files can be converted to <a class="reference-link" href="../Spreadsheets.md">Spreadsheets</a> via the [import](../../Basic%20Concepts%20and%20Features/Import%20%26%20Export.md) function.