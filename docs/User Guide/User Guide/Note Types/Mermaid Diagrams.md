# Mermaid Diagrams
> [!TIP]
> For a quick understanding of the Mermaid syntax, see <a class="reference-link" href="Mermaid%20Diagrams/Syntax%20reference.dat">Syntax reference</a> (official documentation).

<figure class="image"><img style="aspect-ratio:1464/915;" src="Mermaid Diagrams_image.png" width="1464" height="915"></figure>

Trilium supports Mermaid, which adds support for various diagrams such as flowchart, sequence diagram, class diagram, state diagram, pie charts, etc., all using a text description of the chart instead of manually drawing the diagram.

This note type is a split view, meaning that both the source code and a preview of the document are displayed side-by-side. See <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20types%20with%20split%20view.md">Note types with split view</a> for more information.

## Sample diagrams

Starting with v0.103.0, Mermaid diagrams no longer start with a sample flowchart, but instead a pane at the bottom will show all the supported diagrams with sample code for each:

*   Simply click on any of the samples to apply it.
*   The pane will disappear as soon as something is typed in the code editor or a sample is selected. To make it appear again, simply remove the content of the note.

## Layouts

Depending on the chart being edited and user preference, there are two layouts supported by the Mermaid note type:

*   Horizontal, where the source code (editable part) is on the left side of the screen and the preview is to the right.
*   Vertical, where the source code is at the bottom of the screen and the preview is at the top.

It's possible to switch between the two layouts at any time by pressing the <span class="tn-icon bx bxs-dock-left"></span> icon in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20buttons.md">Note buttons</a>.

## Interaction

*   The source code of the diagram (in Mermaid format) is displayed on the left or bottom side of the note (depending on the layout).
    *   Changing the diagram code will refresh automatically the diagram.
*   The preview of the diagram is displayed at the right or top side of the note (depending on the layout):
    *   There are dedicated buttons at the bottom-right of the preview to control the zoom in, zoom out or fit the diagram.
    *   The preview can be moved around by holding the left mouse button and dragging.
    *   Zooming can also be done by using the scroll wheel.
    *   The zoom and position on the preview will remain fixed as the diagram changes, to be able to work more easily with large diagrams.
    *   Double-clicking the preview resets the zoom/position.
    *   The preview can also be focused by clicking on it, case in which keyboard shortcuts can be used:
        *   <kbd>+</kbd> or <kbd>E</kbd> to zoom in, <kbd>-</kbd> or <kbd>Q</kbd> to zoom out.
        *   <kbd>/</kbd> to reset the zoom/position.
        *   Arrow keys or <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> to pan. Holding <kbd>Shift</kbd> pans faster.
*   The size of the source/preview panes can be adjusted by hovering over the border between them and dragging it with the mouse.
*   In the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20buttons.md">Note buttons</a>:
    *   The source/preview can be laid out left-right (via <span class="tn-icon bx bxs-dock-left"></span>) or bottom-top (via <span class="tn-icon bx bxs-dock-bottom"></span>).
    *   Press the <span class="tn-icon bx bx-copy"></span> (_Copy image reference to the clipboard_) to be able to insert the image representation of the diagram into a text note. See <a class="reference-link" href="Text/Images/Image%20references.md">Image references</a> for more information.
*   To export the diagram as either SVG or PNG, go to the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20buttons.md">Note buttons</a> and select _Export as image_:
    *   Select _SVG (vector)_ to download a scalable/vector rendering of the diagram. Can be used to present the diagram without degrading when zooming.
    *   Select _PNG (raster)_ to download a normal image (at 1x scale, raster) of the diagram. Can be used to send the diagram in more traditional channels such as e-mail.
*   The note can be marked as [read-only](../Basic%20Concepts%20and%20Features/Notes/Read-Only%20Notes.md), case in which it switches by default to the preview (although it can be switched back using the source/preview buttons) and the source is no longer editable.

## Errors in the diagram

If there is an error in the source code, the error will be displayed in an information pane.

During the state of an error, the diagram will no longer be rendered and the previously working diagram will remain in the preview section.