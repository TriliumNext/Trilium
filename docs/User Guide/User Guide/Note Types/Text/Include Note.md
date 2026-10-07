# Include Note
Text notes can "include" another note as a read-only widget or an interactive widget, depending on the type of note.

This can be useful for e.g. including a dynamically generated chart (from scripts & "render HTML" note) or other more advanced use cases.

## Including a note

In the <a class="reference-link" href="Formatting%20toolbar.md">Formatting toolbar</a>, look for the <span class="tn-icon cke cke-trilium-note"></span> button. There is also a keyboard shortcut defined for it but it is not allocated by default.

To include a note that is already linked, right-click a reference link to it in a text note being edited and select _Convert link to an included note_, at the end of the menu. The include gets the box size that suits the note, as one added from the button does.

An [attachment](../../Basic%20Concepts%20and%20Features/Notes/Attachments.md) can be included the same way, from the context menu of a link to it (see _Embedding an attachment_ there).

A link to blocks of a text note is converted the same way, with _Convert link to note excerpt_, and the include then shows only those blocks. See <a class="reference-link" href="Block%20references.md">Block references</a>.

## Box sizes

The box size sets how much of the included note is shown.

*   _Tiny_ shows a single row instead of the content: the note's icon, its title with the path to the note above it, and buttons to act on the note. The included note is never rendered, so wherever the note is shown outside the editor, such as in print, in a tooltip or on a shared page, a _Tiny_ include appears as a link to the included note.
*   _Small_ and _Medium_ show the content in a box of limited height. Text scrolls inside the box, while a picture, a diagram or a video is scaled down to fit it.
*   _Full_ shows the whole content.
*   _Expandable_ shows only the title until its <span class="tn-icon bx bx-chevron-right"></span> arrow is pressed.

A new include gets the size that suits what it shows:

*   _Tiny_ for a note or an attachment that has no preview, such as a relation map or an archive.
*   _Small_ for audio.
*   _Full_ for a code note or a code file, such as a `.js`, `.py` or `.txt` attachment, and for an excerpt of the blocks of a text note.
*   _Medium_ for anything else.

The dialog that includes a note selects that size once the note is picked, and you can choose another one there. To change the size later, select the include and use the _Box size_ menu in its toolbar, or the _Size_ submenu of its _More actions_ menu.

## Resizing

A _Small_, _Medium_ or _Expandable_ include can be resized to any width and height. A _Tiny_ or _Full_ include always fits its content.

*   To resize an include, select it and drag the handle in its bottom-right corner. To change only the width or only the height, drag the middle of its right or bottom edge instead, where a touch screen shows a handle too. In right-to-left text, the handle is in the bottom-left corner and the width changes from the left edge.
*   Resizing works with a mouse, a pen or a finger.
*   While the height changes, moving the handle near the top or the bottom of the note scrolls the note.
*   An include narrower than the note is centered, so changing its width moves both of its sides. Making it as wide as the note returns it to the full width.
*   To cancel a resize, press <kbd>Esc</kbd> before releasing the handle.
*   To reset the size, double-click the corner handle, or double-tap it on a touch screen. Double-clicking the right or bottom edge resets only the width or the height.
*   Choosing a box size resets the height. Choosing _Tiny_ or _Full_ resets the width too.
*   While an _Expandable_ include is collapsed, only its width can be changed.

## Caption

An include can have a caption, shown centered at the bottom of its box. The caption is part of the text note, so it can be formatted like the rest of the text, for example in bold or with a link.

*   To add a caption, select the include, press the <span class="tn-icon cke cke-caption"></span> _Toggle caption on_ button in its toolbar and type the caption.
*   To remove the caption, press the same button again. Pressing it once more brings back the text it had, as long as the note stays open.
*   A _Tiny_ include has no caption. Switching an include to _Tiny_ removes its caption, and switching it back to a larger size restores the caption, as long as the note stays open.
*   An _Expandable_ include shows its caption under the title while the content is collapsed, and under the content once it is expanded.

## Title

The title row of an include links to the included note and holds its buttons. To show only the content, select the include and press the <span class="tn-icon bx bx-window-alt"></span> _Show title_ button in its toolbar. Pressing it again shows the title.

*   While the title is hidden, the <span class="tn-icon cke cke-three-vertical-dots"></span> _More actions_ button in the toolbar of the include opens the menu of the included note.
*   A _Tiny_ or _Expandable_ include always shows its title, and its toolbar has no _Show title_ button.

## Opening an included note

To open an included note in a new tab, press the <span class="tn-icon bx bx-link-external"></span> _Open in new tab_ button at the end of its title. An embedded attachment has the same button.

The <span class="tn-icon bx bx-dots-vertical-rounded"></span> _More actions_ button at the end of the title row opens the same menu as right-clicking anywhere on the title row: the other places to open the note in and, for an embedded attachment, the actions on the attachment.

In a note being edited, the menu also has the commands of the include's toolbar: the _Size_ submenu, _Show title_ and _Show caption_, each checked while it is in effect, and _Convert to link_ at the end. A drawing canvas, an included text or code note and an embedded code file also have _Editable_, above _Size_. For an embedded attachment they follow its first group of actions; for an included note they end the menu.

To show an include of size _Medium_ or _Full_ on the whole screen, press the <span class="tn-icon bx bx-fullscreen"></span> _Fullscreen_ button at the end of its title. An excerpt of the blocks of a note has an <span class="tn-icon bx bx-pencil"></span> _Edit excerpt_ button there instead; see <a class="reference-link" href="Block%20references.md">Block references</a>. To return, press <span class="tn-icon bx bx-exit"></span> _Exit fullscreen_ in the top-right corner, or <kbd>Esc</kbd>.

A _Tiny_ include has these buttons instead, followed by the same _More actions_ button:

*   For a note, <span class="tn-icon bx bx-edit"></span> _Quick edit_ opens the note in <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Navigation/Quick%20edit.md">Quick edit</a>, and <span class="tn-icon bx bx-link-external"></span> _Open in new tab_ opens it in a new tab.
*   For an embedded attachment, <span class="tn-icon bx bx-file-find"></span> _Open externally_ opens the file in another application, and <span class="tn-icon bx bx-download"></span> _Download_ downloads it. The size of the file is shown under its title.

## Converting an include to a link

To replace an include with a link to the included note, select it and press the <span class="tn-icon cke cke-link"></span> _Convert to link_ button in its toolbar, or choose _Convert to link_ at the end of its _More actions_ menu. An embedded attachment turns into a link to the attachment the same way.

## Included notes in the share functionality

If a [shared note](../../Advanced%20Usage/Sharing.md) contains one or more included notes, they will be displayed in the content of the note as if they were part of the note itself. The caption of an include is shown under the included content. A _Tiny_ include is shown as a link to the included note instead.

For this to work, the included notes must also be shared, otherwise they will not be shown. However, the included notes can still be hidden from the note tree via `#shareHiddenFromTree`.

## Interactive notes

Since v0.104.0, included notes might become interactive depending on their note type:

*   <a class="reference-link" href="../../Collections.md">Collections</a> (e.g. <a class="reference-link" href="../../Collections/Geo%20Map.md">Geo Map</a>) will render fully interactive, including creating new notes.
*   <a class="reference-link" href="../Saved%20Search.md">Saved Search</a> will also display the results.
*   <a class="reference-link" href="../Web%20View.md">Web View</a> provides an interactive preview of the website.

## Included images

An included image, whether an image note or an image attachment, is shown in the image viewer, which zooms and pans it:

*   To zoom, press the <span class="tn-icon bx bx-plus-circle"></span> _Zoom in_ and <span class="tn-icon bx bx-minus-circle"></span> _Zoom out_ buttons in the bottom-right corner of the image, or pinch on a touch screen. The percentage between them resets the zoom.
*   To zoom with the mouse wheel, click the image first. Until then, the mouse wheel scrolls the note.
*   To pan an image that is zoomed in, drag it. At its fitted size, dragging the image on a touch screen scrolls the note.
*   To return to the fitted size, double-click the image.

In a _Small_ or _Medium_ box, the image is scaled down to fit the height of the box. In fullscreen, it fits the screen.

## Editing an include in place

An included text note, an included code note and an embedded code file such as a `.js`, `.py` or `.txt` attachment can be edited without leaving the note that includes them. A code note or file is shown with syntax highlighting until then.

*   To edit, select the include and turn on the <span class="tn-icon bx bx-edit-alt"></span> _Editable_ button at the start of its toolbar, or check _Editable_ in its <span class="tn-icon cke cke-three-vertical-dots"></span> _More actions_ menu. Turn _Editable_ off to return to the preview.
*   While an included text note has the focus, the formatting toolbar applies to it. The notes it includes in turn stay read-only.
*   Code is edited in the same code editor as a <a class="reference-link" href="../Code.md">Code</a> note, with its theme, indentation and line wrapping settings.
*   The changes are saved as you type, to the included note or to the attachment, as they would be in its own tab.
*   An include of <a class="reference-link" href="Block%20references.md">Block references</a> edits only the referenced blocks.
*   Editing is not available in a [read-only note](../../Basic%20Concepts%20and%20Features/Notes/Read-Only%20Notes.md), for an included note marked `#readOnly`, or for an attachment of another note.

## Drawing canvases

A drawing canvas is an Excalidraw canvas, like the one of a <a class="reference-link" href="../Canvas.md">Canvas</a> note, drawn directly in the text note. It is not a note of its own: the drawing is kept in a `Canvas.excalidraw` [attachment](../../Basic%20Concepts%20and%20Features/Notes/Attachments.md) of the text note and is saved together with the text.

*   To insert a drawing canvas, open the <span class="tn-icon cke cke-plus"></span> _Insert_ menu of the <a class="reference-link" href="Formatting%20toolbar.md">Formatting toolbar</a> and choose <span class="tn-icon bx bx-pen"></span> _Drawing canvas_, above _Mermaid diagram_. It is also available as _Drawing canvas_ in the <a class="reference-link" href="Slash%20Commands.md">Slash Commands</a>. The canvas is added empty and editable, in a _Medium_ box with its title hidden, and takes the focus, ready for drawing.
*   To draw on a canvas that does not have the focus, click it first. Until then, the mouse wheel and touch gestures scroll the note. The canvas then has the tools, menus and keyboard shortcuts of a Canvas note. The toolbars, the menus and the properties of the selected shapes show only while the canvas has the focus, so elsewhere the drawing reads like a picture in the text.
*   A new drawing has the background color of the note. A background chosen from the Excalidraw menu replaces it.
*   To protect a finished drawing from accidental changes, select it and turn off the <span class="tn-icon bx bx-edit-alt"></span> _Editable_ button at the start of its toolbar, or uncheck _Editable_ in its <span class="tn-icon cke cke-three-vertical-dots"></span> _More actions_ menu. The drawing can then be panned and zoomed but not changed, and its toolbar holds only the zoom buttons. To draw again, turn _Editable_ back on.
*   The box sizes, resizing, the caption and the title work as for an included note, but the toolbar of a drawing leaves the box size, _Show title_ and _Convert to link_ to its _More actions_ menu.
*   In the desktop layout, Excalidraw keeps its desktop interface however small the box is. In the mobile layout, a narrow or short box switches it to a compact interface. For more room, choose _Full_, or show the title and press <span class="tn-icon bx bx-fullscreen"></span> _Fullscreen_.
*   Pictures added to the drawing are stored in the same attachment.
*   In a [read-only note](../../Basic%20Concepts%20and%20Features/Notes/Read-Only%20Notes.md), the drawing can be viewed but not changed.

### Limitations

*   The Excalidraw shape library is not saved for a drawing canvas.
*   Outside the editor, for example in a tooltip, when printing or in the list of attachments, the drawing is shown as a picture. On a [shared page](../../Advanced%20Usage/Sharing.md), it appears as a link to download `Canvas.excalidraw`.
*   A copy of a drawing canvas pasted in the same note shares the drawing with the original, so a change to one shows in the other only after the note is opened again. A copy pasted in another note gets a drawing of its own.