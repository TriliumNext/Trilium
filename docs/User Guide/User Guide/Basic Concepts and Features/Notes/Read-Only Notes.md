# Read-Only Notes
Some note types such as <a class="reference-link" href="../../Note%20Types/Text.md">Text</a> and <a class="reference-link" href="../../Note%20Types/Code.md">Code</a> notes in Trilium can be set to read-only. When a note is in read-only mode, it is presented to the user in a non-editable view, with the option to switch to editing mode if needed.

## Automatic read-only mode

For optimization purposes, Trilium will automatically set very large notes to read-only. Displaying such lengthy notes in editing mode can slow down performance, especially when editing is unnecessary.

This behavior can be disabled on a per-note basis, by following the instructions of the next section.

In addition, it's possible to change the number of characters at which the automatic read-only mode will trigger in <a class="reference-link" href="../UI%20Elements/Options.md">Options</a> by going to the options for <a class="reference-link" href="#root/_hidden/_options/_optionsTextNotes">Text Notes</a> and <a class="reference-link" href="#root/_hidden/_options/_optionsCodeNotes">Code Notes</a>.

## Changing a note's read-only behavior

Via the <a class="reference-link" href="../UI%20Elements/Ribbon.md">Ribbon</a>, by going to the _Basic Properties_ tab and looking for the _Editable_ selection. The following options are possible:

*   **Auto**  
    This is the default behavior in which the note will be editable by default, unless it becomes large enough to trigger read-only mode.
*   **Read-only**  
    The note will be always marked as read-only, regardless of its size. Nevertheless, it's still possible to temporarily edit the note if needed. This is generally useful for notes that are not prone to change.
*   **Always Editable**  
    This option will bypass the automatic read-only activation for this particular note. It's useful for large notes that are frequently edited.

If the _Editable_ section is missing from the ribbon, then the note type does not support read-only mode.

### Manually setting the options

Apart from using the ribbon as previously mentioned, it's also possible to use [labels](../../Advanced%20Usage/Attributes.md) to change the behavior:

*   To set as read-only, apply the `readOnly` label to the note.
*   To disable automatic read-only (always editable), apply the `autoReadOnlyDisabled` label.

## Temporarily editing a read-only note

When accessing a read-only note, it's possible to temporarily edit it by using the ![](Read-Only%20Notes_image.png) button in the <a class="reference-link" href="../UI%20Elements/Floating%20buttons.md">Floating buttons</a> area.

When pressed, the note will become editable but will become read-only again after navigating to a different note.

## Special read-only behavior

Some note types have a special behavior based on whether the read-only mode is enabled:

*   <a class="reference-link" href="../../Note%20Types/Mermaid%20Diagrams.md">Mermaid Diagrams</a> will hide the Mermaid source code and display the diagram preview in full-size. In this case, the read-only mode can be easily toggled on or off via a dedicated button in the <a class="reference-link" href="../UI%20Elements/Floating%20buttons.md">Floating buttons</a> area.
*   <a class="reference-link" href="../../Collections/Geo%20Map.md">Geo Map View</a> will disallow all interaction that would otherwise change the map (dragging notes, adding new items).