# Anchors
> [!NOTE]
> This feature used to be called _Bookmarks_ (as it is the official name in the editor we are using), but in order not to collide with the concept of <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Navigation/Bookmarks.md">Bookmarks</a>, we have renamed it to _Anchors._

Anchors allows creating [links](Links.md) to a certain part of a note, such as referencing a particular heading or section within a note.

This feature was introduced in TriliumNext v0.94.0 and augmented in v0.103.0 to support linking across notes.

## Interaction

*   To create a anchor:
    *   Place the cursor at the desired position where to place the anchor.
    *   Look for the <img src="Anchors_plus.png" width="15" height="16"> button in the <a class="reference-link" href="Formatting%20toolbar.md">Formatting toolbar</a>, and then press the <img src="1_Anchors_plus.png" width="12" height="15"> button.
    *   Alternatively, use <a class="reference-link" href="Premium%20features/Slash%20Commands.md">Slash Commands</a> and look for _anchor_.
*   To place a link to a anchor:
    *   Place the cursor at the desired position of the link.
    *   From the [link](Links.md) pane, select the _Anchors_ section and select the desired anchor.

## Linking across notes

Trilium v0.103.0 introduces cross-note Anchors, which makes it possible to create <a class="reference-link" href="Links/Internal%20(reference)%20links.md">Internal (reference) links</a> which point to a specific anchor in that document.

### Compatibility with documents from previous versions

For notes created prior to Trilium v0.103.0, you might notice that the Anchors might not be identified. This limitation is intentional in order not to have to re-process all the notes, looking for anchors.

To fix this, simply go that note and make any change (e.g. inserting a space), this will trigger the recalculation of the links.

### Linking to anchors through the _Add link_ dialog

1.  Create an anchor in the target note using the same process as described above.
2.  In another note, press <kbd>Ctrl</kbd>+<kbd>L</kbd> to insert an internal link. Select the target note containing Anchors.
3.  If the target note contains Anchors, a section will appear underneath the note selector with the list of Anchors.
4.  Add the link normally.

Clicking on a reference link pointing to a anchor will automatically scroll to the desired section.

### Linking to anchors through the bookmark toolbar

1.  Create an anchor in the target note using the same process as described above.
2.  Click on the anchor to reveal the anchor's floating toolbar.
3.  Click on the _Copy anchor reference link_ button.
4.  Go to the note where to insert the link and press <kbd>Ctrl</kbd>+<kbd>V</kbd>.

> [!NOTE]
> Use this method only to insert <a class="reference-link" href="Links/Internal%20(reference)%20links.md">Internal (reference) links</a> between two documents. To link to an anchor on the same note, use the _Insert link_ dialog (<kbd>Ctrl</kbd>+<kbd>K</kbd>) and select the _Anchors_ item instead.