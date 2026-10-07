# Block references
Block references are [links](Links.md) to a block of a text note, such as a paragraph, a heading, a list item or a table, or to a range of consecutive blocks. A block reference can be pasted in another note as a link, or turned into an <a class="reference-link" href="Include%20Note.md">Include Note</a> that shows only the referenced blocks.

## Copying a reference

1.  Place the cursor in the block to reference. To reference several consecutive blocks, select them.
2.  Right-click the block handle, the sequence of dots to the left of the block (see <a class="reference-link" href="Formatting%20toolbar.md">Formatting toolbar</a>). Alternatively, right-click the text and open the _Copy_ submenu.
3.  Select _Copy reference to this block_, or _Copy reference to these blocks_ for a selection. The referenced blocks flash briefly.
4.  Go to the note where to insert the link and press <kbd>Ctrl</kbd>+<kbd>V</kbd>.

The link shows the title of the note, followed by the beginning of the referenced text. A link to blocks of the same note shows only the beginning of the referenced text.

The _Paste_ submenu of the context menu offers two more ways to insert a copied reference:

*   _Paste reference as a link_ inserts only the link, even when the reference was copied as plain text or along with other content.
*   _Paste reference as an excerpt_ inserts an include of the referenced blocks, as described below.

In a browser, the context menu of the text editor opens only when right-clicking selected text. Elsewhere the browser shows its own menu.

## Following a reference

Clicking a block reference opens the note, scrolls to the referenced blocks and flashes them. If a referenced block was deleted, an error message is shown instead, along with the blocks of the range that still exist.

## Including the referenced blocks

To show the referenced blocks inside another note, right-click the link in a note being edited and select _Convert link to note excerpt_, or paste the copied reference with _Paste_ → _Paste reference as an excerpt_. The include shows only the referenced blocks, not the rest of the note, and marks them with an _Excerpt_ badge in its title. To see the whole note, press the <span class="tn-icon bx bx-link-external"></span> button in the same title, which opens the note in a new tab. Converting the include back to a link keeps the reference.

To edit the referenced blocks without leaving the note, turn on _Editable_ in the toolbar of the include, as for any <a class="reference-link" href="Include%20Note.md">Include Note</a>. The changes are saved to the referenced blocks, and the rest of the note stays as it is.

If a referenced block was deleted, the include shows _Broken reference_.

## Limitations

*   References can be copied only from a note being edited, and not in the mobile layout.
*   An include of a range that covers only part of a list or a quote, such as from its second item to a paragraph after it, cannot be edited in place.
*   Deleting a block breaks the references to it.
*   Block references are not kept when exporting to Markdown. On a [shared page](../../Advanced%20Usage/Sharing.md), a block reference opens the whole note.