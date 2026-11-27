# Handwriting
> [!IMPORTANT]
> Handwriting is a new type of note and is currently considered experimental/beta.

Handwriting notes are sheets of digital paper to write and sketch on with a pen, a mouse or a finger. Unlike <a class="reference-link" href="Canvas.md">Canvas</a> notes, which are aimed at diagrams, a handwriting note has only ink tools and stays responsive across many pages of writing, which suits taking notes on a tablet.

## Creating a handwriting note

Right click an existing note in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>, select _Insert child note_ and look for _Handwriting_.

## Interaction

### Writing and erasing

*   To write, select the <span class="tn-icon bx bx-pen"></span> _Pen_ and draw on the page. A pen that senses pressure draws a thicker line the harder it is pressed. With a mouse or a finger, the thickness follows the speed of the stroke.
*   To highlight, select the <span class="tn-icon bx bx-highlight"></span> _Highlighter_, which draws a wide, see-through line of even thickness.
*   To erase, select the <span class="tn-icon bx bx-eraser"></span> _Eraser_ and drag across the ink. By default, the eraser removes every stroke it touches as a whole. While the eraser is selected, a rail on the side of the note offers the two ways to erase: to erase only the ink under the eraser, select <span class="tn-icon bx bx-cut"></span> _Erase parts of strokes_, and to go back, <span class="tn-icon bx bx-eraser"></span> _Erase whole strokes_. A stroke cut that way becomes separate strokes on either side, which keep the thickness they had. The setting applies to the device it is changed on. The eraser end of a pen (on pens that have one) erases whichever tool is selected, in the same way, and so does holding the button on the barrel of the pen.
*   To undo or redo, press the <span class="tn-icon bx bx-undo"></span> and <span class="tn-icon bx bx-redo"></span> buttons. On a touch screen, a short tap with two fingers also undoes.

### Color and thickness

While the pen or the highlighter is selected, a rail on the side of the note sets its color and thickness. Each of the two tools keeps its own.

*   To change the thickness, select one of the three presets (_Fine_, _Medium_ or _Bold_), or adjust it in small steps with the <span class="tn-icon bx bx-plus"></span> and <span class="tn-icon bx bx-minus"></span> buttons. The button between them shows the current thickness and resets it when pressed.
*   To change the color, select one of the five colors of the tool, or the last swatch (_Custom color..._) to pick any other.
*   The first color of the pen, _Text color_, follows the theme: such ink is dark on a light theme and light on a dark one, so it stays readable when the theme changes.
*   Any other color that would be hard to see is shown lighter in a dark theme (a dark blue becomes a light blue, keeping its hue), and darker in a light theme if it is nearly white. The note keeps the color as it was chosen.

### Pressure sensitivity

How much pressing harder thickens the pen's line is set in the <span class="tn-icon bx bx-dots-horizontal-rounded"></span> menu of the toolbar, under _Pressure sensitivity_. The sensitivity goes from 0, where every line keeps the same thickness however hard the pen is pressed, to 100, where a light touch draws a hairline and a firm one a line several times as thick. With a mouse or a finger, the setting changes how much the speed of the stroke changes the thickness instead.

*   To pick a sensitivity, select one of the presets: _Off_ (0), _Low_ (30), _Normal_ (60, the default), _High_ (80) or _Maximum_ (100).
*   To use a value between them, type it into the box of the _Custom_ row and press <kbd>Enter</kbd>, or step it by 5 with <kbd>Up</kbd> and <kbd>Down</kbd>.
*   The setting applies to the device it is changed on, like _Finger drawing_, as how a pen responds depends on the pen.
*   Each stroke keeps the sensitivity it was drawn with, so changing it only affects new strokes and never reshapes the ink already on the page.
*   The highlighter is not affected: it always draws a line of even thickness.

The cursor is a ring as wide as the line that the tool draws.

### Moving around the note

*   On a touch screen, drag with one finger to scroll and pinch with two fingers to zoom. Fingers do not draw, so the hand can rest on the screen while writing with a pen.
*   With a mouse, scroll to move up and down, hold <kbd>Shift</kbd> while scrolling to move sideways, and hold <kbd>Ctrl</kbd> while scrolling to zoom. Dragging with the middle button also moves the page, as does a pen button that the tablet maps to it.
*   To move the page with a pen or a mouse, select the <span class="tn-icon bx bx-move"></span> _Pan_ tool and drag, or hold <kbd>Space</kbd> and drag with any tool. This also works with a drawing tablet whose pen has no button mapped to the middle button.
*   With the _Pages_ layout, the buttons in the bottom-left corner show which page is on screen and the number of pages. The <span class="tn-icon bx bx-chevron-up"></span> and <span class="tn-icon bx bx-chevron-down"></span> buttons, or <kbd>Page Up</kbd> and <kbd>Page Down</kbd>, go to the top of the previous or next page without changing the zoom.
*   The buttons in the bottom-right corner zoom in and out, between 25% and 800%. Pressing the percentage goes back to 100%.
*   To see the whole width of the page, press the <span class="tn-icon bx bx-target-lock"></span> _Zoom to fit_ button. On an infinite canvas, it fits the width of the ink instead. Either way, the part of the note on screen stays in view.
*   To give the note the whole screen, press the <span class="tn-icon bx bx-fullscreen"></span> button. Press it again or <kbd>Esc</kbd> to go back.

A note opens at the place and zoom at which it was last left.

### Drawing with a finger

To write with a finger on a touch screen, open the <span class="tn-icon bx bx-dots-horizontal-rounded"></span> menu of the toolbar and turn on _Finger drawing_. One finger then draws, and two fingers scroll and zoom. The option only appears on devices with a touch screen and applies to that device alone, so a phone can draw with a finger while a tablet with a pen does not.

## Shapes

A shape drawn by hand can be turned into a clean one. Draw the shape in a single stroke and, at the end, keep the pen on the screen (or the mouse button down) without moving for about half a second.

| Shape | How to draw it | Result |
| --- | --- | --- |
| Line | A stroke that is roughly straight. | A straight line between the two ends of the stroke. While the pen stays down, the end of the line follows it, to aim the line or change its length. |
| Rectangle | Once around the four sides, ending near the start. The corners need to be roughly square. | A rectangle of the size drawn. It is made level if it was drawn nearly level and keeps its angle otherwise. |
| Triangle | Once around the three sides, ending near the start. | A triangle with straight sides between the corners drawn. If one side is nearly level or upright, the triangle is turned so that it is exactly so. |
| Circle or ellipse | Once around, ending near or past the start. | A circle if the shape is about as wide as it is tall, otherwise an ellipse. An ellipse drawn nearly level or upright is made exactly so. |
| Arrow | The shaft toward the tip, then, without lifting the pen, one side of the head out and back to the tip, and the other side out. | An arrow with a straight shaft and a head with two equal sides. |

*   A shape has the same thickness all along, taken from how hard the pen was pressed on average.
*   To get back the stroke as it was drawn, undo once. Undoing a second time removes it.
*   A stroke that is not recognized as one of these shapes stays as it was drawn.
*   Shapes work with the highlighter as well as with the pen.

> [!NOTE]
> Writing a large letter such as "O" and resting the pen at its end turns it into an ellipse. Lift the pen without pausing to keep the letter as written.

## Images

A picture, such as a photo of an exercise or a screenshot of a slide, can be placed on the paper and written over. Images always lie under the ink.

*   To add an image, press the <span class="tn-icon bx bx-plus"></span> _Insert_ button of the toolbar, select _Image_ and choose one or more files. On a phone or a tablet, the file chooser also offers the camera.
*   Alternatively, paste an image from the clipboard with <kbd>Ctrl</kbd>+<kbd>V</kbd>, or drag an image file onto the note.
*   A new image appears in the middle of the view, at its own size or smaller: on pages it fits inside the page, and on an infinite canvas inside the view. It is selected, and the _Select_ tool is picked, ready for the image to be moved into place.
*   To select an image later, pick the <span class="tn-icon bx bx-pointer"></span> _Select_ tool and press the image. With this tool, a drag that starts outside the images moves the page.
*   To move the selected image, drag it, or drag the <span class="tn-icon bx bx-move"></span> bar above it. To resize it, drag one of the handles at its corners; the image keeps its proportions.
*   To delete the selected image, press <kbd>Delete</kbd> or the <span class="tn-icon bx bx-trash"></span> button of the bar above it.
*   Adding, moving, resizing and deleting an image are undone and redone like ink.
*   The pen, the highlighter and the eraser leave images as they are, so ink on an image can be erased without removing the image.

In a dark theme, images are shown with their colors inverted, as the paper is: a white sheet with dark print becomes a dark sheet with light print, so ink in the _Text color_ stays readable over it. A photo therefore looks like a negative in a dark theme.

Each image is saved as an [attachment](../Basic%20Concepts%20and%20Features/Notes/Attachments.md) of the note, and is compressed as the images of <a class="reference-link" href="Text.md">Text</a> notes are. The attachment of a deleted image is kept for a while, in case the deletion is undone, and then erased.

## Writing on a PDF

A PDF, such as the slides of a lecture, can be the paper of a handwriting note, to write over its pages. A note can hold several PDFs, one after the other.

*   To add a PDF, press the <span class="tn-icon bx bx-plus"></span> _Insert_ button of the toolbar, select _PDF_ and choose one or more files, or drag PDF files onto the note.
*   Each page of the PDF lies on a sheet of the note, in order, under the images and the ink. The sheet takes the size of its page as printed, so a slide in landscape gets a sheet in landscape and an A4 page an A4 sheet.
*   Ink is not held to the sheets. To write more than a page has room for, write beside it or below it.
*   The note switches to the _Pages_ layout and shows a sheet for every page of the PDF. Once the last one has ink, A4 sheets follow.
*   The pages of a new PDF are added after the last sheet in use: after the pages of the PDFs already in the note, and after any sheet that has ink or an image. Nothing above them moves, and the view goes to the first new page.
*   To take a PDF away, open the <span class="tn-icon bx bx-dots-horizontal-rounded"></span> menu of the toolbar and select it by its file name under _Remove PDF_. Its sheets stay, empty, at their sizes, with the ink and the images on them, and the other PDFs stay on theirs.
*   In a dark theme, the pages are shown with their colors inverted, as images are.

The PDF is saved as an [attachment](../Basic%20Concepts%20and%20Features/Notes/Attachments.md) of the note and is not changed: the ink is kept in the note, not written into the file. To read the PDF with its text, links and outline, open the attachment, or keep the PDF as a <a class="reference-link" href="File.md">File</a> note as well.

## Configuration

The layout and the paper are set from the <span class="tn-icon bx bx-dots-horizontal-rounded"></span> menu of the toolbar and are saved with the note.

### Layout

*   _Pages_ (the default) shows a column of A4 sheets, or of sheets the size of the pages of a PDF (see _Writing on a PDF_ above). An empty page is added after the last page that has ink, so there is always room to continue.
*   _Infinite canvas_ removes the sheets and lets the ink extend in any direction.

### Paper

The paper is _Ruled_, _Grid_, _Dots_ or _Blank_. The rules and the dots follow the theme's text color, and the grid is pale blue. None of them are part of the ink.

## Previews

Wherever a handwriting note appears outside its own editor, it is shown as a picture: in the previews of <a class="reference-link" href="../Collections.md">Collections</a>, and when it is inserted as an image into a <a class="reference-link" href="Text.md">Text</a> note (including a shared one). The picture shows the first page, or all the ink and the images of an infinite canvas, and is updated each time the note is saved. Ink in the _Text color_ turns light when the picture is viewed in a dark theme, and images are inverted as in the note.

## Read-only mode

A [read-only](../Basic%20Concepts%20and%20Features/Notes/Read-Only%20Notes.md) handwriting note hides the tools and can only be scrolled and zoomed. A pen or a mouse then moves the page instead of drawing. A handwriting note is read-only only when it is set to be, from _Editable_ in the note menu or with the `readOnly` label: unlike a large code note, it never becomes read-only automatically because of its size.

A handwriting note that was saved by a newer version of Trilium is also shown without the tools, with a notice above the page. The note can hold content that this version does not know, which a save would lose, so it can be read but not changed until Trilium is updated on that device.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| <kbd>P</kbd> | Select the pen. |
| <kbd>Shift</kbd>+<kbd>P</kbd> | Select the highlighter. |
| <kbd>E</kbd> | Select the eraser. |
| <kbd>V</kbd> | Select the select tool. |
| <kbd>H</kbd> | Select the pan tool. |
| <kbd>[</kbd> and <kbd>]</kbd> | Make the line thinner or thicker. |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> | Undo. |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> or <kbd>Ctrl</kbd>+<kbd>Y</kbd> | Redo. |
| <kbd>Ctrl</kbd>+<kbd>V</kbd> | Add the image on the clipboard. |
| <kbd>Delete</kbd> or <kbd>Backspace</kbd> | Delete the selected image. |
| <kbd>Space</kbd> (held) | Move the page by dragging with the pen or the mouse. |
| <kbd>Page Up</kbd> and <kbd>Page Down</kbd> | Go to the previous or next page. |
| <kbd>Esc</kbd> | Deselect the image, or leave fullscreen. |

## Importing from RNote

A document of [RNote](https://rnote.flxzt.net/) (a `.rnote` file) is imported as a handwriting note. Drag the file into the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>, or select _Import into note_ (see <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Import%20%26%20Export.md">Import &amp; Export</a>).

*   Pen strokes keep their position, color, thickness and pressure. Black ink becomes ink in the _Text color_, so it stays readable in a dark theme, and translucent ink becomes highlighter ink.
*   Lines and rectangles drawn with the shape tool become ordinary ink.
*   The note uses the infinite canvas, with the paper nearest to the background pattern of the document, and opens at the top of its ink, fitting its width.
*   Images keep their position and size, and are saved as attachments of the note. A rotated image is imported upright.
*   Typed text becomes text boxes at the same place, keeping its size, line breaks and colors. The text takes the font of the note, so its lines can break at other words than in RNote.
*   The other shapes, such as ellipses, and vector images are left out. A document with nothing that can be imported becomes a <a class="reference-link" href="File.md">File</a> note.

## Limitations

*   It is not possible to select, move or recolor ink that is already on the page.
*   Where a highlighter stroke crosses itself, erasing a part of it can leave two pieces that overlap, which show darker where they do.
*   A shape becomes ordinary ink once the pen is lifted, so it cannot be resized or moved afterwards.
*   An arrow is recognized only when it is drawn in a single stroke, in the order described above.
*   Handwriting is not converted to text, so [search](../Basic%20Concepts%20and%20Features/Navigation/Search.md) does not find what is written.
*   Outside the note itself, only a picture of the first page is shown (see _Previews_ above), and a handwriting note [shared](../Advanced%20Usage/Sharing.md) on a page of its own is not displayed.
*   The buttons of a pen work only if the tablet driver reports them as mouse buttons. A button mapped to a keystroke has no effect.
*   On an iPad or iPhone with a 120 Hz screen, Safari shows web pages at 60 frames per second, so the ink trails the pen further than in a native app. To draw at 120 frames per second, open _Settings_ → _Apps_ → _Safari_ → _Advanced_ → _Feature Flags_ on the device, turn off _Prefer Page Rendering Updates near 60fps_, and force-quit Safari. The flag applies to every website in Safari.
*   Images cannot be rotated or cropped, and always lie under the ink.
*   The pages of a PDF are pictures: their text cannot be selected or searched, and their links do not work. Zoomed in beyond about 200%, or 100% on a high-density screen, they are less sharp than the ink.
*   The pages of a PDF cannot be reordered, removed or rotated, and a note with its ink cannot be exported as a PDF yet.
*   Typed text and other kinds of content cannot be added. For those, use a <a class="reference-link" href="Canvas.md">Canvas</a> note.

## Under the hood

A handwriting note is stored as JSON that lists the objects on the paper from the lowest to the topmost, as well as the sheets with their size and the page of a PDF that lies on each. An object is a stroke with its color, thickness, pressure sensitivity and points, an image with its position, its size and the address of its attachment, or a text box with its position, its width and its text. Each object has an identifier that it keeps for as long as it exists, and the time at which it was made. To inspect the JSON, select _Note source_ from the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20menu.md">Note menu</a>.

Internally, a handwriting note is a <a class="reference-link" href="Code.md">Code</a> note with the media type `application/vnd.triliumnotes.handwriting+json`. A version of Trilium older than handwriting notes that syncs with the same document therefore leaves these notes intact, and shows them as code notes holding that JSON. Do not edit them there.