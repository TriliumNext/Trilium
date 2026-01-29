# SQL Console
The SQL Console is Trilium's built-in database editor.

It can be accessed by going to the <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">Global menu</a> → Advanced → Open SQL Console.

![](SQL%20Console_image.png)

### Interaction

*   Hovering the mouse over one of the tables listed at the top of the document will show the columns and their data type.
*   Only one SQL statement can be run at once.
*   To run the statement, press the _Execute_ icon.
*   For queries that return a result, the data will displayed in a table.
*   For statements (e.g. `INSERT`, `UPDATE`), the number of affected rows is displayed.

<figure class="image"><img style="aspect-ratio:1124/571;" src="2_SQL Console_image.png" width="1124" height="571"></figure>

### Interacting with the table

After executing a query, a table with the results will be displayed:

*   Clicking on a column allows sorting ascending or descending.
*   Underneath each column there is an input field which allows filtering by text.
*   Press <kbd>Ctrl</kbd>+<kbd>C</kbd> to copy the current cell to clipboard.
*   Multiple cells can be selected by dragging or by holding <kbd>Shift</kbd> + arrow keys
*   Results are paginated for performance reasons. The controls at the bottom of the table can be used to navigate through pages.

### Saved SQL console

SQL queries or commands can be saved into a dedicated note.

To do so, simply write the query and press the ![](1_SQL%20Console_image.png) button. Once saved, the note will appear in <a class="reference-link" href="../../Advanced%20Showcases/Day%20Notes.md">Day Notes</a>.

The note can be locked for editing by pressing the _Lock_ button in the note actions section near the title bar (on the <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/New%20Layout.md">New Layout</a>, or in the <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Floating%20buttons.md">Floating buttons</a> area if using the old layout). When editing is locked, the SQL statement is hidden from view.