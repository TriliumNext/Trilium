# Block references
Block references are [links](Links.md) to a block of a text note, such as a paragraph, a heading, a list item or a table, or to a range of consecutive blocks. A block reference can be pasted in another note as a link, or turned into an <a class="reference-link" href="Include%20Note.md">Include Note</a> that shows only the referenced blocks.

## Copying a reference

1.  Place the cursor in the block to reference. To reference several consecutive blocks, select them.
2.  Right-click the block handle, the sequence of dots to the left of the block (see <a class="reference-link" href="Formatting%20toolbar.md">Formatting toolbar</a>).
3.  Select _Copy reference to this block_, or _Copy reference to these blocks_ for a selection. The referenced blocks flash briefly.
4.  Go to the note where to insert the link and press <kbd>Ctrl</kbd>+<kbd>V</kbd>.

The link shows the title of the note, followed by the beginning of the referenced text.

## Following a reference

Clicking a block reference opens the note, scrolls to the referenced blocks and flashes them. If a referenced block was deleted, an error message is shown instead, along with the blocks of the range that still exist.

## Including the referenced blocks

To show the referenced blocks inside another note, right-click the link in a note being edited and select _Convert link to an included note_. The include shows only the referenced blocks, not the rest of the note. Converting the include back to a link keeps the reference.

If a referenced block was deleted, the include shows _Broken reference_.

## Limitations

*   References can be copied only from a note being edited, and not in the mobile layout, since the block handle is not shown there.
*   An include of referenced blocks cannot be edited in place.
*   Deleting a block breaks the references to it.
*   Block references are not kept when exporting to Markdown. On a [shared page](../../Advanced%20Usage/Sharing.md), a block reference opens the whole note.