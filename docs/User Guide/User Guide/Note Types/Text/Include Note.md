# Include Note
Text notes can "include" another note as a read-only widget or an interactive widget, depending on the type of note.

This can be useful for e.g. including a dynamically generated chart (from scripts & "render HTML" note) or other more advanced use cases.

## Including a note

In the <a class="reference-link" href="Formatting%20toolbar.md">Formatting toolbar</a>, look for the <span class="tn-icon cke cke-trilium-note"></span> button. There is also a keyboard shortcut defined for it but it is not allocated by default.

The _Include note_ dialog opens with two rows: _Note_, where you search for the note to include, and _Box size_ (see _Box sizes_ below), a row of buttons each with a small drawing of the size, with a sentence under it describing the size chosen. Once a note is picked, press _Include note_ or <kbd>Enter</kbd> to include it. Typing the title of a note that does not exist offers to create it.

An image note, a <a class="reference-link" href="../Canvas.md">Canvas</a> or a <a class="reference-link" href="../Mermaid%20Diagrams.md">Mermaid Diagrams</a> note picked in the dialog is inserted as an image rather than included, so instead of the size buttons, the _Box size_ row says so. In a text note, the image can be resized once it is in the text, and the dialog reminds you of that, as it reminds you that the size of an include can be changed later.

To include a note that is already linked, right-click a reference link to it in a text note being edited and select _Convert link to an included note_, at the end of the menu. The include gets the box size that suits the note, as one added from the button does.

An [attachment](../../Basic%20Concepts%20and%20Features/Notes/Attachments.md) can be included the same way, from the context menu of a link to it (see _Embedding an attachment_ there).

A link to blocks of a text note is converted the same way, with _Convert link to note excerpt_, and the include then shows only those blocks. See <a class="reference-link" href="Block%20references.md">Block references</a>.

## Box sizes

The box size sets how much of the included note is shown.

*   _Tiny_ shows a single row instead of the content: the note's icon, its title with the path to the note above it, and buttons to act on the note. The included note is never rendered, so wherever the note is shown outside the editor, such as in print, in a tooltip or on a shared page, a _Tiny_ include appears as a link to the included note.
*   _Small_ and _Medium_ show the content in a box of limited height. Text scrolls inside the box, while a picture, a diagram or a video is scaled down to fit it.
*   _Full_ shows the whole content.
*   _Expandable_ shows only the title until its <span class="tn-icon bx bx-chevron-right"></span> arrow is pressed. In a read-only note, a click anywhere on the title row other than its buttons and link expands or collapses it as well.

A new include gets the size that suits what it shows:

*   _Tiny_ for a note or an attachment that has no preview, such as a relation map or an archive.
*   _Small_ for audio.
*   _Full_ for a code note or a code file, such as a `.js`, `.py` or `.txt` attachment, and for an excerpt of the blocks of a text note.
*   _Medium_ for anything else.

The _Include note_ dialog selects that size among its _Box size_ buttons once the note is picked, and you can choose another one there. To change the size later, select the include and use the _Box size_ menu in its toolbar, or the _Size_ submenu of its _More actions_ menu. For an included code or Markdown note and an embedded code or Markdown file, the _Box size_ menu is the <span class="tn-icon bx bx-move-vertical"></span> button, whose tooltip names the current size.

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

In a note being edited, the menu also has the commands of the include's toolbar: the _Size_ submenu, _Show title_ and _Show caption_, each checked while it is in effect, and _Convert to link_ at the end. A drawing canvas, a Mermaid diagram, an included text, code or Markdown note and an embedded code or Markdown file also have _Editable_, above _Size_. An included code or Markdown note, an embedded code or Markdown file and a Mermaid diagram also have the _Word wrap_ and _Line numbers_ submenus after _Editable_ (see _Editing an include in place_ below). A Mermaid diagram, an included Markdown note and an embedded Markdown file also have _Source view_, _Split view_ and _Preview_ after these submenus. For an embedded attachment they follow its first group of actions; for an included note they end the menu.

To show an include of size _Medium_ or _Full_ on the whole screen, press the <span class="tn-icon bx bx-fullscreen"></span> _Fullscreen_ button at the end of its title. An excerpt of the blocks of a note has an <span class="tn-icon bx bx-pencil"></span> _Edit excerpt_ button there instead; see <a class="reference-link" href="Block%20references.md">Block references</a>. To return, press <span class="tn-icon bx bx-exit"></span> _Exit fullscreen_ in the top-right corner, or <kbd>Esc</kbd>.

A _Tiny_ include has these buttons instead, followed by the same _More actions_ button:

*   For a note, <span class="tn-icon bx bx-edit"></span> _Quick edit_ opens the note in <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Navigation/Quick%20edit.md">Quick edit</a>, and <span class="tn-icon bx bx-link-external"></span> _Open in new tab_ opens it in a new tab.
*   For an embedded attachment, <span class="tn-icon bx bx-file-find"></span> _Open externally_ opens the file in another application, and <span class="tn-icon bx bx-download"></span> _Download_ downloads it. The size of the file is shown under its title.

## Converting an include to a link

To replace an include with a link to the included note, select it and press the <span class="tn-icon cke cke-link"></span> _Convert to link_ button in its toolbar, or choose _Convert to link_ at the end of its _More actions_ menu. An embedded attachment turns into a link to the attachment the same way.

## Missing notes and attachments

An include whose note or attachment no longer exists, for example because it was deleted, keeps its size and shows the <span class="tn-icon bx bx-error-alt"></span> icon in place of the content, with the ID of the missing note or attachment. To remove the include, select it and press <kbd>Delete</kbd>.

Content added by a newer version of Trilium, which this version cannot show, appears the same way with the <span class="tn-icon bx bx-error"></span> icon. Editing the note keeps that content unchanged, so it shows again once Trilium is updated.

## Included notes in the share functionality

If a [shared note](../../Advanced%20Usage/Sharing.md) contains one or more included notes, they will be displayed in the content of the note as if they were part of the note itself. The caption of an include is shown under the included content. A _Tiny_ include is shown as a link to the included note instead, and so is an include that would show a note already shown around it, such as a note that includes itself. The same goes for a printed or exported note.

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

An included text note, an included code note and an embedded code file such as a `.js`, `.py` or `.txt` attachment can be edited without leaving the note that includes them. Until then, a code note or file is shown read-only in the code editor, where its code can be selected and copied, and its blocks folded and unfolded with the arrows in its gutter. Included Markdown can be edited too, see _Included Markdown_ below.

*   To edit, select the include and turn on the <span class="tn-icon bx bx-edit-alt"></span> _Editable_ button at the start of its toolbar, or check _Editable_ in its <span class="tn-icon cke cke-three-vertical-dots"></span> _More actions_ menu. Turn _Editable_ off to stop editing.
*   While _Editable_ is on, the arrow keys move the caret into the include and back out, as through the rest of the text. Entering from above or from the left puts the caret at the start of the include, and entering from below or from the right puts it at the end. A collapsed _Expandable_ include is skipped.
*   While an included text note has the focus, the formatting toolbar applies to it. The notes it includes in turn stay read-only.
*   Code is edited in the same code editor as a <a class="reference-link" href="../Code.md">Code</a> note, with its theme, indentation and line wrapping settings.
*   Typing `/` in the code lists the <a class="reference-link" href="../../Advanced%20Usage/Snippets/Code%20Snippets.md">Code Snippets</a> of its language, as in a code note.
*   The toolbar of an included code note or an embedded code file also has the language and indentation menus of the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Status%20bar.md">Status bar</a>, between _Editable_ and the <span class="tn-icon bx bx-move-vertical"></span> _Box size_ menu: _Change language mode_, which shows the current language, and _Change tab width_, which shows the current indentation. _Re-indent content to_ converts the indentation of the code itself and saves it to the included note or file, whether _Editable_ is on or off.
    *   For an included note, the menus change the note, as they do in its own tab.
    *   For an embedded code file, the language and indentation settings change only how this include shows the file, and are saved with the note that includes it. The language replaces the one that the file name gives, and the _Use default_ entries return to the indentation set in <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Code Notes_. These settings leave the file itself unchanged, and other includes of it keep their own settings.
*   The <span class="tn-icon cke cke-three-vertical-dots"></span> _More actions_ menu of an included code or Markdown note, an embedded code or Markdown file and a [Mermaid diagram](Insert%20buttons.md) has two more submenus after _Editable_, each with _Auto_, _On_ and _Off_. They change how the code editor shows the source.
    *   _Word wrap_ wraps long lines instead of scrolling them. _Auto_ follows the setting in <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Code Notes_. For an included note, it sets the `#wrapLines` label of the note, as the _Word wrap_ submenu of its <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20menu.md">Note menu</a> does for a code note. For an embedded file or a Mermaid diagram, it changes only this include.
    *   _Line numbers_ shows or hides the numbers at the start of each line. _Auto_ follows the setting in <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Code Notes_. It changes only this include, for an included note as well.
*   The changes are saved as you type, to the included note or to the attachment, as they would be in its own tab.
*   The changes made in the code editor of an include are part of the undo history of the note that includes it, together with the changes to its text, in the order they were made. This includes the source of included Markdown and of a [Mermaid diagram](Insert%20buttons.md), and the changes to a drawing canvas (see below).
    *   <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes the last change of the note, and <kbd>Ctrl</kbd>+<kbd>Y</kbd> or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> redoes it, whether the caret is in the text or in an include, and also while _Editable_ is off. The <span class="tn-icon cke cke-undo"></span> _Undo_ and <span class="tn-icon cke cke-redo"></span> _Redo_ buttons of the formatting toolbar do the same. With the Vim key bindings, `u` and <kbd>Ctrl</kbd>+<kbd>R</kbd> in an include do the same too.
    *   The focus moves to the change that was undone or redone: into the code editor or the drawing canvas of the include, or back to the text.
    *   Undoing a change of an included note saves the included note again. Once the included note has been changed elsewhere, for example in another tab, its earlier changes can no longer be undone from here, and undo skips them.
    *   An included text note keeps an undo history of its own.
*   An include of <a class="reference-link" href="Block%20references.md">Block references</a> edits only the referenced blocks.
*   Editing is not available in a [read-only note](../../Basic%20Concepts%20and%20Features/Notes/Read-Only%20Notes.md), for an included note marked `#readOnly`, or for an attachment of another note.
*   <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Navigation/Search%20in%20note.md">Search in note</a> finds the text of included text and code notes among the results of the note around them, and replaces it while _Editable_ is on.

## Included Markdown

An included <a class="reference-link" href="../Markdown.md">Markdown</a> note and an embedded Markdown file, such as a `.md` attachment, are shown with the same three views as a Markdown note in its own tab (see <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20types%20with%20split%20view.md">Note types with split view</a>): <span class="tn-icon bx bx-code"></span> _Source view_, <span class="tn-icon bx bxs-dock-left"></span> _Split view_ and <span class="tn-icon bx bx-show"></span> _Preview_.

*   To switch the view, press one of the three buttons in the title row of the include. In a note being edited, the toolbar of the include has the same buttons after _Editable_, and its <span class="tn-icon cke cke-three-vertical-dots"></span> _More actions_ menu has them as _Source view_, _Split view_ and _Preview_.
*   Until a view is chosen, the include shows the _Preview_, and the _Split view_ while _Editable_ is on.
*   To edit the Markdown, turn on _Editable_ (see _Editing an include in place_ above). The source is edited in the code editor of a Markdown note, and the preview follows the changes as you type. While _Editable_ is off, the source can be read and copied but not changed.
*   The source has the slash commands and the `@` and `[[` note links of a <a class="reference-link" href="../Markdown.md">Markdown</a> note. A note created from the `@` or `[[` list goes under the included note, or for an embedded file under the note that includes it, and `/image` uploads the image to that same note.
*   The _Word wrap_ and _Line numbers_ submenus of the _More actions_ menu change how the source shows, as for code (see _Editing an include in place_ above).
*   As in a Markdown note, the preview scrolls along with the source and highlights the block where the cursor is, and <kbd>Ctrl</kbd>+<kbd>B</kbd>, <kbd>Ctrl</kbd>+<kbd>I</kbd>, <kbd>Ctrl</kbd>+<kbd>M</kbd> and <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> format the selection.
*   In a note being edited, the view is saved with the include, so two includes of the same note can show different views. In a [read-only note](../../Basic%20Concepts%20and%20Features/Notes/Read-Only%20Notes.md), the view can be changed too, until the note is opened again.
*   While the source shows, the include has the height of its box size, or the height it was resized to. A _Full_ include fits its content instead.
*   <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Navigation/Search%20in%20note.md">Search in note</a> searches the source while it shows, and the preview otherwise.

## Drawing canvases

A drawing canvas is an Excalidraw canvas, like the one of a <a class="reference-link" href="../Canvas.md">Canvas</a> note, drawn directly in the text note. It is not a note of its own: the drawing is kept in a `Canvas.excalidraw` [attachment](../../Basic%20Concepts%20and%20Features/Notes/Attachments.md) of the text note and is saved together with the text.

*   To insert a drawing canvas, open the <span class="tn-icon cke cke-plus"></span> _Insert_ menu of the <a class="reference-link" href="Formatting%20toolbar.md">Formatting toolbar</a> and choose <span class="tn-icon bx bx-pen"></span> _Drawing canvas_, above _Mermaid diagram_. It is also available as _Drawing canvas_ in the <a class="reference-link" href="Slash%20Commands.md">Slash Commands</a>. The canvas is added empty and editable, in a _Medium_ box with its title hidden, and takes the focus, ready for drawing.
*   To draw or write over an image, select the image and press the <span class="tn-icon bx bxs-pen"></span> _Convert image to a drawing canvas_ button of its toolbar. The image is replaced by an editable drawing canvas in a _Medium_ box, with its title hidden and the focus in it. The image sits at its original size in the middle of the canvas, zoomed so that all of it shows, and is locked so that it cannot be selected or moved by accident. While it is locked, the canvas can be zoomed in on the image but not zoomed out past it or scrolled beyond its edges. To move or resize the image anyway, right-click it and choose _Unlock_. The caption of the image is kept, but not its alignment or link. Only an image on its own line can be converted, not one inside a paragraph. Undo brings the image back.
*   An Excalidraw file (`.excalidraw`) attached with _Attach and embed file_, under the <span class="tn-icon cke cke-paper-clip"></span>_Attach file_ button, becomes a drawing canvas too, in a _Medium_ box titled with the file name. It starts with _Editable_ off, so the drawing shows but cannot be changed until _Editable_ is turned on (see below).
*   To draw on a canvas that does not have the focus, click it first. Until then, touch gestures scroll the note. The canvas then has the tools, menus and keyboard shortcuts of a Canvas note. The toolbars, the menus and the properties of the selected shapes show only while the canvas has the focus, so elsewhere the drawing reads like a picture in the text.
*   The mouse wheel and the touchpad scroll the note over a canvas too, as over the text. To zoom, use the zoom buttons of the canvas toolbar; to move around the drawing, use the <span class="tn-icon bx bxs-hand"></span> _Hand_ tool. In fullscreen, the mouse wheel moves and zooms the drawing instead.
*   The canvas toolbar replaces the Excalidraw menu: _Export image_, _Find on canvas_, _Library_ and _Help_ are at the end of its <span class="tn-icon bx bx-category"></span> _More tools_ menu. In fullscreen, the Excalidraw menu shows again.
*   The changes to the drawing are part of the undo history of the text note (see _Editing an include in place_ above). <kbd>Ctrl</kbd>+<kbd>Z</kbd>, <kbd>Ctrl</kbd>+<kbd>Y</kbd> and the <span class="tn-icon bx bx-undo"></span> _Undo_ and <span class="tn-icon bx bx-redo"></span> _Redo_ buttons of the canvas toolbar undo and redo the last change of the note, in the drawing or in the text.
*   A new drawing has the background color of the note. A background chosen from the Excalidraw menu replaces it.
*   To protect a finished drawing from accidental changes, select it and turn off the <span class="tn-icon bx bx-edit-alt"></span> _Editable_ button at the start of its toolbar, or uncheck _Editable_ in its <span class="tn-icon cke cke-three-vertical-dots"></span> _More actions_ menu. The drawing then shows as a still picture, at the zoom and position it had, and can no longer be changed, zoomed or moved. To draw again, turn _Editable_ back on.
*   The box sizes, resizing, the caption and the title work as for an included note, but the toolbar of a drawing leaves the box size, _Show title_ and _Convert to link_ to its _More actions_ menu.
*   In the desktop layout, Excalidraw keeps its desktop interface however small the box is. In the mobile layout, a narrow or short box switches it to a compact interface. For more room, choose _Full_, or show the title and press <span class="tn-icon bx bx-fullscreen"></span> _Fullscreen_.
*   Pictures added to the drawing are stored in the same attachment. A converted image is kept as an image attachment of the note instead, named with a generated code.
*   In a [read-only note](../../Basic%20Concepts%20and%20Features/Notes/Read-Only%20Notes.md), the drawing shows as a still picture too.
*   On a [shared page](../../Advanced%20Usage/Sharing.md), the drawing is shown as a picture at its own size, whatever the size of its box, in light or dark colors to match the page. Each change to the drawing saves this picture as an SVG image attachment of the note, also named with a generated code.

### Limitations

*   The Excalidraw shape library is not saved for a drawing canvas.
*   Outside the editor, for example in a tooltip, when printing or in the list of attachments, the drawing is shown as a picture.
*   A drawing has no picture for shared pages until its first change, except one converted from an image. Until then, for example for an attached `.excalidraw` file, a shared page shows a link to download the drawing instead.
*   In Safari, the picture of a drawing on a shared page follows the light or dark appearance of the system rather than the theme chosen on the page.
*   A copy of a drawing canvas pasted in the same note shares the drawing with the original, so a change to one shows in the other only after the note is opened again. A copy pasted in another note gets a drawing of its own.