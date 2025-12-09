# Quick edit
<figure class="image image-style-align-right image_resized" style="width:53.13%;"><img style="aspect-ratio:895/694;" src="Quick edit_image.png" width="895" height="694"></figure>

_Quick edit_ provides an alternative to the standard tab-based navigation and editing.

Instead of clicking on a note which switches the <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Note Tree</a> to the newly selected note, or navigating between two different <a class="reference-link" href="../UI%20Elements/Tabs.md">Tabs</a>, the _Quick edit_ feature opens as a popup window that can be easily dismissed.

This feature is also well integrated with <a class="reference-link" href="../../Collections.md">Collections</a> such as the calendar view, which makes it easy to edit entries without having to go back and forth between the child note and the calendar.

## Feature highlights

*   All note types are supported, including <a class="reference-link" href="../../Collections.md">Collections</a>.
*   Note that the <a class="reference-link" href="../Notes/Note%20List.md">Note List</a> will not be displayed, except for notes of type <a class="reference-link" href="../../Collections.md">Collections</a>.
*   For <a class="reference-link" href="../../Note%20Types/Text.md">Text</a> notes, depending on user preference, both the floating and classic editors are supported. See <a class="reference-link" href="../../Note%20Types/Text/Formatting%20toolbar.md">Formatting toolbar</a>.
*   The title and the note and the icon are editable, just like a normal tab.
*   The <a class="reference-link" href="../../Advanced%20Usage/Attributes/Promoted%20Attributes.md">Promoted Attributes</a> are also displayed.
    *   This integrates well with <a class="reference-link" href="../../Collections.md">Collections</a> where there are predefined attributes such as the _Start date_ and _End date_, allowing for easy editing.

## Accessing the quick edit

*   From the <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Note Tree</a>:
    *   Right click on a note and select _Quick edit_.
    *   or, press <kbd>Ctrl</kbd>+<kbd>Right click</kbd> on a note.
*   On <a class="reference-link" href="../../Note%20Types/Text/Links/Internal%20(reference)%20links.md">Internal (reference) links</a>: 
    *   Right click and select _Quick edit_.
    *   or, press <kbd>Ctrl</kbd>+<kbd>Right click</kbd> on the link.
*   On a <a class="reference-link" href="../UI%20Elements/Note%20Tooltip.md">Note Tooltip</a>, press the quick edit icon.
*   In <a class="reference-link" href="../../Collections.md">Collections</a>:
    *   For <a class="reference-link" href="../../Collections/Calendar.md">Calendar</a>:
        *   Clicking on an event will open that event for quick editing.
        *   If the calendar is for the <a class="reference-link" href="../../Advanced%20Usage/Advanced%20Showcases/Day%20Notes.md">Day Notes</a> root, clicking on the day number will open the popup for that day note.
    *   For <a class="reference-link" href="../../Collections/Geo%20Map.md">Geo Map</a>:
        *   Clicking on a marker will open that marker, but only if the map is in read-only mode.

## Handling of read-only notes

The Quick edit feature has a unique behavior for <a class="reference-link" href="../Notes/Read-Only%20Notes.md">Read-Only Notes</a>: 

*   If the note is read-only due to performance reasons (auto read-only), then the note is made editable for quick editing.
*   If the note has been manually set to read-only, then the note is read-only to prevent accidental change.
    *   In this case, the note can still be edited by on-screen instructions.