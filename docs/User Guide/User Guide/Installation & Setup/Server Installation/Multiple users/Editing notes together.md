# Editing notes together
On a server with [multiple users](../Multiple%20users.md), several people can have the same note open at once. Whether they then edit it together, each seeing the changes of the others as they are made, depends on the type of the note.

> [!IMPORTANT]
> Editing together is under development, like the rest of the support for multiple users, and is available for text notes only.

## Status per note type

| Note type | Edited together | When two users change it at the same time |
| --- | --- | --- |
| <a class="reference-link" href="../../../Note%20Types/Text.md">Text</a> | Yes | Both changes are kept, and each user sees the other's as they type. |
| <a class="reference-link" href="../../../Note%20Types/Code.md">Code</a> | No | The last save replaces the earlier ones. |
| <a class="reference-link" href="../../../Note%20Types/Markdown.md">Markdown</a> | No | The last save replaces the earlier ones. |
| <a class="reference-link" href="../../../Note%20Types/Mermaid%20Diagrams.md">Mermaid Diagrams</a> | No | The last save replaces the earlier ones. |
| <a class="reference-link" href="../../../Note%20Types/Canvas.md">Canvas</a> | No | The last save replaces the earlier ones. |
| <a class="reference-link" href="../../../Note%20Types/Mind%20Map.md">Mind Map</a> | No | The last save replaces the earlier ones. |
| <a class="reference-link" href="../../../Note%20Types/Spreadsheets.md">Spreadsheets</a> | No | The last save replaces the earlier ones. |
| <a class="reference-link" href="../../../Note%20Types/Relation%20Map.md">Relation Map</a> | No | The last save replaces the earlier ones. |
| <a class="reference-link" href="../../../Collections.md">Collections</a> | Not needed | Each item is a note of its own, so changes to different items are both kept. |
| <a class="reference-link" href="../../../Note%20Types/File.md">File</a>, <a class="reference-link" href="../../../Note%20Types/Web%20View.md">Web View</a>, <a class="reference-link" href="../../../Note%20Types/Render%20Note.md">Render Note</a>, <a class="reference-link" href="../../../Note%20Types/Note%20Map.md">Note Map</a>, <a class="reference-link" href="../../../Note%20Types/Saved%20Search.md">Saved Search</a> | Not applicable | These notes have no content that is edited in place. |

For the types that are not edited together, the note is saved as a whole a moment after each change. A user who has the note open receives what someone else saved, unless they have changes of their own that are not saved yet; in that case their next save replaces it.

## Text notes

When several users have the same text note open, what one of them types appears for the others as they type, and each user's undo only takes back their own changes.

*   Each of the other users has a cursor in the text, in the color of their avatar and labeled with their name. What they have selected is highlighted in the same color.
*   The avatars of the other users are shown next to the title of the note for as long as they have it open.
*   A user who has _Can view_ access to the note follows the changes, and can't type in it. See <a class="reference-link" href="Giving%20access%20to%20notes.md">Giving access to notes</a>.

### Limitations

*   [Protected notes](../../../Basic%20Concepts%20and%20Features/Notes/Protected%20Notes.md) are not edited together.
*   A text note shown in [read-only mode](../../../Basic%20Concepts%20and%20Features/Notes/Read-Only%20Notes.md) doesn't follow the changes as they are typed. It shows them once they are saved.
*   A note edited inside another note is not edited together, even when it is a text note.
*   If the editors end up with different content, the note is reloaded from one of them. The others keep what was already there, but can lose the last thing they typed and their undo history.
*   Editing together needs the server: the desktop application and the in-browser version have a single user.