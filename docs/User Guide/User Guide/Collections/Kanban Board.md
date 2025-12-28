# Kanban Board
<figure class="image"><img style="aspect-ratio:918/248;" src="2_Kanban Board_image.png" width="918" height="248"></figure>

The Board view presents sub-notes in columns for a Kanban-like experience. Each column represents a possible value for a status label, which can be adjusted.

## How it works

When first creating a collection of _Board_ type, a few subnotes will be created, each having a `#status` label set. The board then groups each note by the value of the status attribute.

Notes are displayed recursively, so even the child notes of the child notes will be displayed. However, unlike the <a class="reference-link" href="Table.md">Table</a>, the notes are not displayed in a hierarchy.

## Interaction

### Working with columns

*   Create a new column by pressing _Add Column_ near the last column.
    *   Once pressed, a text box will be displayed to set the name of the column. Press <kbd>Enter</kbd> to confirm, or <kbd>Escape</kbd> to dismiss.
*   To reorder a column, simply hold the mouse over the title and drag it to the desired position.
*   To delete a column, right click on its title and select _Delete column_.
*   To rename a column, click on the note title.
    *   Press Enter to confirm.
    *   Upon renaming a column, the corresponding status attribute of all its notes will be changed in bulk.
*   If there are many columns, use the mouse wheel to scroll.

### Working with notes

*   Create a new note in any column by pressing _New item_
    *   Enter the name of the note and press <kbd>Enter</kbd> or click away. To dismiss the creation of a new note, simply press <kbd>Escape</kbd> or leave the name empty.
    *   Once created, the new note will have an attribute (`status` label by default) set to the name of the column.
*   To open the note, simply click on it.
*   To change the title of the note directly from the board, hover the mouse over its card and press the edit button on the right.
*   To change the state of a note, simply drag a note from one column to the other to change its state.
*   The order of the notes in each column corresponds to their position in the tree.
    *   It's possible to reorder notes simply by dragging them to the desired position within the same columns.
    *   It's also possible to drag notes across columns, at the desired position.
*   For more options, right click on a note to display a context menu with the following options:
    *   Open the note in a new tab/split/window or quick edit.
    *   Move the note to any column.
    *   Insert a new note above/below the current one.
    *   Archive/unarchive the current note.
    *   Delete the current note.
*   If there are many notes within the column, move the mouse over the column and use the mouse wheel to scroll.

### Working with the note tree

It's also possible to add items on the board using the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>.

1.  Select the desired note in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>.
2.  Hold the mouse on the note and drag it to the to the desired column.

This works for:

*   Notes that are not children of the board, case in which a [clone](../Basic%20Concepts%20and%20Features/Notes/Cloning%20Notes.md) will be created.
*   Notes that are children of the board, but not yet assigned on the board.
*   Notes that are children of the board, case in which they will be moved to the new column.

### Keyboard interaction

The board view has mild support for keyboard-based navigation:

*   Use <kbd>Tab</kbd> and <kbd>Shift</kbd>+<kbd>Tab</kbd> to navigate between column titles, notes and the “New item” button for each of the columns, in sequential order.
*   To rename a column or a note, press <kbd>F2</kbd> while it is focused.
*   To open a specific note or create a new item, press <kbd>Enter</kbd> while it is focused.
*   To dismiss a rename of a note or a column, press <kbd>Escape</kbd>.

## Configuration

### Displaying custom attributes

<figure class="image image-style-align-center"><img style="aspect-ratio:531/485;" src="Kanban Board_image.png" width="531" height="485"></figure>

Since v0.100.0, note attributes can be displayed on the board to enhance it with custom information such as adding a _Due date_ for your tasks.

This feature works exclusively via attribute definitions (<a class="reference-link" href="../Advanced%20Usage/Attributes/Promoted%20Attributes.md">Promoted Attributes</a>). The easiest way to add these is:

1.  Go to board note.
2.  In the ribbon select _Owned Attributes_ → plus button → _Add new label/relation definition_.
3.  Configure the attribute as desired.
4.  Check _Inheritable_ to make it applicable to child notes automatically.

After creating the attribute, click on a note and fill in the promoted attributes which should then reflect inside the board.

Of note:

*   Both promoted and non-promoted attribute definitions are supported. The only difference is that non-promoted attributes don't have an “Alias” for assigning a custom name.
*   Both “Single value” and “Multi value” attributes are supported. In case of multi-value, a badge is displayed for every instance of the attribute.
*   All label types are supported, including dates, booleans and URLs.
*   Relation attributes are also supported as well, showing a link with the target note title and icon.
*   Currently, it's not possible to adjust which promoted attributes are displayed, since all promoted attributes will be displayed (except the `board:groupBy` one). There are plans to improve upon this being able to hide promoted attributes individually.

### Grouping by another label

By default, the label used to group the notes is `#status`. It is possible to use a different label if needed by defining a label named `#board:groupBy` with the value being the attribute to use (with or without `#` attribute prefix).

### Grouping by relations

<figure class="image image-style-align-right"><img style="aspect-ratio:535/245;" src="1_Kanban Board_image.png" width="535" height="245"></figure>

A more advanced use-case is grouping by [Relations](../Advanced%20Usage/Attributes/Relations.md).

During this mode:

*   The columns represent the _target notes_ of a relation.
*   When creating a new column, a note is selected instead of a column name.
*   The column icon will match the target note.
*   Moving notes between columns will change its relation.
*   Renaming an existing column will change the target note of all the notes in that column.

Using relations instead of labels has some benefits:

*   The status/grouping of the notes is visible outside the Kanban board, for example on the <a class="reference-link" href="../Note%20Types/Note%20Map.md">Note Map</a>.
*   Columns can have icons.
*   Renaming columns is less intensive since it simply involves changing the note title of the target note instead of having to do a bulk rename.

To do so:

1.  First, create a Kanban board from scratch and not a template:
2.  Assign `#viewType=board #hidePromotedAttributes` to emulate the default template.
3.  Set `#board:groupBy` to the name of a relation to group by, **including the** `~` **prefix** (e.g. `~status`).
4.  Optionally, use <a class="reference-link" href="../Advanced%20Usage/Attributes/Promoted%20Attributes.md">Promoted Attributes</a> for easy status change within the note:
    
    ```
    #relation:status(inheritable)="promoted,alias=Status,single"
    ```