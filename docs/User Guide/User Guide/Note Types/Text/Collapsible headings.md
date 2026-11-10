# Collapsible headings
A heading can be collapsed to hide the content under it, up to the next heading of the same or a higher level. A lower heading is hidden along with the rest, and keeps its own state.

## Collapsing and expanding

*   To collapse or expand a heading, click the arrow at the end of the heading. The arrow appears while the mouse is over the heading or the cursor is in it, and stays visible while the heading is collapsed.
*   To use the keyboard instead, place the cursor in the heading and press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Enter</kbd>.
*   The menu of the drag handle beside a heading also offers _Collapse section_ and _Expand section_.

The collapsed state is saved with the note, so a heading stays collapsed when the note is opened again.

## Editing around a collapsed heading

*   Pressing <kbd>Enter</kbd> at the end of a collapsed heading adds a new heading of the same level below the hidden content.
*   The arrow keys move the cursor past the hidden content.
*   <kbd>Backspace</kbd> right below a collapsed heading's content, or <kbd>Delete</kbd> at the end of a collapsed heading, expands the heading instead of deleting the hidden content.
*   Dragging a collapsed heading by its drag handle moves its hidden content along with it.
*   A collapsed heading expands when content is added to its section, for example by pasting or by dropping a block under it.
*   _Search in note_, the table of contents and links to a block show hidden content when they lead to it, without expanding the heading.

## Read-only notes

The arrow also works in notes shown read-only (see <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Read-Only%20Notes.md">Read-Only Notes</a>), but there the changes are not saved: the note shows its saved state again when it is reopened.

## Limitations

*   Shared notes and printouts always show all the content.
*   The collapsed state is kept in HTML exports, but not in Markdown exports.