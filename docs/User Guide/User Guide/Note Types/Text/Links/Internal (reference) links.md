# Internal (reference) links
Internal links are links to other notes within Trilium.

You can open an internal link by clicking it. You can also see a read-only preview of an internal link's contents by hovering over it.

## Inserting internal links

Internal links can be created at the current position in a text note by:

1.  Pressing <kbd>Ctrl</kbd> + <kbd>L</kbd> or the <span class="tn-icon cke cke-trilium"></span> button underneath the <span class="tn-icon cke cke-plus"></span> menu in the <a class="reference-link" href="../Formatting%20toolbar.md">Formatting toolbar</a>. On desktop, the _Add link_ dialog opens in a popup next to the cursor.
2.  Searching for the title of the desired note to link. It's also possible to create new notes from this dialog by typing a non-existing note title and selecting either _Create note_, which places it in the <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/Notes/Note%20Inbox.md">Note Inbox</a> (today's day note, or the top level, when no inbox is set), or _Create child note_, which places it under the note being edited.

There are two link types, chosen with the _Mirror the note's title_ switch of the dialog, which is on by default:

1.  With the switch on, the link mirrors the note's title.
    1.  This is sometimes also called "reference link".
    2.  The title of this link cannot be changed. Instead, it will always show the current title of the linked note.
    3.  The icon of the linked note will also be displayed.
    4.  If the linked note is deleted, the link keeps the last title it showed, in red and with a <span class="tn-icon bx bx-x"></span> icon instead of the note icon. Clicking it while editing opens the _Fix link_ dialog, which searches for that title; picking a note, or creating a new one, replaces the link with one to that note.
2.  With the switch off, the link has a title of its own, typed in the _Link title_ field.
    1.  This will create a traditional hyperlink, where the text of the link can be different from the note title.

Since v0.107.0, to change a link whose title does not mirror the note's, click it and press the <span class="tn-icon cke cke-pencil"></span> _Edit link_ button in its popup, or place the cursor inside it and press <kbd>Ctrl</kbd> + <kbd>L</kbd> or the <span class="tn-icon cke cke-trilium"></span> button. The _Edit link_ dialog opens on the linked note, with its anchor and the link's text; _Save link_ changes the whole link. Turning _Mirror the note's title_ on there turns it into a link that mirrors the title.

## In-place linking

You can also insert internal links “inline” by using the `@` symbol:

1.  Type `@` in a text note, which will open the note search menu.
2.  Search for the desired note's title by typing a few characters. Use <kbd>Up</kbd> and <kbd>Down</kbd> to select the correct note, and press <kbd>Enter</kbd> or <kbd>Tab</kbd> to create the link. It's also possible to create new notes with this method by typing a non-existing note title and selecting _Create note_, as described above, or _Create child note_. _Create child note_ creates the note under the note being edited without asking for its type, inserts the link and opens the new note in <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/Navigation/Quick%20edit.md">Quick edit</a>, which offers the note types to turn it into while it is still empty.

To create an empty child note and link to it before naming it, use _New child note_, described in <a class="reference-link" href="../Insert%20buttons.md">Insert buttons</a>.

## Pasting internal links

You can also insert internal links by copying a note from the note tree.

1.  In the <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>, select a note and press <kbd>Ctrl</kbd> + <kbd>C</kbd>.
2.  In a text note, paste the link by pressing <kbd>Ctrl</kbd> + <kbd>V</kbd>.