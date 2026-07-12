# Microsoft OneNote
Trilium allows importing from OneNote. Currently the only mechanism supported is via the Microsoft Graph API which requires you to authenticate in a browser in order for the notes to be obtained by Trilium.

## Import process

1.  In the <a class="reference-link" href="../../UI%20Elements/Note%20Tree.md">Note Tree</a>, right click and select _Import into note_.
2.  In the _Import from_ section, select _OneNote_.
3.  Press the _Connect_ button, you will be redirected to Microsoft's authentication screen where you can log into your account.
4.  After the connection is successful, you should be able to see a list of sections that can be imported. Simply check the ones to import and press the _Import selected_ button.
5.  Wait for the import to finish.

## Supported features

The following features are preserved by Trilium during the import process:

*   Basic formatting (bold, italic, underline, strikethrough, subscript, super script, inline code, font sizes, headings, colors, highlights).
    *   Black-colored text is intentionally stripped to allow it to work in dark themes.
*   <a class="reference-link" href="../../../Note%20Types/Text/Lists.md">Lists</a> with different bullet types.
*   <a class="reference-link" href="../../../Note%20Types/Text/Tables.md">Tables</a>
*   Images and <a class="reference-link" href="../../Notes/Attachments.md">Attachments</a>.
*   To-do lists
*   Hand-drawing is preserved and displayed as an SVG image (however there are some
*   Links between other imported pages are converted to <a class="reference-link" href="../../../Note%20Types/Text/Links/Internal%20(reference)%20links.md">Internal (reference) links</a> if the text of the link matches the name of the page, or plain links otherwise. If the pages are not part of the import, the original `onenote:` link is kept.
*   Tags (apart from to-do lists) are mildly preserved by converting them to emojis. This loses their searchability. Since Trilium has no concept of inline attributes or badges, this is considered a middle-ground.

Regarding the note structure:

*   The order of the pages within a section is maintained.
*   Sub-pages and section groups are maintained by nesting notes in a hierarchical structure.
*   Creation and modification of both notes and sections is preserved. The order of section or section groups is not preserved (see limitations).

## Limitations

### Regarding OneNote's freehand structure

OneNote is fundamentally different to Trilium in structure because it allows freehand drawing to coexist with text, and text boxes can be placed anywhere in the document (e.g. a common use case is to have columns). Trilium has a document flow mechanism for <a class="reference-link" href="../../../Note%20Types/Text.md">Text</a> notes which means that it can't be freely positioned.

To cope with this difference, Trilium will flatten the text structure into normal paragraphs. The paragraphs will be ordered visually based on the original position of the text boxes, but their horizontal position will not be preserved. Parallel text such as columns may appear interleaved which can cause problems.

In addition, drawing in OneNote can be interleaved with text boxes. Text notes in Trilium do not allow for this feature, so all drawing will appear at the end. For some use cases (diagrams, for example) this will work fine, but if you have highlights or other text-dependent drawings they will appear out of order.

> [!NOTE]
> There are plans to support drawing-heavy notes that interleave with text boxes by converting them to a <a class="reference-link" href="../../../Note%20Types/Canvas.md">Canvas</a> instead.

## Other limitations

The following are known limitations due to how the information comes from the import (Microsoft Graph API), which means that they cannot be fixed.

*   The order of the sections (and section groups) is not available, the sections are ordered by creation date instead.
*   Revision history.
*   Paragraph indentation.
*   Section colors.

## Reporting issues

When importing notes, you might find that some text is not rendered properly or the structure is not properly maintained. As long as this issue is not a fundamental issue (like the issue with freehand text not being preserved exactly), it's a good idea to [report it](../../../Troubleshooting/Reporting%20issues.md).

When reporting, make sure that you provide the following information:

*   Import again the section, checking the debug checkbox before importing. This preserves the original document (and the hand-drawing data if any) as it came through from OneNote's cloud API so that it can be used for comparison.
*   Export only the affected page as ZIP, making sure not to accidentally expose any sensitive information.
*   Take screenshots of how the note looked like in OneNote and how it ends up in Trilium.
*   Attach the ZIP and the screenshots to the issue report.