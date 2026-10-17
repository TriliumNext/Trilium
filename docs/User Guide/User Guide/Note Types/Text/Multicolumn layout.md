# Multicolumn layout
A multicolumn layout arranges content in two to four columns, side by side. A column can hold any kind of content, including tables, images and another multicolumn layout.

## Inserting a layout

*   In the formatting bar, go to _Insert_ → <span class="tn-icon cke cke-trilium-multicolumn"></span> _Multiple column layout_ to insert a layout with two columns. Its submenu offers _2 columns_, _3 columns_ and _4 columns_.
*   Alternatively, type `/columns` and choose _2 columns layout_, _3 columns layout_ or _4 columns layout_, as described in <a class="reference-link" href="Slash%20Commands.md">Slash Commands</a>.

The columns of a new layout have equal widths. If text is selected when the layout is inserted, the selection moves into the first column.

## Changing the columns

### Changing the layout

While the cursor is inside a layout, a toolbar appears above it with a button that shows the current layout. Clicking it opens a row of figures, one for each available layout; hovering over a figure shows its number of columns and their widths:

| Columns | Widths |
| --- | --- |
| 2 | 50%-50%, 25%-75%, 75%-25% |
| 3 | 33%-33%-33%, 25%-50%-25% |
| 4 | 25%-25%-25%-25% |

*   Choosing a layout with more columns adds empty columns at the end.
*   Choosing a layout with fewer columns removes the last columns and moves their content to the end of the last remaining column.

### Adding columns

While the cursor is in a column, you can use these key combinations:

*   <kbd>Ctrl</kbd> + <kbd>Enter</kbd>: Add a column after the current one.
*   <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Enter</kbd>: Add a column before the current one.

The new column is empty and the cursor moves into it. All the columns then have equal widths. A layout has at most four columns, so the keys do nothing in a layout that already has four.

<kbd>Ctrl</kbd> + <kbd>Enter</kbd> keeps its usual function on a link, in a to-do item and in the title of a collapsible block, and <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Enter</kbd> in a to-do item.

### Reordering columns

While the cursor is anywhere inside a column, you can use these key combinations:

*   <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>Right</kbd>: Move the column to the right.
*   <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>Left</kbd>: Move the column to the left.
*   <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>Home</kbd>: Make it the first column.
*   <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>End</kbd>: Make it the last column.

In a layout with two columns of different widths, the column keeps its width.

## Moving content between columns

To move content to another column, select it, and then use these key combinations:

*   <kbd>Ctrl</kbd> + <kbd>Right</kbd>: Move to the column on the right.
*   <kbd>Ctrl</kbd> + <kbd>Left</kbd>: Move to the column on the left.
*   <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>End</kbd>: Move to the last column.
*   <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Home</kbd>: Move to the first column.

Paragraphs, list items, tables and other blocks move whole, even when only part of them is selected. Content moved to a column on the left goes to the end of that column, and content moved to a column on the right goes to its start, so it keeps its place in the reading order.

Without a selection, these keys keep their usual function: moving the cursor by word, or selecting up to the start or end of the column.

When a layout and <a class="reference-link" href="Content%20tabs.md">Content tabs</a> are nested in one another, the key combinations act on the one closest to the cursor.

## Removing a layout

*   To remove the layout but keep its content, click the <span class="tn-icon cke cke-remove"></span> _Remove layout_ button in the layout's toolbar. The content of the columns is placed one after another where the layout was, and empty columns are left out.
*   To delete the layout together with its content, click the handle at its top-left corner to select it, then press <kbd>Delete</kbd>.

## Narrow screens

When a layout has too little room for its columns (narrower than about 500 pixels, such as on a phone), the columns are stacked one below the other. While editing, alternating background colors tell the columns apart. This applies to each layout on its own, so a layout inside a narrow column is stacked while the outer one stays side by side.

## Printing and exporting

*   When printing or [exporting to PDF](../../Basic%20Concepts%20and%20Features/Notes/Printing%20%26%20Exporting%20as%20PDF.md), the columns are printed side by side.
*   Markdown has no columns, so Markdown export keeps the layout and each column as HTML `<div>` tags, with the content of each column written as Markdown between them. Importing the file back restores the layout. Markdown viewers that don't support HTML show the content of the columns one after another.