# Converting between note types
A note's type may be converted to another:

*   <a class="reference-link" href="Text.md">Text</a> notes to <a class="reference-link" href="Markdown.md">Markdown</a> notes
*   Markdown notes to Text notes
*   <a class="reference-link" href="File.md">File</a> notes holding a Word, OpenDocument Text or RTF document to Text notes

Before conversion, a revision is saved automatically, so you can restore the original or recover any missing elements from it if the conversion produces undesired results. Read more about <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Notes/Note%20Revisions.md">Note Revisions</a>.

## Converting individual notes

### Markdown to Text Note

Markdown notes can be converted to Text Notes with negligible loss of formatting fidelity.

To do so, go to the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20menu.md">Note menu</a> → _Advanced_ and select _Convert to text note_.

### Text Note to Markdown

> [!WARNING]
> Since Markdown does not support all the capabilities of Text notes, this conversion is lossy in terms of formatting: some formatting may be lost, and some unsupported elements may even be dropped. It's strongly recommended that you inspect the content for any information that might have gone missing after the conversion.

To convert a text note to Markdown, go to the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20menu.md">Note menu</a> → _Advanced_ and select _Convert to Markdown note_.

### Document to Text Note

A <a class="reference-link" href="File.md">File</a> note holding a Word (`.docx`), OpenDocument Text (`.odt`) or RTF document can be turned into a Text note, so that its content can be edited in Trilium. To do so, go to the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20menu.md">Note menu</a> and select _Convert to text note_.

The conversion keeps headings, paragraphs and their alignment, bold, italic and the other text formatting, text and highlight colors, lists, links, tables with their column widths, cell colors, borders, padding, vertical alignment, row heights and merged cells, page breaks, and pictures, which become attachments of the note. Text larger or smaller than the body text of the document gets the nearest of the editor's font sizes (_Tiny_, _Small_, _Big_ or _Huge_). The extension is removed from the title of the note. In a Word document, the space Word leaves around the text of a table cell is added to the cell's padding, so that its rows keep their height. The document's fonts and the colors of its headings are not kept, so that the note follows the theme like any other Text note; to get them back when exporting the note, use the original document as its Word template (see <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Import%20%26%20Export.md">Import &amp; Export</a>). The revision saved beforehand holds the original file, so it can be downloaded or restored from <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Notes/Note%20Revisions.md">Note Revisions</a>.

## Converting multiple notes

A note type conversion can also be performed on an entire subtree or a set of multiple notes using <a class="reference-link" href="../Advanced%20Usage/Bulk%20Actions.md">Bulk Actions</a>.