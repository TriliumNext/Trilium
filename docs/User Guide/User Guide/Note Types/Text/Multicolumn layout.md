# Multicolumn layout
A multicolumn layout arranges content in two to four columns, side by side. A column can hold any kind of content, including tables, images and another multicolumn layout.

The borders around the columns are only a guide while editing. In [read-only notes](../../Basic%20Concepts%20and%20Features/Notes/Read-Only%20Notes.md), [shared notes](../../Advanced%20Usage/Sharing.md) and printouts, the columns have no borders, and their text lines up with the rest of the note.

## Inserting a layout

*   In the formatting bar, go to _Insert_ → <span class="tn-icon cke cke-trilium-multicolumn"></span> _Multicolumn layout_ to insert a layout with two columns.
*   Alternatively, type `/columns` and choose _2 columns layout_, _3 columns layout_ or _4 columns layout_, as described in <a class="reference-link" href="Slash%20Commands.md">Slash Commands</a>.

The columns of a new layout have equal widths. If text is selected when the layout is inserted, the selection moves into the first column.

## Changing the columns

While the cursor is inside a layout, a toolbar appears above it with a button that shows the current layout. Clicking it opens a row of figures, one for each available layout; hovering over a figure shows its number of columns and their widths:

| Columns | Widths |
| --- | --- |
| 2 | 50%-50%, 25%-75%, 75%-25% |
| 3 | 33%-33%-33%, 25%-50%-25% |
| 4 | 25%-25%-25%-25% |

*   Choosing a layout with more columns adds empty columns at the end.
*   Choosing a layout with fewer columns removes the last columns and moves their content to the end of the last remaining column.

## Removing a layout

*   To remove the layout but keep its content, click the <span class="tn-icon cke cke-cancel"></span> _Remove layout_ button in the layout's toolbar. The content of the columns is placed one after another where the layout was, and empty columns are left out.
*   To delete the layout together with its content, click the handle at its top-left corner to select it, then press <kbd>Delete</kbd>.

## Narrow screens

When a layout has too little room for its columns (narrower than about 500 pixels, such as on a phone), the columns are stacked one below the other. While editing, alternating background colors take the place of the borders. This applies to each layout on its own, so a layout inside a narrow column is stacked while the outer one stays side by side.

## Printing and exporting

*   When printing or [exporting to PDF](../../Basic%20Concepts%20and%20Features/Notes/Printing%20%26%20Exporting%20as%20PDF.md), the columns are printed side by side, without borders.
*   Markdown has no columns, so Markdown export writes the content of the columns one after another.