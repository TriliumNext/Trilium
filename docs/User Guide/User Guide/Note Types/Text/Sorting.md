# Sorting
> [!IMPORTANT]
> Sorting the selection is experimental, and it changes as it matures. To use it, turn on _Sort selection in text editor_ in <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Advanced_ → _Experimental Options_.

Trilium can sort the items of a list, a group of paragraphs or the rows of a table in a text note, comparing numbers, dates and times by their value.

## Sorting

*   To sort, place the cursor in a list or a table, or select the paragraphs to sort, then press the <span class="tn-icon bx bx-sort-alt-2"></span> _Sort_ button of the <a class="reference-link" href="Formatting%20toolbar.md">Formatting toolbar</a> to sort in ascending order. The arrow beside it offers _Ascending_ and _Descending_. With the floating toolbar, the button is in the block-level popup.
*   When the selection covers several paragraphs, list items or table cells, the same choices are also in a submenu at the bottom of the menu of the block handle, the sequence of dots to the left of the block, and in the right-click menu of the selection. The submenu is named after what it sorts: _Sort blocks_, _Sort list items_ or _Sort rows_.
*   On the <a class="reference-link" href="../../Installation%20%26%20Setup/Mobile%20Frontend.md">Mobile Frontend</a>, the button is in the main row of the toolbar and in the row of the _List ›_ button.

A sort can be undone with <kbd>Ctrl</kbd>+<kbd>Z</kbd>.

## What is sorted

*   **List items**: with the cursor in a list, the items at its level are sorted. Nested items move with the item they belong to and keep their own order. To sort only some of the items, select them.
*   **Paragraphs and other blocks**: select two or more paragraphs, headings, quotes, collapsible blocks or images. Each block is sorted by its first text: a collapsible block by its title, a quote by its first paragraph and an image by its caption. A selection that mixes a list with other blocks cannot be sorted.
*   **Table rows**: the rows are sorted by the column of the cursor, as described in _Sorting rows_ in <a class="reference-link" href="Tables.md">Tables</a>. Inside a table cell, a list or several selected paragraphs are sorted instead of the rows.

Values are compared the same way as table rows, see _How values are compared_ in <a class="reference-link" href="Tables.md">Tables</a>.

## Limitations

*   The lines of a code block, or of a paragraph split with <kbd>Shift</kbd>+<kbd>Enter</kbd>, are not sorted one by one. A <a class="reference-link" href="../Code.md">Code</a> note can sort its lines, see _Transforming text_ there.