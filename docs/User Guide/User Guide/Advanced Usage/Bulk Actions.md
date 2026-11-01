# Bulk Actions
<figure class="image"><img style="aspect-ratio:1425/644;" src="Bulk Actions_image.png" width="1425" height="644"></figure>

The _Bulk Actions_ dialog makes it easy to apply changes to multiple notes at once, ranging from simple actions such as adding or removing a label to being executing custom scripts.

## Interaction

*   The first step is to select the notes in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>. It's possible to apply bulk actions to:
    *   A single note (and potentially its child notes) simply by clicking on it (with a left click or a right click).
    *   Multiple notes. See <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree/Multiple%20selection.md">Multiple selection</a> on how to do so.
*   Right click in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a> and select _Advanced_ → _Apply bulk actions_.
*   The _Selected notes_ section at the top of the dialog lists the notes the actions apply to. When many notes are selected, only the first few are shown; click _+N more_ to show the rest.
    *   To leave a note out without changing the selection in the note tree, press the <span class="tn-icon bx bx-x"></span> button on its entry. The last remaining note cannot be removed.
*   By default, only the selected notes will be affected. To also include all the descendants of the notes, turn on _Include descendants of the selected notes_. The number of affected notes, shown below that option, updates to reflect the change.
*   To add an action, click _Add action_ (<span class="tn-icon bx bx-plus"></span>) at the bottom of the _Chosen actions_ section and pick one from the menu. Hovering over an entry shows a short description of what it does; a detailed description of each is available in the next section.
    *   Each chosen action appears as an entry in the _Chosen actions_ section, with its own configuration.
    *   To remove an action, simply press the <span class="tn-icon bx bx-x"></span> button to the right of it.
    *   It is possible to apply multiple actions of the same type, such as adding multiple types.
    *   The fields for a label or relation name suggest the names already used in the database as you type, marking the ones Trilium itself attaches a meaning to.
    *   The value field of _Add label_ and _Update label value_ suggests the values the named label already has in the database.
*   When all the actions are defined, press the _Apply to N notes_ button to trigger all of them at once. The button names the number of notes that will be affected, and stays disabled until at least one action is added.
    *   If an action is missing a field it needs, such as the name of the label to rename, the dialog does not run and points out the empty field instead.
*   For convenience, the last bulk action configuration is saved for further use and will be restored when entering the dialog again.

## Actions

### Labels

These actions operate the <a class="reference-link" href="Attributes/Labels.md">Labels</a> of a note. Except for _Add label_, they only affect labels set directly on the note; inherited labels are left unchanged.

*   **Add label**
    *   For each note, it creates a [label](Attributes/Labels.md) of the given name. Keep the _New value_ field empty to create a label without a value, or complete it to assign a value.
    *   The label is added even if the note already has one of the same name, so the note ends up with both. To change the value of an existing label instead, use _Update label value_.
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

These actions operate the <a class="reference-link" href="Attributes/Relations.md">Relations</a> of a note. Except for _Add relation_, they only affect relations set directly on the note; inherited relations are left unchanged.

*   **Add relation**
    *   For each note, it will create a relation pointing to the given note.
    *   The relation is added even if the note already has one of the same name.
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
    *   The title can contain expressions between `${` and `}`, which are filled in for each note. They can read the note's properties, such as `${note.title}`, `${note.noteId}` or `${note.type}`, and call `getLabelValue('name')`, `getRelationValue('name')` or, on a date such as `dateCreatedObj`, `format('…')`. For example:
        *   `NEW: ${note.title}` will prefix all notes with `NEW:` .
        *   `${note.dateCreatedObj.format('MM-DD:')}: ${note.title}` will prefix the note titles with each note's creation date (in month-day format).
    *   Only property access and those methods are allowed, not arbitrary JavaScript. While typing, the field completes the expressions, underlines one that is not allowed and shows the resulting title for the first selected note.
*   **Move note**
    *   For each note, it will be moved to the specified parent note.
    *   A note with several parents is cloned to the new parent instead, since it is not clear which of its places to remove.
    *   A note that cannot be placed there, such as a parent of the target note, stays where it is.
    *   As an alternative for less complex situations, the notes can be moved directly from within the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a> via cut → paste or via the contextual menu.
*   **Convert note**
    *   This allows a note to be converted from one type to another:
        *   **Text Notes → Markdown Notes** — each <a class="reference-link" href="../Note%20Types/Text.md">Text</a> note is converted to a <a class="reference-link" href="../Note%20Types/Markdown.md">Markdown</a> note. Since Markdown does not support all the formatting capabilities of Text Notes, some formatting may be lost and some unsupported elements may even be dropped.
        *   **Markdown Notes → Text Notes** — each <a class="reference-link" href="../Note%20Types/Markdown.md">Markdown</a> note is converted to a <a class="reference-link" href="../Note%20Types/Text.md">Text</a> Note.
    *   For each converted note, a revision is saved automatically, allowing you to restore the original or recover any missing elements from it.
*   **Save revision**
    *   Automatically creates a revision of each note. Optionally, a name can be assigned to this revision. See <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Notes/Note%20Revisions.md">Note Revisions</a>.
*   **Delete note**
    *   For each note, it will be deleted, including all of its clones and any child notes that are not cloned elsewhere.
    *   Deleted notes can be restored from _Recent changes_ until they are erased.
    *   As an alternative for less complex situations, the notes can be removed directly from within the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a> by selecting them and pressing <kbd>Delete</kbd>.
*   **Delete note revisions**
    *   This will permanently erase all the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Notes/Note%20Revisions.md">Note Revisions</a> of the notes. Unlike deleted notes, erased revisions cannot be restored.

### Others

*   **Execute script**
    *   For more complex scenarios, it is possible to type in a JavaScript expression in order to apply the necessary changes.
    *   The script runs on the server once for each note, with that note available as `note` and the backend script API as `api`. The field completes both as you type and underlines mistakes, as the editor of a backend script note does.
    *   Examples:
        *   To apply a suffix (`- suffix` in this example), to the note title:
            
            ```javascript
            note.title = note.title + " - suffix";
            ```
        *   To alter attributes of a note based on another attribute, such as setting the `#shareAlias` label to the title of the note:
            
            ```javascript
            note.setLabel("shareAlias", note.title)
            ```