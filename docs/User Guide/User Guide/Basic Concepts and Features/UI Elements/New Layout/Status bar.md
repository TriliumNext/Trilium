# Status bar
The status bar displays information about the current note and allows changing settings related to it such as configuring the language or attributes.

## Layout and interaction

On the left side, the <a class="reference-link" href="Breadcrumb.md">Breadcrumb</a> is displayed which indicates the current note as well as its parent notes and allows for quick navigation throughout the hierarchy.

On the right side, specific sections will show depending on the type of the current note.

1.  For code notes, the language mode of the note is indicated (e.g. JavaScript, plain text), as well as allowing easy switching to another mode.
2.  For text notes, the content language is displayed and can be changed, thus configuring the spell-check and the right-to-left support.
    1.  Note that this applies to the entire note and not the selection, unlike some text editors.
3.  If a note is placed in multiple places in the tree (cloned), the number of the note paths will be displayed.
    1.  Clicking it will reveal the full list of note paths and a button to place it somewhere else.
4.  If a note has attachments, their number will be displayed.
    1.  Clicking on it will reveal the list of attachments in a new tab.
5.  If a note is linked from other text notes (backlinks), the number of backlinks will be displayed.
    1.  Clicking on it will show the list of notes that link to this note, as well as an excerpt of where the note is referenced.

Regardless of note type, the following items will always be displayed if there is a note:

1.  Note info, which displays:
    1.  The creation/modification date of the note.
    2.  The type and MIME of the note.
    3.  The note ID.
    4.  An estimation of the note size of the note itself and its children.
    5.  A button to show Similar notes.