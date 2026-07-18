# Bulk Actions
<figure class="image"><img style="aspect-ratio:1425/644;" src="Bulk Actions_image.png" width="1425" height="644"></figure>

The _Bulk Actions_ dialog makes it easy to apply changes to multiple notes at once, ranging from simple actions such as adding or removing a label to being executing custom scripts.

## Interaction

*   The first step is to select the notes in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>. It's possible to apply bulk actions to:
    *   A single note (and potentially its child notes) simply by clicking on it (with a left click or a right click).
    *   Multiple notes. See <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree/Multiple%20selection.md">Multiple selection</a> on how to do so.
*   Right click in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a> and select _Advanced_ → _Apply bulk actions_.
*   By default, only the selected notes will be affected. To also include all the descendants of the notes, check _Include descendants of the selected notes_. The number of affected notes at the top of the dialog will update to reflect the change.
*   Click on which action to apply from the _Available actions_ section. A detailed description of each is available in the next section.
    *   For each action selected, the _Chosen actions_ section will update to reveal the entry. Each action will have its own configuration.
    *   To remove an action, simply press the X button to the right of it.
    *   It is possible to apply multiple actions of the same type, such as adding multiple types.
*   When all the actions are defined, press _Execute bulk actions_ to trigger all of them at once.
*   For convenience, the last bulk action configuration is saved for further use and will be restored when entering the dialog again.

## Actions

### Labels

These actions operate the <a class="reference-link" href="Attributes/Labels.md">Labels</a> of a note:

*   **Add label**
    *   For each note, if it doesn't already have a [label](Attributes/Labels.md) of the given name, it will create it. Keep the _New value_ field empty to create a label without a value, or complete it to assign a value.
    *   If a note already has this label, its value will be updated.
*   **Update label value**
    *   For each note, if it has a [label](Attributes/Labels.md) of the given name, it will change its value to the specified one. Leave _New value_ field empty to create a label without a value.
    *   Notes without the label will not be affected.
*   _**Rename label**_
    *   For each note, if it has a [label](Attributes/Labels.md) of the given name, it will be renamed/replaced with a label of the new name. The value of the label (if present) will be kept intact.
    *   Notes without the label will not be affected.
*   **Delete label**
    *   For each note, if it has a label of a given name, it will be deleted (regardless of whether it has a value or not).
    *   Notes without the label will not be affected.

### Relations

These actions operate the <a class="reference-link" href="Attributes/Relations.md">Relations</a> of a note:

*   **Add relation**
    *   For each note, it will create a relation pointing to the given note.
    *   Notes without this relation will not be affected.
*   **Update relation target**
    *   For each note, it will modify a relation to point to the newly given note.
    *   Notes without this relation will not be affected.
*   **Rename relation**
    *   For each note, if it has a relation of the given name, it will be renamed/replaced with a relation of the new name. The target note of the relation will be kept intact.
    *   Notes without this relation will not be affected.
*   **Delete relation**
    *   For each note, if it has a relation of the given name, it will be deleted.
    *   Notes without this relation will not be affected.

### Notes

*   **Rename note**
    *   For each note, it will change the title of the note to the given one.
    *   As a more advanced use case, the note can be a “template string” which allows for dynamic values with access to the note information via <a class="reference-link" href="../Scripting/Script%20API/Frontend%20API/FNote.dat">FNote</a>, for example:
        *   `NEW: ${note.title}` will prefix all notes with `NEW:` .
        *   `${note.dateCreatedObj.format('MM-DD:')}: ${note.title}` will prefix the note titles with each note's creation date (in month-day format).
*   **Move note**
    *   For each note, it will be moved to the specified parent note.
    *   As an alternative for less complex situations, the notes can be moved directly from within the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a> via cut → paste or via the contextual menu.
*   **Convert note**
    *   This allows a note to be converted from one type to another:
        *   **Text Notes → Markdown Notes** — each <a class="reference-link" href="../Note%20Types/Text.md">Text</a> note is converted to a <a class="reference-link" href="../Note%20Types/Markdown.md">Markdown</a> note. Since Markdown does not support all the formatting capabilities of Text Notes, some formatting may be lost and some unsupported elements may even be dropped.
        *   **Markdown Notes → Text Notes** — each <a class="reference-link" href="../Note%20Types/Markdown.md">Markdown</a> note is converted to a <a class="reference-link" href="../Note%20Types/Text.md">Text</a> Note.
    *   For each converted note, a revision is saved automatically, allowing you to restore the original or recover any missing elements from it.
*   **Save revision**
    *   Automatically creates a revision of each note. Optionally, a name can be assigned to this revision. See <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Notes/Note%20Revisions.md">Note Revisions</a>.
*   **Delete note**
    *   For each note, it will be deleted.
    *   As an alternative for less complex situations, the notes can be removed directly from within the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a> by selecting them and pressing <kbd>Delete</kbd>.
*   **Delete note revisions**
    *   This will delete all the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Notes/Note%20Revisions.md">Note Revisions</a> of the notes.

### Others

*   **Execute script**
    *   For more complex scenarios, it is possible to type in a JavaScript expression in order to apply the necessary changes.
    *   Examples:
        *   To apply a suffix (`- suffix` in this example), to the note title:
            
            ```javascript
            note.title = note.title + " - suffix";
            ```
        *   To alter attributes of a note based on another attribute, such as setting the `#shareAlias` label to the title of the note:
            
            ```javascript
            note.setLabel("shareAlias", note.title)
            ```