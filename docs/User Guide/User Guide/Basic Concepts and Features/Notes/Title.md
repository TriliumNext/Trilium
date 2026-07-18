# Title
Alongside its content, the **title** is one of the two main attributes of a [note](../Notes.md). It's the short, human-readable name shown in the editable field at the top of every note, and it's what identifies the note throughout the interface (in the <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Note Tree</a>, in tabs, in the <a class="reference-link" href="../UI%20Elements/New%20Layout/Breadcrumb.md">Breadcrumb</a> and win <a class="reference-link" href="../../Note%20Types/Text/Links/Internal%20(reference)%20links.md">Internal (reference) links</a>.

Internally, notes are identified by a unique <a class="reference-link" href="../../Advanced%20Usage/Note%20ID.md">Note ID</a> rather than by their title, so the title is purely for your benefit. This has a few consequences:

*   **Titles don't have to be unique.** You can have any number of notes that share the same title without conflict.
*   **Renaming a note never breaks links to it.** Links between notes point at the underlying note, so changing a title leaves existing links intact (they'll simply display the new title).
*   **The title can be left empty.** Notes with no title display a placeholder (_type note's title here…_) but are otherwise perfectly valid.

In addition:

*   There is no limitation on the length of the title, however in exports the title might get trimmed.
*   There are no forbidden symbols, unsupported characters will get trimmed when exporting.
*   When exporting to a ZIP file, a meta file will contain the full title which will be recognized by Trilium when importing again.

### Editing the title

To rename a note, simply click into the title field and type. Changes are saved automatically as you type.

You can also begin editing the title directly from the <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Note Tree</a><a class="reference-link" href="../UI%20Elements/Note%20Tree.md">[missing note]</a> by selecting a note and pressing <kbd>Enter</kbd> (see _Edit note title_ in <a class="reference-link" href="../Keyboard%20Shortcuts.md">Keyboard Shortcuts</a>), which focuses the title field for the active note.

> [!NOTE]
> Titles may contain any characters, including Unicode and emoji. For security, any HTML in the title is stripped automatically, so the title is always treated as plain text.

### Easily navigating between the title and the content

When the cursor is in the title field, pressing <kbd>Enter</kbd> moves focus into the note's content. For <a class="reference-link" href="../../Note%20Types/Text.md">[missing note]</a> notes this also inserts a fresh empty paragraph at the very top of the document, so you can start writing immediately — much like other note-taking apps.

This makes it possible to create a note, type its title, press <kbd>Enter</kbd>, and continue straight into the body without reaching for the mouse.

### Working with new notes

When you create a new note it's given a default title (_new note_) which is pre-selected, so you can type a name right away to replace it. The default title for new notes can be customized per-section — see <a class="reference-link" href="../../Advanced%20Usage/Default%20Note%20Title.md">[missing note]</a>.

If you decide you don't want the note after all, pressing <kbd>Escape</kbd> while the title of a freshly created note is still focused will discard it.

### Automatically generated titles

Some notes get their titles assigned automatically rather than typed:

*   **Day, week, month and year notes** in the <a class="reference-link" href="../../Advanced%20Usage/Advanced%20Showcases/Day%20Notes.md">[missing note]</a><a class="reference-link" href="../../Advanced%20Usage/Advanced%20Showcases/Day%20Notes.md">Day Notes</a> are named from a configurable date pattern.
*   <a class="reference-link" href="../../Note%20Types/Saved%20Search.md">[missing note]</a><a class="reference-link" href="../../Note%20Types/Saved%20Search.md">Saved Search</a> notes are named after the search they perform.
*   When a note is duplicated, a suffix is appended to the copy's title to tell it apart from the original.

### Protected notes

For <a class="reference-link" href="Protected%20Notes.md">[missing note]</a><a class="reference-link" href="Protected%20Notes.md">Protected Notes</a>, the title is _not_ encrypted — only the content is. The title therefore remains visible in the tree and tabs even when no protected session is active. While locked, however, the title field is read-only and cannot be edited until you enter your password.

## Protected notes

The titles of <a class="reference-link" href="Protected%20Notes.md">Protected Notes</a><a class="reference-link" href="Protected%20Notes.md">[missing note]</a> are encrypted along with their content. Before entering your password, Trilium cannot decrypt the title, so it is shown as `[protected]` in instead and the title cannot be modified.

Once you enter your password and a protected session is active, the real title is decrypted and displayed, and becomes editable again.