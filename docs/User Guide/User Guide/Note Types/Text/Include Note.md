# Include Note
Text notes can "include" another note as a read-only widget. This can be useful for e.g. including a dynamically generated chart (from scripts & "render HTML" note) or other more advanced use cases.

## Including a note

In the <a class="reference-link" href="Formatting%20toolbar.md">Formatting toolbar</a>, look for the ![](Include%20Note_image.png) button. There is also a keyboard shortcut defined for it but it is not allocated by default.

## Included notes in the share functionality

If a [shared note](../../Advanced%20Usage/Sharing.md) contains one or more included notes, they will be displayed in the content of the note as if they were part of the note itself.

For this to work, the included notes must also be shared, otherwise they will not be shown. However, the included notes can still be hidden from the note tree via `#shareHiddenFromTree`.