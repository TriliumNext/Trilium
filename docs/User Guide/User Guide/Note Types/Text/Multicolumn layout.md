# Multicolumn layout
A multicolumn layout arranges content in two to four columns, side by side. A column can hold any kind of content, including tables, images and another multicolumn layout.

## Inserting a layout

*   In the formatting bar, go to _Insert_ → <span class="tn-icon cke cke-trilium-multicolumn"></span> _Multicolumn layout_.
*   Alternatively, type `/columns` and press <kbd>Enter</kbd>, as described in <a class="reference-link" href="Slash%20Commands.md">Slash Commands</a>.

A new layout has two columns of equal width. If text is selected when the layout is inserted, the selection moves into the first column.

## Changing the columns

While the cursor is inside a layout, a toolbar appears above it with a dropdown of the available layouts, grouped by the number of columns:

| Columns | Widths |
| --- | --- |
| 2 | 50%-50%, 25%-75%, 75%-25% |
| 3 | 33%-33%-33%, 25%-50%-25% |
| 4 | 25%-25%-25%-25% |

*   Choosing a layout with more columns adds empty columns at the end.
*   Choosing a layout with fewer columns removes the last columns and moves their content to the end of the last remaining column.

To remove the whole layout, click the handle at its top-left corner to select it, then press <kbd>Delete</kbd>.

## Narrow screens

When a layout has too little room for its columns (narrower than about 500 pixels, such as on a phone), the columns are stacked one below the other, with alternating background colors instead of borders. This applies to each layout on its own, so a layout inside a narrow column is stacked while the outer one stays side by side.

## Printing and exporting

*   When printing or [exporting to PDF](../../Basic%20Concepts%20and%20Features/Notes/Printing%20%26%20Exporting%20as%20PDF.md), the columns are printed side by side.
*   Markdown has no columns, so Markdown export writes the content of the columns one after another.