# Note tree contextual menu
<figure class="image image-style-align-right"><img style="aspect-ratio:269/608;" src="1_Note tree contextual menu_.png" width="269" height="608"></figure>

The _note tree menu_ can be accessed by right-clicking in the <a class="reference-link" href="../Note%20Tree.md">Note Tree</a>.

## Interaction

The contextual menu can operate:

*   On a single note, by right clicking it in the note tree.
*   On multiple notes, by selecting them first. See <a class="reference-link" href="Multiple%20selection.md">Multiple selection</a> on how to do so.
    *   When right clicking, do note that usually the note being right clicked is also included in the affected notes, regardless of whether it was selected or not.

## Available options

> [!NOTE]
> When multiple notes are selected, only a subset of notes will be active. The ones that do support multiple notes will mention this in the list below.

*   **Open in a new tab**
    *   Will open a single note in a new [tab](../Tabs.md).
*   **Open in a new split**
    *   Will open a split to the right with the given note within the current tab.
*   **Hoist note**
    *   Will focus the note tree on this note. See <a class="reference-link" href="../../Navigation/Note%20Hoisting.md">Note Hoisting</a> for more information.
*   **Insert note after**
    *   Allows easy creation of a note with a specified [note type](../../../Note%20Types.md).
    *   <a class="reference-link" href="../../../Advanced%20Usage/Templates.md">Templates</a> will also be present (if any) at the end of the list.
    *   The note will be added on the same level of hierarchy as the note selected.
*   **Insert child note**
    *   Same as _Insert note after_, but the note will be created as a child of the selected note.
*   **Protect subtree**
    *   Will mark this note and all of its descendents as protected. See <a class="reference-link" href="../../Notes/Protected%20Notes.md">Protected Notes</a> for more information.
*   **Unprotect subtree**
    *   Will unprotect this note and all of its descendents.
*   **Cut**
    *   Will place the given notes in clipboard.
    *   Use one of the two paste functions (or the keyboard shortcuts) to move them to the desired location.
*   **Copy / clone**
    *   Will place the given notes in clipboard.
    *   Use one of the two paste functions (or the keyboard shortcuts) to copy them to the desired location.
    *   Note that the copy function here works according to the <a class="reference-link" href="../../Notes/Cloning%20Notes.md">Cloning Notes</a> functionality (i.e. the note itself will be present in two locations at once, and editing it in one place will edit it everywhere).
    *   To simply create a duplicate note that can be modified independently, look for _Duplicate subtree_.
*   **Paste into**
    *   If there are any notes in clipboard, they will be pasted as child notes to the right-clicked one.
*   **Paste after**
    *   If there are any notes in clipboard, they will be pasted underneath the right-clicked one.
*   **Move to…**
    *   Will display a modal to specify where to move the desired notes.
*   **Clone to…**
    *   Will display a modal to specify where to [clone](../../Notes/Cloning%20Notes.md) the desired notes.
*   **Duplicate**
    *   Creates a copy of the note and its descendants.
    *   This process is different from <a class="reference-link" href="../../Notes/Cloning%20Notes.md">Cloning Notes</a> since the duplicated note can be edited independently from the original.
    *   An alternative to this, if done regularly, would be <a class="reference-link" href="../../../Advanced%20Usage/Templates.md">Templates</a>.
*   **Archive/Unarchive**
    *   Marks a note as [archived](../../Notes/Archived%20Notes.md).
    *   If the note is already archived, it will be unarchived instead.
    *   Multiple notes can be selected as well. However, all the selected notes must be in the same state (archived or not), otherwise the option will be disabled.
*   **Delete**
    *   Will delete the given notes, asking for confirmation first.
    *   In the dialog, the following options can be configured:
        *   _Delete also all clones_ to ensure that the note will be deleted everywhere if it has been placed into multiple locations (see <a class="reference-link" href="../../Notes/Cloning%20Notes.md">Cloning Notes</a>).
        *   _Erase notes permanently_ will ensure that the note cannot be recovered from <a class="reference-link" href="../Recent%20Changes.md">Recent Changes</a>.
*   **Import into note**
    *   Opens the [import](../../Import%20%26%20Export.md) dialog and places the imported notes as child notes of the selected one.
*   **Export**
    *   Opens the [export](../../Import%20%26%20Export.md) dialog for the selected notes.
*   **Search in subtree**
    *   Opens a full <a class="reference-link" href="../../Navigation/Search.md">Search</a> with it preconfigured to only look into this note and its descendants (the _Ancestor_ field).

## Advanced options

<figure class="image image-style-align-right"><img style="aspect-ratio:231/263;" src="Note tree contextual menu_.png" width="231" height="263"></figure>

The advanced options menu offers some of the less frequently used actions for notes.

To access these options, first look for the _Advanced_ option in the contextual menu to reveal a sub-menu with:

*   **Apply bulk actions**
    *   Opens the <a class="reference-link" href="../../../Advanced%20Usage/Bulk%20Actions.md">Bulk Actions</a> dialog, to apply actions such as adding labels or moving notes to multiple notes at once (see <a class="reference-link" href="Multiple%20selection.md">Multiple selection</a>).
*   **Edit branch prefix**
    *   Opens a dialog to assign a name to be able to distinguish [clones](../../Notes/Cloning%20Notes.md), see <a class="reference-link" href="../../Notes/Cloning%20Notes/Branch%20prefix.md">Branch prefix</a> for more information.
*   **Convert to attachment**
    *   Converts the selected notes to <a class="reference-link" href="../../Notes/Attachments.md">Attachments</a> of their parent notes.
    *   This functional is most useful when dealing with image <a class="reference-link" href="../../../Note%20Types/File.md">File</a> notes that were imported from an external source or an older version of Trilium.
*   **Expand subtree**
    *   Expands all the child notes in the <a class="reference-link" href="../Note%20Tree.md">Note Tree</a>.
*   **Collapse subtree**
    *   Collapses all the child notes in the note tree.
*   **Sort by…**
    *   Opens a dialog to sort all the child notes of the selected note.
    *   The sorting is done only once, there is an automatic sorting mechanism as well that can be set using <a class="reference-link" href="../../../Advanced%20Usage/Attributes.md">Attributes</a>.
    *   See <a class="reference-link" href="../../Notes/Sorting%20Notes.md">Sorting Notes</a> for more information.
*   **Copy note path to clipboard**
    *   Copies a URL fragment representing the full path to this branch for a note, such as `#root/Hb2E70L7HPuf/4sRFgMZhYFts/2IVuShedRJ3U/LJVMvKXOFv7n`.
    *   The URL to manually create <a class="reference-link" href="../../../Note%20Types/Text/Links.md">Links</a> within notes, or for note <a class="reference-link" href="../../Navigation">Navigation</a>.
*   **Recent changes in subtree**
    *   This will open <a class="reference-link" href="../Recent%20Changes.md">Recent Changes</a>, but filtered to only the changes related to this note or one of its descendants.