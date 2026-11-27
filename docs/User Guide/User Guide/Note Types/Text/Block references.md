# Block references
A block reference [links](Links.md) to a block in a text or Markdown note, such as a paragraph, a heading, a list item or a table, or to a range of consecutive blocks. A block reference can be pasted in another note as a link, or turned into an <a class="reference-link" href="Include%20Note.md">Include Note</a> that shows only the referenced blocks. For Markdown notes, see _Reference anchors_ in <a class="reference-link" href="../Markdown.md">Markdown</a>.

## Copying a reference

1.  Place the cursor in the block to reference. To reference several consecutive blocks, select them.
2.  Right-click the block handle, the sequence of dots to the left of the block (see <a class="reference-link" href="Formatting%20toolbar.md">Formatting toolbar</a>), and select _Copy reference_. With the fixed formatting toolbar, clicking the block handle opens the same menu. Alternatively, right-click the text and select _Copy reference to this block_ in the _Copy_ submenu, or _Copy reference to these blocks_ for a selection. The referenced blocks flash briefly.
3.  Go to the note where to insert the link and press <kbd>Ctrl</kbd>+<kbd>V</kbd>.

Inside a [table](Tables.md), an [aside](Aside%20blocks.md) or a <a class="reference-link" href="Content%20tabs.md">Content tabs</a> block, the reference points to the whole block. To link to a single tab, use _Copy reference to this tab_ in the <span class="tn-icon cke cke-three-vertical-dots"></span> _More actions_ menu of the tabs block instead. Inside a <a class="reference-link" href="Multicolumn%20layout.md">Multicolumn layout</a>, the reference points to the blocks in the column, and an include shows them without the layout around them.

The link shows the title of the note, followed by the beginning of the referenced text. A link to blocks of the same note shows only the beginning of the referenced text, and a link to a heading of the same note shows the whole heading.

If the note is [shared](../../Advanced%20Usage/Sharing.md), the menu of the block handle also offers _Copy public link_. It copies the web address of the shared page with the reference added, to send to people who read the note outside Trilium. Opening the address scrolls the shared page to the referenced blocks and flashes them. On a shared page, a link to blocks of another shared note does the same.

To reference a heading, you can also right-click it in the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Right%20Sidebar/Outline%20tab.md">Outline tab</a> and select _Copy reference_ or _Copy public link_. This also works in a read-only note.

The _Paste_ submenu of the context menu offers two more ways to insert a copied reference:

*   _Paste reference as a link_ inserts only the link, even when the reference was copied as plain text or along with other content.
*   _Paste reference as an excerpt_ inserts an include of the referenced blocks, as described below.

In a browser, the context menu of the text editor opens only when right-clicking selected text. Elsewhere the browser shows its own menu.

## Linking to a heading

Since v0.107.0, a link to a heading of the same note can be created from the _Add link_ dialog:

*   Place the cursor at the desired position of the link, or select the text to turn into a link.
*   Press <kbd>Ctrl</kbd>+<kbd>K</kbd> or the <span class="tn-icon cke cke-link"></span> button in the <a class="reference-link" href="Formatting%20toolbar.md">Formatting toolbar</a>, then select _Heading / anchor_ at the top of the dialog. Alternatively, choose _Link to a heading or anchor_ in the <a class="reference-link" href="Slash%20Commands.md">Slash Commands</a>, which opens the dialog on that page.
*   Under _Headings_, click the desired heading to check it. Sub-headings are listed under their heading and start collapsed; expand or collapse a heading with the arrow in front of it, or with <kbd>→</kbd> and <kbd>←</kbd> while it is focused. Optionally, type a _Link title_.
*   Press <kbd>Enter</kbd> or _Insert link_ to confirm.

When the link title is not set, the link displays the text of the heading. If the heading gets changed, the link is renamed automatically to the new text, shortly after you stop typing. A link with a title of its own keeps that title.

The link is a block reference to the heading, so it keeps working when the heading is moved. To change the link, click it and press the <span class="tn-icon cke cke-pencil"></span> _Edit link_ button in its popup. For a link with a title of its own, placing the cursor inside it and pressing <kbd>Ctrl</kbd>+<kbd>K</kbd> works too. The dialog opens on _Heading / anchor_, with the heading checked. Emptying the _Link title_ there makes the link display the text of the heading again.

### A heading of another note

Since v0.108.0, a link can point at a heading of another note too:

*   In the _Add link_ dialog, pick the note on the _Note_ page. Its headings and anchors are listed below the _Link title_, after _Link to the note (default)_.
*   Under _Link to a heading_, click the desired heading to check it, then press <kbd>Enter</kbd> or _Insert link_. The link can be inserted before the list appears; it then links to the note itself.
*   Alternatively, type `@` and pick the note: the menu then lists the same headings, and the text typed next narrows them down. See [In-place linking](Links/Internal%20\(reference\)%20links.md).

This link is a block reference too. Linking to the heading saves an invisible identifier in it, also when that note is read-only. If the heading cannot be referenced, for example because it was changed in the meantime, an error is shown and no link is inserted. The dialog stays open. From the `@` menu, the link keeps pointing at the whole note.

The headings of a PDF, and those of a Word or OpenDocument Text document, are listed the same way, and linking to one leaves the file as it is. See <a class="reference-link" href="../File/PDFs.md">PDFs</a> and <a class="reference-link" href="../File/Office%20documents.md">Office documents</a>.

## Following a reference

Clicking a block reference opens the note, scrolls to the referenced blocks and flashes them. If a referenced block was deleted, an error message is shown. When only the first or the last block of a range still exists, the note scrolls to that block.

A link to blocks of the note it is in, such as a link to a heading, scrolls to them and flashes them without leaving the note, as a link within a web page does. This works in read-only notes and on shared pages too. While editing, clicking the link shows its popup: press _Jump to heading_ there, or _Jump to block_ for other blocks.

## Including the referenced blocks

To show the referenced blocks inside another note, right-click the link in a note being edited and select _Convert link to note excerpt_, or paste the copied reference with _Paste_ → _Paste reference as an excerpt_. The include shows only the referenced blocks, not the rest of the note, and marks them with an _Excerpt_ badge in its title. It starts at the _Full_ box size, so all the referenced blocks are visible. To see the whole note, press the <span class="tn-icon bx bx-link-external"></span> button in the same title, which opens the note in a new tab. Converting the include back to a link keeps the reference.

To edit the referenced blocks without leaving the note, press the <span class="tn-icon bx bx-pencil"></span> _Edit excerpt_ button in the title of the include, or turn on _Editable_ (<span class="tn-icon bx bx-edit-alt"></span>) in its toolbar, as for any <a class="reference-link" href="Include%20Note.md">Include Note</a>. Press the button again to stop editing. The changes are saved to the referenced blocks, and the rest of the note stays as it is. The button is grayed out where the blocks cannot be edited, such as in a read-only note. An excerpt has no _Fullscreen_ button.

If a referenced block was deleted, the include shows _Broken reference_.

## Limitations

*   References can be copied only from a note being edited, and not in the mobile layout.
*   An include of a range that covers only part of a list or a quote, such as from its second item to a paragraph after it, cannot be edited in place. Neither can an include of a single code block or diagram.
*   To edit an excerpt from a Markdown note, open the source note. The excerpt itself is read only.
*   Deleting a block, or merging it into the block above with <kbd>Backspace</kbd>, breaks the references to it.