# Note Tree
This page explains how to manipulate the note tree in TriliumNext, focusing on moving notes.

![](Note%20Tree_image.png)

## Drag and Drop

![Drag and drop example](Note%20Tree_drag-and-drop.gif)

You can easily rearrange the note tree by dragging and dropping notes, as demonstrated in the example above.

## Keyboard Manipulation

![Example of using keyboard keys to move a note](Note%20Tree_move-note-with-keyboard.gif)Trilium offers efficient keyboard-based manipulation using the following [shortcuts](../Keyboard%20Shortcuts.md):

*   <kbd>Ctrl</kbd> + <kbd><span>↑</span></kbd> and <kbd>Ctrl</kbd> +<kbd><span>↓</span></kbd>: Move the note up or down in the order.
*   <kbd>Ctrl</kbd>+<kbd><span>←</span></kbd>: Move the note up in the hierarchy by changing its parent to the note's grandparent.
*   <kbd>Ctrl</kbd>+<kbd><span>→</span></kbd>: Move the note down in the hierarchy by setting its parent to the note currently above it (this action is best understood through a demo or hands-on experience).
*   <kbd><span>←</span></kbd> and <kbd><span>→</span></kbd>: Expand and collapse a sub-tree.

## Context Menu

You can also move notes using the familiar cut and paste functions available in the context menu, or with the associated keyboard [shortcuts](../Keyboard%20Shortcuts.md): `CTRL-C` ( [copy](../Notes/Cloning%20Notes.md)), <kbd>Ctrl</kbd> + <kbd>X</kbd> (cut) and <kbd>Ctrl</kbd> + <kbd>V</kbd> (paste).

See <a class="reference-link" href="Note%20Tree/Note%20tree%20contextual%20menu.md">Note tree contextual menu</a> for more information.

## Tree Settings

Click the tree icon in the tree toolbar to open the tree settings popup. It contains the following options:

*   **Hide archived notes**: When enabled, archived notes are not shown in the tree.
*   **Automatically collapse notes**: When enabled, notes are collapsed after a period of inactivity to keep the tree tidy.
*   **Follow active note**: When enabled (default), the tree automatically scrolls and expands parent nodes to keep the currently active note visible. When disabled, the tree is fully detached from navigation — only the background highlight of the active note is updated, but the tree viewport and its expanded/collapsed state are never changed by navigation. Use the crosshair button to manually jump the tree to the active note at any time.

## Keyboard shortcuts

The note tree comes with multiple keyboard shortcuts to make editing faster, consult the dedicated <a class="reference-link" href="Note%20Tree/Keyboard%20shortcuts.md">Keyboard shortcuts</a> section.