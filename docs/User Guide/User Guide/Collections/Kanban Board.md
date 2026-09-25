# Kanban Board
The Board view lets you arrange subnotes as cards on a [Kanban board](https://en.wikipedia.org/wiki/Kanban_board).

## Creating a Kanban board

Right-click an existing note in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>, select **Insert child note**, and look for **Kanban Board**.

## How it works

When you first create a collection of the _Board_ type, a few subnotes are created, each with a `#status` label set. The board then groups each note by the value of its status attribute.

Notes are displayed recursively, so even grandchildren and more deeply nested notes will be displayed. However, unlike the <a class="reference-link" href="Table.md">Table</a>, the notes are not displayed hierarchically.

## Working with columns

### Creating columns

You can create a new column by pressing the <span class="tn-icon bx bx-plus"></span>**Add column** button located after the last column.

Enter the new name (which must not match another column), optionally select an icon by pressing the circle at the start of the text box, and then press the (+) button or <kbd>Enter</kbd>. Click or tap outside the text box, or press <kbd>Esc</kbd>, to dismiss it.

### Reordering columns

The order of the columns can be changed at any time. There are several ways to do this:

*   **Using touch or a mouse:** Touch and hold the column header, or click and hold it with the mouse. Drag the column left or right until it reaches the desired location, and then release it.
*   **Using the keyboard:** While the keyboard focus is anywhere inside the column, you can use these key combinations. If the column header itself is focused, you can omit <kbd>Alt</kbd>:
    *   <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>Right</kbd>: Move the column to the right.
    *   <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>Left</kbd>: Move the column to the left.
    *   <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>Home</kbd>: Make it the first column.
    *   <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>End</kbd>: Make it the last column.
*   **Using the column menu:** Open the column menu and use the <span class="tn-icon bx bx-horizontal-left"></span> **Move column** submenu.

### Renaming and recoloring columns

To change the name of a column, open the column menu and select <span class="tn-icon bx bx-edit-alt"></span> **Rename column**, or press <kbd>F2</kbd> while the column header is selected.

From the same menu, you can tint the column with a different color by using the color palette at the bottom of the menu.

### Collapsing and expanding columns

#### Collapsing

A column can be collapsed (minimized) to occupy less space on the screen and make the board look less cluttered. This is particularly useful for columns that are not frequently used, or when you want to focus on only a few columns and keep the rest out of sight.

To collapse a column:

*   **Using a mouse:** Double-click the column header.
*   **Using touch:** Tap the column header, and then press the <span class="tn-icon bx bx-collapse-horizontal"></span> button on the side toolbar.
*   **Using the keyboard:** Focus the column header, and then press <kbd>Space</kbd>.

Alternatively, you can use the <span class="tn-icon bx bx-collapse-horizontal"></span> **Collapse column** command from the column menu.

Once a column is collapsed, its cards are no longer visible, but the column can still receive cards from other columns:

*   **Drop cards onto a collapsed column:** The cards will be moved to the column (at the bottom if manual sorting is enabled).
*   **Hold cards over a collapsed column for a few seconds:** The column will expand, allowing you to drop the cards at the desired position (if manual sorting is enabled) or peek at the other cards before deciding whether to drop them.
*   **Move a card to a collapsed column using the keyboard:** The column will temporarily expand to reveal the moved card. You can then continue moving the selected cards up or down, or to another column.

Collapsed columns can still be reordered, and their menus remain available.

#### Expanding

You can restore a collapsed column so that its content is visible again in the following ways:

*   **Using a mouse:** Click the collapsed column.
*   **Using touch:** Tap the collapsed column, and then press the <span class="tn-icon bx bx-expand-horizontal"></span> button on the side toolbar.
*   **Using the keyboard:** Move the focus to the collapsed column, and then press <kbd>Space</kbd>.

#### Keeping a column collapsed

By default, once a column is expanded, it remains expanded. However, you can configure a column to collapse again after you finish working with it. To activate this behavior, open the column menu and check <span class="tn-icon bx bx-lock-alt"></span> **Keep the column collapsed**.

A column configured to remain collapsed will expand like any other collapsed column, but only temporarily, until another column is focused.

#### Collapsing and expanding all columns

You can expand or collapse all columns at once by using the <span class="tn-icon bx bx-collapse-alt"></span> (collapse) and <span class="tn-icon bx bx-expand-alt"></span> (expand) buttons. On the desktop, these buttons are located at the bottom of the screen; on the mobile interface, they are in the header.

### Sorting cards within a column

By default, the cards in a column are sorted manually by moving them up and down. You can also keep them sorted automatically, using customizable criteria for each column. To customize the sorting options, open the **column menu** → **Sort**. The following options are available:

*   <span class="tn-icon bx bx-collection"></span> **Board's default**: Use the default sorting order (initially manual for new boards).
*   <span class="tn-icon bx bx-move-vertical"></span> **Manually**: Sort cards by manually moving them up and down.
*   <span class="tn-icon bx bx-text"></span> **Title**: Sort cards by title.
*   <span class="tn-icon bx bx-calendar-plus"></span> **Creation date & time**: Sort cards by the creation date and time of the note represented by each card. If a card was created from an existing note, the date and time will match the original creation date and time of that note, not when the card was added to the board.
*   **Any custom attribute**: Any card attribute (see <a class="reference-link" href="../Advanced%20Usage/Attributes.md">Attributes</a>) can be used as a sorting criterion.
*   <span class="tn-icon bx bx-sort-up"></span> **Ascending**: Sort from smallest to largest (A to Z, 0 to 9, or oldest to newest).
*   <span class="tn-icon bx bx-sort-down"></span> **Descending**: Sort in reverse order, from largest to smallest.

> [!IMPORTANT]
> The card order you set is preserved after you switch away from manual sorting. When you switch back to manual sorting, the cards will be in the same order in which you arranged them.

#### How card attributes are sorted

When cards are sorted by an attribute, they are ordered according to the following rules:

| Attribute type | Sort order (ascending) |
| --- | --- |
| Text, Multi-line text, URL, Email, Phone | A to Z, 0 to 9 |
| Number | lowest → greatest |
| Date, Date & time | oldest → newest |
| Time | earliest hour (closest to 0) → latest hour (closest to 24) |
| Boolean | unchecked → checked |
| Select | The order in which the options are declared.     <br>For example, a select attribute declared with “Low”, “Medium”, and “High” options will be sorted as follows: Low → Medium → High. |
| Color | Grays → colors. Colors are ordered by their color-wheel [hue](https://en.wikipedia.org/wiki/Hue) angle (from 0° to 360°). |

Relation attributes are ordered according to the title of the target note.

Cards with attributes that have no value set are always sorted at the end of the column, regardless of whether the sort order is ascending or descending. If an attribute holds more than one value, only the first value is used for sorting.

#### Configuring the default sorting options

Every new column uses the **Board's default** sorting option, which is initially set to manual sorting on new boards. However, the default can be changed to any other sorting criterion and direction. To configure it, go to **Note menu** → **Board properties** → **Default card order** (under the **General** section).

Once the default is changed, all columns set to the **Board's default** sorting option will follow the new sorting options.

Columns using a sorting option other than **Board's default** will not be affected by the new default. To override all columns so that they use the default sorting options, use the **Reset sorting options to default for all columns** command in Board properties.

> [!WARNING]
> Using the `#sorted` attribute on Kanban boards **is no longer recommended**, because it applies to every column and prevents manual sorting. Instead, use `#board:sortColumns`, which is designed exclusively for board collections and can take one of the following values: `title`, `creationDate`, or `attr:_<attribute name>_`, for example, `#board:sortColumns=attr:dueDate`. Using the `#board:sortColumnsDescending` label will switch to descending order.

### Setting a limit

For each column, you can limit the number of cards it contains (also known as a WIP limit). Once the limit is exceeded, the column displays a visual warning to indicate that it is over its limit.

To enable the limit, go to the column menu → <span class="tn-icon bx bx-tachometer"></span> **Set limit**, and then:

*   Turn on the **Warn for exceeding the column capacity** toggle.
*   Enter the desired limit in the **Maximum number of cards in the column** text box.
*   Press the **Set limit** button.

A column that has reached its limit can still accept new cards. Blocking new cards is not supported and most likely never will be, due to the way Trilium works: cards are regular notes, and the attributes used to group them into columns can be set from anywhere in the app, outside the board control. As a result, enforcing the limit would not be consistent.

### Archiving a column

If you want to hide a column from the board without deleting it, you can archive it by opening the **column menu** → <span class="tn-icon bx bx-archive-in"></span> **Archive column**. Archiving a column does not set the archived flag (see <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Notes/Archived%20Notes.md">Archived Notes</a>) on the notes corresponding to its cards.

To show archived columns again, go to <span class="tn-icon bx bx-cog"></span> **Collection options** and toggle <span class="tn-icon bx bx-archive-in"></span> **Show archived notes**. Archived columns will appear faded. To restore one, open its column menu and select <span class="tn-icon bx bx-archive-out"></span> **Unarchive column**.

### Deleting a column

You can delete a column by opening the **column menu** → <span class="tn-icon bx bx-trash"></span> **Delete column**, or by pressing <kbd>Delete</kbd> when a column header is focused, and then confirming. This removes the column from the board and unsets the grouping attribute for each note represented by a card in that column. If the column contains cards, the confirmation also offers to delete their notes instead of keeping them.

The inbox column is not deleted this way. Its menu entry is <span class="tn-icon bx bx-trash"></span> **Remove inbox column**, and <kbd>Delete</kbd> on its header hides the inbox without changing any card.

### The inbox column

The inbox column is a special column containing cards that are not assigned to another column. It is particularly useful when you switch an existing collection containing child notes to a board collection. The inbox column turns all child notes into cards that you can quickly distribute among the other columns. It can also act as a backlog where you can keep new cards that might eventually become part of the board.

The inbox column is hidden by default. To show it, go to <span class="tn-icon bx bx-cog"></span> **Collection options** and toggle **Show inbox column**. The inbox column is distinguishable by its transparent background. It is always the first column and cannot be moved. It does not support a card limit. Otherwise, it operates like a regular column: its title, icon, and color can be changed; it can be sorted manually or automatically; and it can be collapsed.

You can also show the inbox column by applying the `#board:showInbox` label (read more about <a class="reference-link" href="../Advanced%20Usage/Attributes.md">Attributes</a>) to the board note.

Optionally, the inbox column can also list nested notes from the board collection's subtree. To enable this, open the **column menu** and check <span class="tn-icon bx bx-subdirectory-right"></span> **Include nested notes**.

### Changing the width of columns

There are three predefined widths for board columns: narrow (default), medium, and wide. To change the width, open the **Note menu** → **Board properties** → **Column width** (under the **General** section). This option applies to every column on the board, except in the mobile version.

The same option is also available through the `#board:columnWidth` label (read more about <a class="reference-link" href="../Advanced%20Usage/Attributes.md">Attributes</a>) on the board note, which accepts “`narrow`”, “`medium`”, or “`wide`” as its value.

You can also redefine these three widths by using custom app CSS (read more about <a class="reference-link" href="../Theme%20development/Custom%20app-wide%20CSS.md">Custom app-wide CSS</a>) and assigning the desired pixel values as follows:

```
#trilium-app {
  --board-column-width-narrow: 275px;
  --board-column-width-medium: 325px;
  --board-column-width-wide: 400px;
}
```

## Working with cards

### Creating a new card

To create a new card, press the <span class="tn-icon bx bx-plus"></span>**New card** button located at the bottom of each column. To create a new card above or below a specific card, right-click or hold that card, and then select <span class="tn-icon bx bx-list-plus bx-flip-vertical"></span> **Insert new above** or <span class="tn-icon bx bx-list-plus"></span> **Insert new below** from the context menu. Alternatively, press <kbd>Shift</kbd> + <kbd>Enter</kbd> to create a new card above the focused card, or <kbd>Enter</kbd> to create one below it.

Next, type the title of the new card, and then press the <span class="tn-icon bx bx-plus-circle"></span> button or <kbd>Enter</kbd> to complete it. Tap or click anywhere outside the text box to dismiss it. You can also select a different icon and card template. To learn more about card templates, see Card templates (learn more about <a class="reference-link" href="../Advanced%20Usage/Templates.md">Templates</a>).

After the card is created, you can tap or click it, or press <kbd>Space</kbd>, to edit the note content.

When using the <span class="tn-icon bx bx-plus"></span> **New card** button, cards are always created at the end of the column. To create the card at the top of the column, right-click or hold the <span class="tn-icon bx bx-plus-circle"></span> button and select <span class="tn-icon bx bx-vertical-top"></span> **Create at top**. When using keyboard shortcuts, focus the column header and press <kbd>Enter</kbd> to create a new card at the start of the column, or <kbd>Shift</kbd> + <kbd>Enter</kbd> to create one at the end.

### Adding an existing note as a card

Any note in your knowledge base can be represented as a card on a board. To add an existing note to your board, create a new card but do not enter a title. Instead, press the <span class="tn-icon bx bx-folder-open"></span> button. Alternatively, use the <span class="tn-icon bx bx-folder-open"></span> **Add an existing note as a card** command from the column menu.

In the dialog that opens, search for the note by name, and then press the **Add to column** button to insert it. Alternatively, you can drag any note from the tree and drop it at the desired position on the board.

If the target note is already in the board collection's subtree, it will already be listed in the **inbox column**.

> [!IMPORTANT]
> Notes added to the board are cloned, not duplicated. This means that changes to their titles, content, and attributes on the board are reflected in their original locations as well. Learn more about cloned notes.

### Selecting multiple cards

When working with a board, you may need to perform operations on multiple cards at once, such as moving them to another column, setting attributes or colors, deleting them, or archiving them.

You can select multiple cards in the following ways:

*   **Using a mouse and keyboard:**
    *   To add a card to the selection, hold <kbd>Ctrl</kbd> and click the card. Repeat this for other cards until all the desired cards are selected. Clicking a selected card again while holding <kbd>Ctrl</kbd> will deselect it.
    *   If the cards you want to select form a continuous sequence within a column, hold <kbd>Shift</kbd>, click the first card in the sequence, and then click the last card.
    *   Press <kbd>Esc</kbd> to clear the selection.
*   **On mobile:**
    1.  To enter selection mode, tap the <span class="tn-icon bx bx-select-multiple"></span> button at the top of the screen. A selection toolbar will appear in the header, displaying “0 cards selected”.
    2.  Tap the cards you want to select. If you tap a selected card again, it will be deselected. To select all cards in a column, press the <span class="tn-icon bx bx-list-check"></span> button on the selection toolbar. To clear the selection, press the <span class="tn-icon bx bx-x"></span> button.
    3.  Use the side toolbar to apply actions to the selected cards.
*   **Using only the keyboard:**
    *   To add the currently focused card to the selection, press <kbd>Ctrl</kbd> + <kbd>Space</kbd>. Repeat this for the other cards you want to select. Pressing <kbd>Ctrl</kbd> + <kbd>Space</kbd> again on a selected card will deselect it.
    *   To select a continuous sequence of cards within a column, hold <kbd>Shift</kbd> and use the <kbd>Up</kbd> and <kbd>Down</kbd> arrow keys to expand or shrink the selection.
    *   To select every card in the column the focus is in, press <kbd>Ctrl</kbd> + <kbd>A</kbd>. The same action is available from the column menu, as <span class="tn-icon bx bx-selection"></span> **Select all cards**.
    *   Press <kbd>Esc</kbd> to clear the selection.

### Moving cards between columns

To move one or more cards to another column, use one of the following methods:

#### Using touch or a mouse

Touch and hold the card, or click and hold it with the mouse, and then drag it to the desired column. If the column uses manual sorting, you can also position the card relative to the other cards.

> [!TIP]
> To drag a card outside the board, for example to the note tree, another split, or another window, hold <kbd>Ctrl</kbd> and then start dragging.

If the target column is collapsed, you can drop the card onto its header to move it into that column (at the end if manually sorted), without expanding it. However, if you want to reveal its cards before dropping, hold the card over the column for a few seconds; the column will then expand.

> [!TIP]
> **You can quickly drop a card at the start or end of a column.**
> 
> Drop the card above the column while the “Drop as the first card” hint is displayed to make it the first card in that column. Alternatively, drop it below the column while the “Drop as the last card” hint is displayed to make it the last card.

#### Using the keyboard

You can also use keyboard shortcuts to move the selected card or cards between columns:

*   <kbd>Ctrl</kbd> + <kbd>Right</kbd>: Move to the next column.
*   <kbd>Ctrl</kbd> + <kbd>Left</kbd>: Move to the previous column.
*   <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Right</kbd>: Move to the last column.
*   <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Left</kbd>: Move to the first column.

#### Using the context menu

To quickly move a card to another column, open the card's context menu and select the destination column. The menu lists the first seven columns; on a wider board, the remaining ones are grouped under **More…**.

### Reordering cards within a column

Cards within a column can be freely reordered unless the column uses a sorting option other than manual. To reposition a card, drag it as described in the **Moving cards between columns** section and drop it at the desired position.

Alternatively, you can use keyboard shortcuts to move the selected card or cards:

*   <kbd>Ctrl</kbd> + <kbd>Up</kbd>: Move up.
*   <kbd>Ctrl</kbd> + <kbd>Down</kbd>: Move down.
*   <kbd>Ctrl</kbd> + <kbd>Home</kbd>: Move to the top of the column.
*   <kbd>Ctrl</kbd> + <kbd>End</kbd>: Move to the end of the column.

If multiple cards are selected, the keyboard shortcuts work only if the selection consists of a continuous sequence of cards.

### Editing a card

Every card on a board is a regular note. To edit the note associated with a card, click or tap the card, or press <kbd>Space</kbd> when the card is selected. The note will open in a Quick Edit dialog, where you can modify it. You can also open the note in a new tab, split, or window by using the <span class="tn-icon bx bx-link-external"></span> **Open note** submenu in the card's context menu. To open the note in a new tab on the desktop version, you can also click or tap the <span class="tn-icon bx bx-link-external"></span> **Open note** menu item directly, without opening its submenu.

To change the title or icon of a card, use one of the following methods:

*   **Using a mouse:** Place the mouse pointer over the card, and then click the <span class="tn-icon bx bx-rename"></span> button.
*   **On mobile:** Hold the card until the side toolbar appears, and then tap the <span class="tn-icon bx bx-rename"></span> button.
*   **Using the keyboard:** Select a card, and then press <kbd>F2</kbd>.
*   **Using the context menu:** Open the card's context menu and select <span class="tn-icon bx bx-rename"></span> **Edit title & icon**.

You can then enter a new name and select another icon. To move the keyboard focus from the title field to the icon selector, press <kbd>Shift</kbd> + <kbd>Tab</kbd>. Click or tap anywhere outside the card, or press <kbd>Enter</kbd>, to apply the change. Press <kbd>Esc</kbd> to discard the changes.

Each card can be tinted with a different color. Open the card's context menu and select the desired color. If no color is assigned, the card inherits the column color.

> [!IMPORTANT]
> The title, icon, and color of a card are the same as those of the corresponding note. If that note exists in multiple locations in the tree, any change to its title, icon, or color on the board will apply in those locations as well, not only on the board.

### Archiving a card

A card can be hidden from the board without deleting it by using the <span class="tn-icon bx bx-archive-in"></span> **Archive note** command from the card's context menu.

To show archived cards again, go to <span class="tn-icon bx bx-cog"></span> **Collection options** and toggle <span class="tn-icon bx bx-archive-in"></span> **Show archived notes**. Archived cards will appear faded. To restore one, open its context menu and select <span class="tn-icon bx bx-archive-out"></span> **Unarchive note**.

> [!WARNING]
> Archiving a card sets the `#archived` flag on its note. If the note exists in multiple locations in the tree, it will appear archived in those locations as well. Read more about <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Notes/Archived%20Notes.md">Archived Notes</a>.

### Deleting a card

You can remove one or more cards from the board and delete their associated notes by using the <span class="tn-icon bx bx-trash"></span> **Delete note…** command from the card's context menu, or by pressing <kbd>Shift</kbd> + <kbd>Delete</kbd>. On mobile, hold the card until the side toolbar appears, and then tap the <span class="tn-icon bx bx-trash"></span> button.

#### Removing a card from the board without deleting the note

To remove a card from the board's columns while keeping its note, open the card's context menu and select <span class="tn-icon bx bx-task-x"></span> **Remove from column**, or press <kbd>Delete</kbd>. On mobile, hold the card until the side toolbar appears, and then tap the <span class="tn-icon bx bx-task-x"></span> button.

This command is not available when the inbox column is enabled. Instead, drag the card to the inbox column to achieve the same result.

The note remains in the board collection but is not assigned to any column. To see it on the board again, enable the inbox column.

> [!NOTE]
> Under the hood, removing a card simply unsets the note's grouping attribute.

### Working with custom card attributes

By default, the face of a card displays a minimal set of information: the title, icon, and color. In some cases, this may not provide enough useful information at a glance. You can extend the card to display extra information, called card attributes, such as a due date, priority, completion status, or any other information you need. Card attributes use the same principles as <a class="reference-link" href="../Advanced%20Usage/Attributes/Promoted%20Attributes.md">Promoted Attributes</a>.

#### Creating a new attribute

To create a new attribute, follow these steps:

1.  Go to **Note menu** → **Board properties**, find the **Card attributes** section, and then press the <span class="tn-icon bx bx-plus"></span> **Create a new attribute** button.
2.  Enter a name for the attribute. This is the internal name used by Trilium, so do not use spaces or special characters.
3.  Select a type (text, number, boolean, and so on).
4.  Set the display name. This is the name shown on the card.
5.  Press **Save & close**.

> [!NOTE]
> For each newly created attribute, Trilium creates an attribute definition on the board collection note. For an attribute to be displayed on the face of a card, it must be declared as inheritable and promoted on the board note.

Here is an example of the attributes you can define for a typical Kanban board used to track tasks:

| Attribute name | Attribute type | Attribute display name |
| --- | --- | --- |
| dueDate | Date & Time | Due date |
| priority | Select (options: Low, Medium, High, Urgent) | Priority |
| done | Boolean | Done |

#### Modifying the values of custom attributes

To set the value of a custom attribute, click or tap the card, and then enter or select the desired value in the dialog header.

For attributes of the “select” or “boolean” type, you can quickly change the value by using the card's context menu under the **Attributes** section.

#### Reordering, hiding, redefining, and deleting custom attributes

Go to **Note menu** → **Board properties**. Under the **Card attributes** section, you can:

*   Hold the **\=** handle shown beside an attribute, and then drag the item up or down to reorder the attributes. This determines the order in which the attributes are displayed on the card.
*   Turn off the toggle to hide an attribute from the card's face. The attribute remains available when you edit the card. For the current grouping attribute, the toggle is disabled.
*   Press the <span class="tn-icon bx bxs-edit"></span> button to modify the definition of an attribute.
*   Press the <span class="tn-icon bx bx-trash"></span> button to delete the attribute and all its values from every note in the board collection.

### Managing card templates

When you create a new card, Trilium offers four templates by default: **Text**, **Markdown**, **Canvas**, and **Spreadsheet**. You can customize this list to include other note types or custom templates with predefined placeholder content and prefilled card attributes.

To customize the card templates, go to **Note menu** → **Board properties** and find **Card templates**. Here you can:

*   Include a note type or note template already created in your knowledge base by pressing the <span class="tn-icon bx bx-list-plus"></span> **Add existing template** button and then selecting the desired note type or template.
*   Create a new template by pressing the <span class="tn-icon bx bx-plus"></span> **Create a new template** button. The template editor will open, where you can define the icon, title, default attribute values, and default content. The note template will be created as a child of the board collection.
*   Press the <span class="tn-icon bx bx-x"></span> button to remove a template from the list. The template is removed only from the list, not deleted from your knowledge base. You can add it again using <span class="tn-icon bx bx-list-plus"></span> **Add existing template**.
*   Press the <span class="tn-icon bx bx-dots-vertical-rounded"></span> button to open a dropdown that lets you edit, open in a new window, duplicate, or delete a template. This button is visible only for custom note templates.
*   Hold the **\=** handle shown beside a template, and then drag the item up or down to reorder the templates. This determines the order in which templates are listed in the template dropdown when you create a new card. You can move the most frequently used templates to the top for faster access.

### Grouping cards

On a board, cards are grouped into columns. The column to which a card belongs is determined by the value of the **grouping attribute**, which is a regular attribute of the card's note.

By default, boards use the **Status** attribute as the grouping attribute. When you move a card to a column called “Waiting on Customer”, the card's Status attribute is set to “Waiting on Customer”.

> [!NOTE]
> Under the hood, the Status attribute is declared on the board collection note with the name `status`. It is a select-type attribute that is inheritable and promoted. Each select option becomes a column, and each new column created on the board extends the list of options.

#### Creating a new grouping attribute

To quickly create a new grouping attribute:

1.  Open the <span class="tn-icon bx bx-category-alt"></span> **Group by** dropdown in the board header and select <span class="tn-icon bx bx-plus"></span> **Create a new attribute**.
2.  Fill in the **Name** field. This is used internally by Trilium, so do not use spaces or special characters.
3.  Enter the **Display name**. This is the attribute name shown in the dropdown list.
4.  Press **Save & close**.

> [!TIP]
> Because the grouping attribute is a regular card attribute, you can also create it in **Board properties**. Make sure you set the attribute type to “select”.

#### Switching the grouping attribute

Switching the grouping attribute lets you view your cards by priority, category, or any other custom grouping attribute. You can switch the grouping attribute at any time by using the <span class="tn-icon bx bx-category-alt"></span> **Group by** dropdown in the board header. You can also change it using the `#board:groupBy=<_attribute name_>` label.

> [!WARNING]
> The order of cards in manually sorted columns corresponds to their positions within the board collection subtree. This means that the card order is shared across all views, regardless of the grouping attribute. Reordering notes in one view will also reorder them in other views that use a different grouping attribute.

#### Deleting a grouping attribute

To delete a grouping attribute, go to **Note menu** → **Board properties**, find the attribute under the **Card attributes** section, and press the corresponding <span class="tn-icon bx bx-trash"></span> button.

#### Grouping by relations

A more advanced use case is grouping by [Relations](../Advanced%20Usage/Attributes/Relations.md).

In this mode:

*   The columns represent the _target notes_ of a relation.
*   When creating a new column, you select a note instead of entering a column name.
*   The column icon matches the target note.
*   Moving notes between columns changes their relations.
*   Renaming an existing column changes the target note for all notes in that column.

Using relations instead of labels has several benefits:

*   The status or grouping of notes is visible outside the Kanban board, for example, on the <a class="reference-link" href="../Note%20Types/Note%20Map.md">Note Map</a>.
*   A column takes its title and icon from the target note, so renaming that note anywhere in the tree renames the column.

To use relations for grouping:

1.  Create a Kanban board from scratch rather than from a template.
2.  Assign `#viewType=board #hidePromotedAttributes` to emulate the default template.
3.  Set `#board:groupBy` to the name of a relation, **including the** `~` **prefix** (for example, `~status`).
4.  Optionally, use <a class="reference-link" href="../Advanced%20Usage/Attributes/Promoted%20Attributes.md">Promoted Attributes</a> to make changing the status within the note easier:
    
    ```
    #relation:status(inheritable)="promoted,alias=Status,single"
    ```

## Searching and filtering the board

You can search for cards using the search box at the top of the board. Enter your keywords, and then press the <span class="tn-icon bx bx-search"></span> button in the search field or press <kbd>Enter</kbd>. Only cards whose titles, content, or attribute values match the query will be displayed. Columns without results will be temporarily collapsed to make room for the matching cards. Press the <span class="tn-icon bx bx-x"></span> button in the search field to clear the search and display all cards again.

### Advanced filtering

If you need to refine the view to display only cards matching specific criteria beyond a regular text search, you can use Trilium's search query syntax. Here are some example queries:

Display only cards whose **Priority** attribute is set to “Low”:

```
#priority=Low
```

Display only cards whose **Issue Category** is set to “Software” and whose **Site** is set to either “Office” or “Factory”:

```
#issueCategory="Software" AND (#site="Office" OR #site="Factory")
```

Display only cards with a **Due Date** in the next seven days that are not yet marked as **Done**:

```
#dueDate >= TODAY AND #dueDate <= TODAY+7 AND #!done
```

The filter persists even after you close the tab. When you reopen the collection, the filter remains active until you clear the search query by using the <span class="tn-icon bx bx-x"></span> button.

## Linking to a column or a card

You can create a link that opens the board and points out a specific column or card. Open the **column menu** or the card’s context menu, select <span class="tn-icon bx bx-copy"></span> **Copy reference**, and then paste the link where you need it.

In a text note, the pasted link displays the title, icon, and color of the column or card it points to. In a Markdown or code note, the plain link address is pasted instead. Opening the link scrolls the board to the column or card and focuses it. If the column belongs to a different grouping attribute, the board switches to that attribute first.