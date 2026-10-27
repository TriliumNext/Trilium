# Search in note
<figure class="image image_resized" style="width:100%;"><img style="aspect-ratio:898/93;" src="Search in note_image.png" width="898" height="93"></figure>

Local search allows you to search within the currently displayed note. 

## Alternatives

*   Pressing <kbd>Ctrl</kbd>+<kbd>F</kbd> while in a browser while not focused in a <a class="reference-link" href="../../Note%20Types/Text.md">Text</a> or a <a class="reference-link" href="../../Note%20Types/Code.md">Code</a> note will trigger the browser's native search. This will also find text that is part of Trilium's UI.
*   Pressing <kbd>Ctrl</kbd>+<kbd>F</kbd> in a <a class="reference-link" href="../../Note%20Types/Text.md">Text</a> note will reveal <a class="reference-link" href="../../Advanced%20Usage/Technologies%20used/CKEditor.md">CKEditor</a>'s search functionality.

## Accessing the search

*   On desktop, press<kbd>Ctrl</kbd> + <kbd>F</kbd>.
*   From the <a class="reference-link" href="../UI%20Elements/Note%20menu.md">Note menu</a>, select _Find_ in the row of icons at the top.
*   In <a class="reference-link" href="Quick%20edit.md">Quick edit</a>, both open a search bar at the bottom of the popup, for the note in the popup.

## Interaction

*   Finding:
    *   Fill in the _Find in text…_ with the text to search for.
    *   The search will be executed automatically in the background.
    *   Use up and down arrows of the text box to navigate between results.
*   Replacing:
    *   Fill in the _Find in text_… field with the text to replace.
    *   Fill in the _Replace with…_ field the text to replace it with.
    *   Press _Replace_ to replace only the current result.
    *   Press _Replace all_ to replace all of them at once.
*   Options:
    *   _Case sensitive_ – the search will distinguish upper case characters from lower case (e.g. searching for Hello will not match `hello`).
    *   _Match words_ - the search will find only exact word matches (e.g. searching for `Java` will not match `JavaScript`).

## Included notes

In a <a class="reference-link" href="../../Note%20Types/Text.md">Text</a> note, the search also finds the text of the notes included with <a class="reference-link" href="../../Note%20Types/Text/Include%20Note.md">Include Note</a>, in the order they appear in the note.

*   The text of included text and code notes and of embedded code files, such as a `.js` or `.txt` attachment, is searched. The title of an include and the content of other notes, such as a collection or a drawing, are not.
*   The up and down arrows move through the results of an include as through the rest of the note.
*   A result in a collapsed _Expandable_ include expands the include while that result is the current one, and collapses it again once the search moves on.
*   _Replace_ and _Replace all_ change an included note only while its _Editable_ button is on. While the current result is in an include that cannot be edited, _Replace_ is disabled, and _Replace all_ leaves such results unchanged.