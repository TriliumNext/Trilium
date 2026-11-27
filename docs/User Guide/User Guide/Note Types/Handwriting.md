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
*   To erase, select the <span class="tn-icon bx bx-eraser"></span> _Eraser_ and drag across the ink. The eraser removes every stroke it touches as a whole. The eraser end of a pen (on pens that have one) erases whichever tool is selected, and so does holding the button on the barrel of the pen.
*   To undo or redo, press the <span class="tn-icon bx bx-undo"></span> and <span class="tn-icon bx bx-redo"></span> buttons. On a touch screen, a short tap with two fingers also undoes.

### Color and thickness

While the pen or the highlighter is selected, a rail on the side of the note sets its color and thickness. Each of the two tools keeps its own.

*   To change the thickness, select one of the three presets (_Fine_, _Medium_ or _Bold_), or adjust it in small steps with the <span class="tn-icon bx bx-plus"></span> and <span class="tn-icon bx bx-minus"></span> buttons. The button between them shows the current thickness and resets it when pressed.
*   To change the color, select one of the five colors of the tool, or the last swatch (_Custom color..._) to pick any other.
*   The first color of the pen, _Text color_, follows the theme: such ink is dark on a light theme and light on a dark one, so it stays readable when the theme changes.

### Pressure sensitivity

How much pressing harder thickens the pen's line is set with the <span class="tn-icon bx bx-tachometer"></span> _Pressure sensitivity_ button on the rail, which shows while the pen is selected. Its slider goes from 0, where every line keeps the same thickness however hard the pen is pressed, to 100, where a light touch draws a hairline and a firm one a line several times as thick. The default is 60. With a mouse or a finger, the setting changes how much the speed of the stroke changes the thickness instead.

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

## Configuration

The layout and the paper are set from the <span class="tn-icon bx bx-dots-horizontal-rounded"></span> menu of the toolbar and are saved with the note.

### Layout

*   _Pages_ (the default) shows a column of A4 sheets. An empty page is added after the last page that has ink, so there is always room to continue.
*   _Infinite canvas_ removes the sheets and lets the ink extend in any direction.

### Paper

The paper is _Ruled_, _Grid_, _Dots_ or _Blank_. The lines follow the theme and are not part of the ink.

## Previews

Wherever a handwriting note appears outside its own editor, it is shown as a picture: in the previews of <a class="reference-link" href="../Collections.md">Collections</a>, and when it is inserted as an image into a <a class="reference-link" href="Text.md">Text</a> note (including a shared one). The picture shows the first page, or all the ink of an infinite canvas, and is updated each time the note is saved. Ink in the _Text color_ turns light when the picture is viewed in a dark theme.

## Read-only mode

A [read-only](../Basic%20Concepts%20and%20Features/Notes/Read-Only%20Notes.md) handwriting note hides the tools and can only be scrolled and zoomed. A pen or a mouse then moves the page instead of drawing.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| <kbd>P</kbd> | Select the pen. |
| <kbd>Shift</kbd>+<kbd>P</kbd> | Select the highlighter. |
| <kbd>E</kbd> | Select the eraser. |
| <kbd>H</kbd> | Select the pan tool. |
| <kbd>[</kbd> and <kbd>]</kbd> | Make the line thinner or thicker. |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> | Undo. |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> or <kbd>Ctrl</kbd>+<kbd>Y</kbd> | Redo. |
| <kbd>Space</kbd> (held) | Move the page by dragging with the pen or the mouse. |
| <kbd>Page Up</kbd> and <kbd>Page Down</kbd> | Go to the previous or next page. |
| <kbd>Esc</kbd> | Leave fullscreen. |

## Importing from RNote

A document of [RNote](https://rnote.flxzt.net/) (a `.rnote` file) is imported as a handwriting note. Drag the file into the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>, or select _Import into note_ (see <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Import%20%26%20Export.md">Import &amp; Export</a>).

*   Pen strokes keep their position, color, thickness and pressure. Black ink becomes ink in the _Text color_, so it stays readable in a dark theme, and translucent ink becomes highlighter ink.
*   Lines and rectangles drawn with the shape tool become ordinary ink.
*   The note uses the infinite canvas, with the paper nearest to the background pattern of the document, and opens at the top of its ink, fitting its width.
*   Typed text, images and the other shapes are left out, as a handwriting note cannot hold them. A document with no ink at all is imported as a <a class="reference-link" href="File.md">File</a> note instead.

## Limitations

*   The eraser removes whole strokes. It is not possible to erase a part of a stroke, or to select, move or recolor ink that is already on the page.
*   A shape becomes ordinary ink once the pen is lifted, so it cannot be resized or moved afterwards.
*   An arrow is recognized only when it is drawn in a single stroke, in the order described above.
*   Handwriting is not converted to text, so [search](../Basic%20Concepts%20and%20Features/Navigation/Search.md) does not find what is written.
*   Outside the note itself, only a picture of the first page is shown (see _Previews_ above), and a handwriting note [shared](../Advanced%20Usage/Sharing.md) on a page of its own is not displayed.
*   The buttons of a pen work only if the tablet driver reports them as mouse buttons. A button mapped to a keystroke has no effect.
*   Text, images and other kinds of content cannot be added. For those, use a <a class="reference-link" href="Canvas.md">Canvas</a> note.

## Under the hood

A handwriting note is stored as JSON that lists the strokes with their color, thickness, pressure sensitivity and points. To inspect it, select _Note source_ from the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20menu.md">Note menu</a>.