# Include Note
Text notes can "include" another note as a read-only widget or an interactive widget, depending on the type of note.

This can be useful for e.g. including a dynamically generated chart (from scripts & "render HTML" note) or other more advanced use cases.

## Including a note

In the <a class="reference-link" href="Formatting%20toolbar.md">Formatting toolbar</a>, look for the ![](Include%20Note_image.png) button. There is also a keyboard shortcut defined for it but it is not allocated by default.

## Included notes in the share functionality

If a [shared note](../../Advanced%20Usage/Sharing.md) contains one or more included notes, they will be displayed in the content of the note as if they were part of the note itself.

For this to work, the included notes must also be shared, otherwise they will not be shown. However, the included notes can still be hidden from the note tree via `#shareHiddenFromTree`.

## Interactive notes

Since v0.104.0, included notes might become interactive depending on their note type:

*   <a class="reference-link" href="../../Collections.md">Collections</a> (e.g. <a class="reference-link" href="../../Collections/Geo%20Map.md">Geo Map</a>) will render fully interactive, including creating new notes.
*   <a class="reference-link" href="../Saved%20Search.md">Saved Search</a> will also display the results.
*   <a class="reference-link" href="../Web%20View.md">Web View</a> provides an interactive preview of the website.