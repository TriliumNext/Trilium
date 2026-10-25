# Note Tree
This page explains how to manipulate the note tree in TriliumNext, focusing on moving notes.

![](Note%20Tree_image.jpg)

## Drag and Drop

![Drag and drop example](Note%20Tree_drag-and-drop.gif)

You can easily rearrange the note tree by dragging and dropping notes, as demonstrated in the example above.

### Importing files

A file or archive can easily be imported into Trilium just by dragging it inside the note tree.

Note that a drag & drop always imports with _safe import_ on, meaning that some features such as scripts are disabled in the upcoming notes. To bypass that, use the dedicated [import](../Import%20%26%20Export.md) feature (right click → _Import into note_).

Unlike the import dialog, the drag & drop also has some basic auto-detection of the import. For example, dragging a .zip file with a `.obsidian` folder in it will automatically trigger a dedicated <a class="reference-link" href="../Import%20%26%20Export/Importing%20data%20from%20other%20applications/Obsidian.md">Obsidian</a> import.

## Keyboard Manipulation

![Example of using keyboard keys to move a note](Note%20Tree_move-note-with-keyboard.gif)Trilium offers efficient keyboard-based manipulation using the following [shortcuts](../Keyboard%20Shortcuts.md):

*   <kbd>Ctrl</kbd> + <kbd>↑</kbd> and <kbd>Ctrl</kbd> +<kbd>↓</kbd>: Move the note up or down in the order.
*   <kbd>Ctrl</kbd>+<kbd>←</kbd>: Move the note up in the hierarchy by changing its parent to the note's grandparent.
*   <kbd>Ctrl</kbd>+<kbd>→</kbd>: Move the note down in the hierarchy by setting its parent to the note currently above it (this action is best understood through a demo or hands-on experience).
*   <kbd>←</kbd> and <kbd>→</kbd>: Expand and collapse a sub-tree.

## Context Menu

You can also move notes using the familiar cut and paste functions available in the context menu, or with the associated keyboard [shortcuts](../Keyboard%20Shortcuts.md): `CTRL-C` ( [copy](../Notes/Cloning%20Notes.md)), <kbd>Ctrl</kbd> + <kbd>X</kbd> (cut) and <kbd>Ctrl</kbd> + <kbd>V</kbd> (paste).

See <a class="reference-link" href="Note%20Tree/Note%20tree%20contextual%20menu.md">Note tree contextual menu</a> for more information.

## Tree Settings

Click the tree icon in the tree toolbar to open the tree settings popup. Each option takes effect as soon as it is changed:

*   _Display density_: _Relaxed_ (default) or _Dense_. Dense rows are shorter, so more notes fit on the screen. This setting is not synchronized, so each device keeps its own.
*   _Hide archived notes_: When enabled, archived notes are not shown in the tree.
*   _Automatically collapse notes_: When enabled, notes are collapsed after a period of inactivity to keep the tree tidy.
*   _Follow active note_: When enabled (default), the tree automatically scrolls and expands parent nodes to keep the currently active note visible. When disabled, the tree is fully detached from navigation — only the background highlight of the active note is updated, but the tree viewport and its expanded/collapsed state are never changed by navigation. Use the crosshair button to manually jump the tree to the active note at any time.

## Hiding and peeking the tree

To hide or show the note tree, press the <span class="tn-icon bx bx-sidebar"></span> button to the left of the first tab in the horizontal layout, or the <span class="tn-icon bx bx-chevrons-left"></span> button at the bottom of the <a class="reference-link" href="Launch%20Bar.md">Launch Bar</a> in the vertical layout. The _Toggle Left Pane_ [keyboard shortcut](../Keyboard%20Shortcuts.md), which is not assigned by default, does the same. See <a class="reference-link" href="Vertical%20and%20horizontal%20layout.md">Vertical and horizontal layout</a>.

A small strip with an arrow icon runs along the left edge of the app in the horizontal layout. In the vertical layout, it runs along the right side of the <a class="reference-link" href="Launch%20Bar.md">Launch Bar</a>, and only shows while the tree is hidden.

*   When the tree is hidden, pressing the strip will _peek_ the tree.
    *   In this mode the tree is shown temporarily above the content, without shifting the content of your notes.
    *   Clicking outside the tree, pressing <kbd>Esc</kbd> or pressing the strip again will hide the tree.
    *   Pressing the button that shows the tree will dock it.
*   In the horizontal layout, pressing the strip while the tree is docked will hide it.

The _Peek Tree Pane_ [keyboard shortcut](../Keyboard%20Shortcuts.md), <kbd>Alt</kbd>+<kbd>[</kbd> by default, does the same as pressing the strip. Only one panel is peeked at a time: peeking the tree hides a peeked <a class="reference-link" href="Right%20Sidebar.md">Right Sidebar</a>, and the other way around.

## Keyboard shortcuts

The note tree comes with multiple keyboard shortcuts to make editing faster, consult the dedicated <a class="reference-link" href="Note%20Tree/Keyboard%20shortcuts.md">Keyboard shortcuts</a> section.