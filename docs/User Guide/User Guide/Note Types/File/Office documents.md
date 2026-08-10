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

## Limitations

*   The preview is read-only. To edit the document, download it or open it in an external application; the content of the note is not affected by the preview. Alternatively copy and paste it into a text note.
*   The preview is a simplified rendering: complex layouts (columns, text boxes, headers and footers), charts and the precise styling of table borders are not reproduced.
*   Documents larger than 20 MB are not previewed, to keep the server responsive. The usual download and open actions remain available.
*   If the document cannot be converted, a notice is displayed instead and the file can still be downloaded or opened externally.

## Relation with other features

*   The same preview is used when an office document is displayed in the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Note%20List.md">Note List</a> or embedded in a text note via <a class="reference-link" href="../Text/Include%20Note.md">Include Note</a>, as well as for office documents stored as <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Attachments.md">Attachments</a>.
*   Independently of the preview, the text content of office documents is also extracted in the background so that it can be found with <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Navigation/Search.md">Search</a> via <a class="reference-link" href="../../Advanced%20Usage/Text%20Extraction%20(OCR).md">Text Extraction (OCR)</a>.
*   `.csv` and `.xlsx` files can be converted to <a class="reference-link" href="../Spreadsheets.md">Spreadsheets</a> via the [import](../../Basic%20Concepts%20and%20Features/Import%20%26%20Export.md) function.