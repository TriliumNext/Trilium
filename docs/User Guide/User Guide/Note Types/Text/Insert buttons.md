# Insert buttons
Press the <span class="tn-icon cke cke-plus"></span> button in the <a class="reference-link" href="Formatting%20toolbar.md">Formatting toolbar</a> to reveal special inserable items and blocks such as symbols, Math expressions and separators.

## Bookmarks

See the dedicated <a class="reference-link" href="Anchors.md">Anchors</a> section.

## Emoji

<figure class="image image-style-align-right image_resized" style="width:42.4%;"><img style="aspect-ratio:366/410;" src="Insert buttons_plus.png" width="366" height="410"></figure>

This feature allows inserting Unicode emoji characters. Simply select a category and a desired emoji to insert it.

Emojis can also be searched by their English name and the skin tone can be selected via a combo box to the right.

There is also the possibility of inserting emojis directly by typing `:` followed by a name of an emoji, triggering the display of a list of emojis. Simply use the arrow keys to select one and press <kbd>Enter</kbd> or <kbd>Tab</kbd> to insert it.

<img src="1_Insert buttons_plus.png" width="272" height="187">

## Symbols

<figure class="image image-style-align-right"><img style="aspect-ratio:346/322;" src="Insert buttons_image.png" width="346" height="322"></figure>

Pressing the <span class="tn-icon cke cke-special-characters"></span> button will reveal a popup window displaying a list of characters that are generally more difficult to insert directly from the keyboard, such as a subset of emojis, quotation characters, etc.

Interaction:

*   Click on a character to insert it at the current cursor position.
*   The window can be dragged around by the top bar where the title is, to avoid it getting in the way of the text.
*   Click on the _Category_ selector to filter the characters.

## Multicolumn layout

See the dedicated <a class="reference-link" href="Multicolumn%20layout.md">Multicolumn layout</a> page.

## Math equations

See the dedicated <a class="reference-link" href="Math%20Equations.md">Math Equations</a> page.

## Drawing canvas

Choose <span class="tn-icon bx bx-pen"></span> _Drawing canvas_ to draw on an Excalidraw canvas inside the text. See _Drawing canvases_ in <a class="reference-link" href="Include%20Note.md">Include Note</a>.

## Mermaid diagram

Press the <span class="tn-icon cke cke-trilium-mermaid-insert"></span> button to create an inline Mermaid diagram. The arrow next to it lists a template for each kind of diagram. The diagram is also available as _Mermaid diagram_ in the <a class="reference-link" href="Slash%20Commands.md">Slash Commands</a>.

This feature is quite similar to the <a class="reference-link" href="../Mermaid%20Diagrams.md">Mermaid Diagrams</a> note types and is meant as an alternative to it for simple diagrams. For more complex diagrams, use the <a class="reference-link" href="Include%20Note.md">Include Note</a> feature for a dedicated Mermaid note.

<figure class="image"><img style="aspect-ratio:1174/358;" src="2_Insert buttons_image.png" width="1174" height="358"></figure>

A diagram shows in a box like the one of an included note, so it can be resized, given another box size (_Small_, _Medium_ or _Full_) from its <span class="tn-icon cke cke-three-vertical-dots"></span> _More actions_ menu or shown in fullscreen, as described in <a class="reference-link" href="Include%20Note.md">Include Note</a>.

*   The <span class="tn-icon bx bx-edit-alt"></span> _Editable_ button at the start of the diagram's toolbar decides whether its source can be changed. While it is off, the source still shows, but read-only.
*   The buttons next to it choose what the diagram shows, as for a Mermaid note: <span class="tn-icon bx bx-code"></span> _Source view_ for the Mermaid source alone, <span class="tn-icon bx bxs-dock-left"></span> _Split view_ for the source with the diagram next to it, and <span class="tn-icon bx bx-show"></span> _Preview_ for the diagram alone. Its _More actions_ menu offers the same choice.
*   The _Word wrap_ and _Line numbers_ submenus of its _More actions_ menu change how the source shows, each with _Auto_, _On_ and _Off_, as for an included code note (see _Editing an include in place_ in <a class="reference-link" href="Include%20Note.md">Include Note</a>).
*   A new diagram starts editable, in _Split view_. The diagram updates a moment after you stop typing. If the source has an error, the error shows over the last diagram that worked, which stays dimmed, as in a Mermaid note. On desktop, drag the divider between the source and the diagram to resize them.
*   A diagram without a chosen view shows the source next to the diagram while it is editable, and the diagram alone otherwise. In a read-only note, the source can never be changed. A read-only note and the AI chat show a diagram in the same box, in the view it was saved with, and with the zoom buttons over the diagram instead of in a toolbar. A _Medium_ or _Full_ diagram also has a <span class="tn-icon bx bx-fullscreen"></span> _Fullscreen_ button there, or over the source in the _Source_ view.
*   To zoom, use the <span class="tn-icon bx bx-zoom-out"></span> and <span class="tn-icon bx bx-zoom-in"></span> buttons of the diagram's toolbar; the zoom level between them resets the zoom. In fullscreen, where the toolbar is hidden, the same buttons show over the diagram. Drag the diagram to move around it, and double-click it to reset the view. The mouse wheel scrolls the note until you click the diagram, and then zooms it.
*   While the source shows, the <span class="tn-icon bx bx-help-circle"></span> _Mermaid syntax help_ button at the end of the toolbar opens the help on <a class="reference-link" href="../Mermaid%20Diagrams.md">Mermaid Diagrams</a>, which links to the Mermaid syntax.
*   The changes made to the source of a diagram are part of the undo history of the text note, in the order they were made. <kbd>Ctrl</kbd>+<kbd>Z</kbd> and <kbd>Ctrl</kbd>+<kbd>Y</kbd> undo and redo them from the source as well as from the text, as described in _Editing an include in place_ in <a class="reference-link" href="Include%20Note.md">Include Note</a>.

The source of the diagram stays in the note as a Mermaid code block, so the diagram is exported to Markdown as a `mermaid` code block that other applications can show.

Diagrams created in earlier versions keep the view they were saved with, and open editable.

## Horizontal ruler

This feature will display a horizontal line, generally useful to separate different sections of the text. To do so, press the <span class="tn-icon cke cke-horizontal-line"></span> button in the <a class="reference-link" href="Formatting%20toolbar.md">Formatting toolbar</a>.

<img src="1_Insert buttons_image.png" width="502" height="95">

Alternatively, it's possible to insert a horizontal ruler by typing `---`.

## Page break

<figure class="image image-style-align-right"><img style="aspect-ratio:371/79;" src="3_Insert buttons_image.png" width="371" height="79"></figure>

Page breaks provide a way to force the next paragraph or block (table, image, etc.) to be displayed onto the next page when printing (either to a real printer to [when exporting to PDF](../../Basic%20Concepts%20and%20Features/Notes/Printing%20%26%20Exporting%20as%20PDF.md)).

Page breaks are marked in the editor with the words _Page break_, but they will not actually be shown when printed.

*   To insert a page break, press the <span class="tn-icon cke cke-page-break"></span> in the formatting toolbar.
*   To insert many page breaks at once, insert a page break first, click on it and press <kbd>Ctrl</kbd>+<kbd>C</kbd>. Then use <kbd>Ctrl</kbd>+<kbd>V</kbd>, to paste as many times as needed.

## Date and time

The <span class="tn-icon cke cke-trilium-date-time"></span> button inserts the current date and time at the cursor, replacing the selected text if there is any. The inserted text takes the formatting of the text around it, so a date inserted inside bold text is bold too.

*   To insert the date in the default format, press the button itself or press <kbd>Alt</kbd>+<kbd>T</kbd>.
*   To insert it in another format, press the arrow next to the button and pick a format from the list. Each entry shows the current date and time in that format: the default one, the date or the time alone, the date written out, and ISO 8601.
*   The same formats are offered by the <a class="reference-link" href="Slash%20Commands.md">Slash Commands</a>: type `/date`, `/time`, `/now` or `/today`. The _Insert date/time_ entry uses the default format, and shows what it inserts underneath; the other entries show their output in the title.

The default format can be changed in <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Text Notes_ → _Editor_ → _Date/time format_, using [Day.js format tokens](https://day.js.org/docs/en/display/format) (for example `DD.MM.YYYY HH:mm`).

## Icons

Icons just like the ones for the [note icon](../../Basic%20Concepts%20and%20Features/Notes/Note%20Icons%20%26%20Colors.md) can be inserted in text. For more information see <a class="reference-link" href="Insert%20buttons/Icons.md">Icons</a>.