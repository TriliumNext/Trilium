# Split View
In Trilium, is possible to work with two or more notes side-by-side.

<figure class="image image-style-align-center"><img style="aspect-ratio:1398/1015;" src="Split View_2_Split View_im.png" width="1398" height="1015"></figure>

## **Interactions**

*   Press the ![](Split%20View_Split%20View_imag.png) button to the right of a note's title to open a new split to the right of it.
    *   It is possible to have as many splits as desired, simply press again the button.
    *   Only horizontal splits are possible, vertical or drag & dropping is not supported.
*   When at least one split is open, press the ![](Split%20View_3_Split%20View_im.png) button next to it to close it.
*   Use the ![](Split%20View_4_Split%20View_im.png) or the ![](Split%20View_1_Split%20View_im.png) button to move around the splits.
*   Each [tab](Tabs.md) has its own split view configuration (e.g. one tab can have two notes in a split view, whereas the others are one-note views).
    *   The tab will indicate only the title of the main note (the first one in the list).

## Splits and the note tree & hoisting

Clicking on the content of a split will focus that split. While focused, the <a class="reference-link" href="Note%20Tree.md">Note Tree</a> will also indicate the note that is being edited.

It is possible for each of the splits to have their own <a class="reference-link" href="../Navigation/Note%20Hoisting.md">Note Hoisting</a>.

When a new split is created, it will share the same note hoisting as the previous one. An easy solution to this is to simply hoist the notes after the split is created.

This is generally quite useful for reorganizing notes from one place to the other, by hoisting the old place in the first split and hoisting the new place to the second one. This will allow easy cut and paste without the tree jumping around from switching between notes.

## Mobile support

Since v0.100.0, it's possible to have a split view on the mobile view as well, with the following differences from the desktop version of the split:

*   On smartphones, the split views are laid out vertically (one on the top and one on the bottom), instead of horizontally as on the desktop.
*   There can be only one split open per tab.
*   It's not possible to resize the two split panes.
*   When the keyboard is opened, the active note will be “maximized”, thus allowing for more space even when a split is open. When the keyboard is closed, the splits become equal in size again.

Interaction:

*   To create a new split, click the three dots button on the right of the note title and select _Create new split_.
    *   This option will only be available if there is no split already open in the current tab.
*   To close a split, click the three dots button on the right of the note title and select _Close this pane_.
    *   Note that this option will only be available on the second note in the split (the one at the bottom on smartphones, the one on the right on tablets).
*   When long-pressing a link, a contextual menu will show up with an option to _Open note in a new split_.
    *   If there's already a split, the option will replace the existing split instead.