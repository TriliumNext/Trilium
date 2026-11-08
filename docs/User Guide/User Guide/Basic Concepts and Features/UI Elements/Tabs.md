# Tabs
<figure class="image image-style-align-center"><img style="aspect-ratio:1119/43;" src="Tabs_image.png" width="1119" height="43"></figure>

In Trilium, tabs allow easy switching between notes.

## Layout

Depending on the <a class="reference-link" href="Vertical%20and%20horizontal%20layout.md">Vertical and horizontal layout</a>:

*   For the vertical layout, the tabs will be placed at the top but to the right of the <a class="reference-link" href="Note%20Tree.md">Note Tree</a>.
*   For the horizontal layout, the tabs will be placed at the top in full-width, above the [note tree](Note%20Tree.md), allowing for more tabs to be comfortably displayed.

## Interaction

*   To create a new tab, press the <span class="tn-icon bx bx-plus"></span> button that is to the right of the last tab.
*   Right-clicking or pressing and holding the <span class="tn-icon bx bx-plus"></span> button shows a menu with:
    *   _New tab_.
    *   If there are any <a class="reference-link" href="../Navigation/Workspaces.md">Workspaces</a>, one entry per workspace, which opens the workspace in a new tab, hoisted into it.
    *   _Recently changed notes_: up to 15 notes, the most recently changed first, with the path of each note on the right. Notes that are already open in a tab are not listed, and in a [hoisted note](../Navigation/Note%20Hoisting.md) only its descendants are. Selecting a note opens it in a new tab.
    *   _All recent changes_, which opens the <a class="reference-link" href="Recent%20Changes.md">Recent Changes</a> dialog.
*   To close a tab, press the corresponding <span class="tn-icon bx bx-x"></span> button.
*   For multitasking, tabs can be used alongside <a class="reference-link" href="Split%20View.md">Split View</a>. Each tab can have one or more notes, displayed horizontally.
*   Tabs can be reordered by drag-and-dropping it into a new position.
*   An existing tab can be displayed in a new window by dragging the tab upwards or downwards. It is not possible to combine tabs back into another window.

## Keyboard interaction

Since tabs are a commonly used feature, there are multiple keyboard shortcuts that can be used:

*   <kbd>Ctrl</kbd>+<kbd>T</kbd> to open a new tab.
*   <kbd>Ctrl</kbd>+<kbd>W</kbd> to close the current tab.
*   <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd> to reopen the last closed tab.
*   <kbd>Ctrl</kbd>+<kbd>Tab</kbd> and <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Tab</kbd> to go to the next or previous tab.
*   <kbd>Ctrl</kbd>+<kbd>1</kbd>, <kbd>Ctrl</kbd>+<kbd>2</kbd>, up to <kbd>Ctrl</kbd>+<kbd>9</kbd> to activate the first, second and up to ninth tab.
*   There is also a shortcut to go to the last tab, but it is not assigned a key by default.

## Full screen

To show Trilium in full screen, press <kbd>F11</kbd> or the <span class="tn-icon bx bx-expand-alt"></span> _Fullscreen_ button in the <a class="reference-link" href="Global%20menu.md">Global menu</a>. While in full screen, the tab bar shows a <span class="tn-icon bx bx-exit-fullscreen"></span> _Leave full screen_ button before the <a class="reference-link" href="Right%20Sidebar.md">Right Sidebar</a> toggle; press it to return to the normal window.

## Background tabs

When Trilium starts, it reopens the tabs from the previous session. Only the active tab loads its note right away; every other tab loads its note the first time you switch to it. This keeps startup fast when many tabs are open, especially tabs that show collections.

The same applies to a tab opened in the background, for example with a middle click or <kbd>Ctrl</kbd>+click on a link.

## Mobile

<figure class="image image-style-align-right image_resized" style="width:34.12%;"><img style="aspect-ratio:1242/2688;" src="Tabs_IMG_1767.PNG" width="1242" height="2688"></figure>

Tabs are also supported on the <a class="reference-link" href="../../Installation%20%26%20Setup/Mobile%20Frontend.md">Mobile Frontend</a>.

Since v0.102.0, the tabs are displayed by pressing the dedicated tab switcher button in the <a class="reference-link" href="Launch%20Bar.md">Launch Bar</a>. In this view the tabs are laid out on a grid with a preview of the note content. On a phone, a tab left on the note tree shows the folder it was on instead, with the tab's note highlighted. Swiping left or right on the launch bar goes to the next or previous tab directly, as long as all of its buttons fit on the screen, with the page following the finger until it lets go.

The context menu button at the top-right of the popup allows creating a new tab, reopening the last closed tab and closing all the tabs.

<a class="reference-link" href="Split%20View.md">Split View</a>s are also indicated in the tab switcher, with two titles displayed in a tab.

> [!NOTE]
> Versions prior to v0.102.0 also supported tabs, but they were displayed directly above the <a class="reference-link" href="Launch%20Bar.md">Launch Bar</a>. The decision to use a more mobile-like tab switcher was taken because the original tab bar could not support many tabs at once and the new design better aligns with how mobile applications handle tabs.