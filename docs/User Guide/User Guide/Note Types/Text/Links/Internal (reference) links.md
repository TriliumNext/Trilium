# Internal (reference) links
Internal links are links to other notes within Trilium.

You can open an internal link by clicking it. You can also see a read-only preview of an internal link's contents by hovering over it.

Since v0.107.0, clicking an internal link while editing a text note shows its popup instead, as clicking an external link does:

*   _Open note_ opens the linked note, or _Open attachment_ for a link to an attachment. A link into the same note reads _Jump to heading_, _Jump to block_ or _Jump to anchor_ instead, and scrolls to it without leaving the note.
*   <span class="tn-icon cke cke-trilium-download"></span> _Download_, for a link to an attachment, downloads the attachment.
*   <span class="tn-icon cke cke-pencil"></span> _Edit link_ changes the link, as described below.
*   The <span class="tn-icon cke cke-three-vertical-dots"></span> _More actions_ menu, with <span class="tn-icon bx bx-right-arrow-circle"></span> _Open note_ first, which does what the first button does, then <span class="tn-icon bx bx-link-external"></span> _Open note in a new tab_, <span class="tn-icon bx bx-dock-right"></span> _Open note in a new split_, <span class="tn-icon bx bx-window-open"></span> _Open note in a new window_ and <span class="tn-icon bx bx-edit"></span> _Quick edit_, then _Edit link_ and <span class="tn-icon cke cke-unlink"></span> _Unlink_, which turns the link into plain text. A link that shows the title of the note ends with _Convert link to an included note_, described in <a class="reference-link" href="../Include%20Note.md">Include Note</a>. A link to an attachment lists the actions on the attachment between _Edit link_ and _Unlink_, except <span class="tn-icon bx bx-trash"></span> _Delete attachment..._, which follows _Unlink_, and ends with converting the attachment into a note. A link to blocks of the same note leaves out the ways to open the note elsewhere.

In a note being edited, right-clicking a link also opens this menu.

To follow the link without the popup, <kbd>Ctrl</kbd>+click or double-click it, which does what the first button of the popup does. On a touch device, touch and hold the link, then choose the first entry of its menu, such as _Open note_ or _Jump to heading_. To open the note in a new tab, click it with the middle mouse button. The preview does not show while the popup is open.

## Inserting internal links

Internal links can be created at the current position in a text note by:

1.  Pressing <kbd>Ctrl</kbd> + <kbd>L</kbd> or the <span class="tn-icon cke cke-trilium"></span> button underneath the <span class="tn-icon cke cke-plus"></span> menu in the <a class="reference-link" href="../Formatting%20toolbar.md">Formatting toolbar</a>, or by choosing _Link to a note (internal link)_ in the <a class="reference-link" href="../Slash%20Commands.md">Slash Commands</a>. On desktop, the _Add link_ dialog opens in a popup next to the cursor.
2.  Searching for the title of the desired note to link. It's also possible to create new notes from this dialog by typing a non-existing note title and selecting either _Create note_, which places it in the <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/Notes/Note%20Inbox.md">Note Inbox</a> (today's day note, or the top level, when no inbox is set), or _Create child note_, which places it under the note being edited.

There are two link types, depending on the _Link title_ field of the dialog:

1.  When the link title is not set, the link will display the title of the note. If the title of the note gets changed, the link will be renamed automatically to the new name.
    1.  This is sometimes also called "reference link".
    2.  The icon of the linked note will also be displayed.
    3.  If the linked note is deleted, the link keeps the last title it showed, in red and with a <span class="tn-icon bx bx-x"></span> icon instead of the note icon. Clicking it while editing opens the _Fix link_ dialog, which searches for that title; picking a note, or creating a new one, replaces the link with one to that note.
2.  When a link title is typed, the link shows that text instead.
    1.  This will create a traditional hyperlink, where the text of the link can be different from the note title.

Since v0.107.0, to change a link, click it and press the <span class="tn-icon cke cke-pencil"></span> _Edit link_ button in its popup. For a link with a title of its own, placing the cursor inside it and pressing <kbd>Ctrl</kbd> + <kbd>L</kbd> or the <span class="tn-icon cke cke-trilium"></span> button works too. The _Edit link_ dialog opens on the linked note, with its anchor and, for a link with a title of its own, the link's text; _Save link_ changes the whole link. Emptying the _Link title_ there turns the link into one that displays the title of the note, and typing one gives it a title of its own. For a link to an attachment, the dialog shows only the _Link title_, and emptying it makes the link display the title of the attachment.

## In-place linking

You can also insert internal links “inline” by using the `@` symbol:

1.  Type `@` in a text note, which will open the note search menu.
2.  Search for the desired note's title by typing a few characters. Use <kbd>Up</kbd> and <kbd>Down</kbd> to select the correct note, and press <kbd>Enter</kbd> or <kbd>Tab</kbd> to create the link. It's also possible to create new notes with this method by typing a non-existing note title and selecting _Create note_, as described above, or _Create child note_. _Create child note_ creates the note under the note being edited without asking for its type, inserts the link and opens the new note in <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/Navigation/Quick%20edit.md">Quick edit</a>, which offers the note types to turn it into while it is still empty.

To create an empty child note and link to it before naming it, use _New child note_, described in <a class="reference-link" href="../Insert%20buttons.md">Insert buttons</a>.

## Pasting internal links

You can also insert internal links by copying a note from the note tree.

1.  In the <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>, select a note and press <kbd>Ctrl</kbd> + <kbd>C</kbd>.
2.  In a text note, paste the link by pressing <kbd>Ctrl</kbd> + <kbd>V</kbd>.