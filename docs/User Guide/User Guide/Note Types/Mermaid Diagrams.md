# Mermaid Diagrams
> [!TIP]
> For a quick understanding of the Mermaid syntax, see <a class="reference-link" href="Mermaid%20Diagrams/Syntax%20reference.dat">Syntax reference</a> (official documentation).

<figure class="image image-style-align-center"><img style="aspect-ratio:886/663;" src="2_Mermaid Diagrams_image.png" width="886" height="663"></figure>

Trilium supports Mermaid, which adds support for various diagrams such as flowchart, sequence diagram, class diagram, state diagram, pie charts, etc., all using a text description of the chart instead of manually drawing the diagram.

## Layouts

Depending on the chart being edited and user preference, there are two layouts supported by the Mermaid note type:

*   Horizontal, where the source code (editable part) is on the left side of the screen and the preview is to the right.
*   Vertical, where the source code is at the bottom of the screen and the preview is at the top.

It's possible to switch between the two layouts at any time by pressing the ![](Mermaid%20Diagrams_image.png) icon in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Floating%20buttons.md">Floating buttons</a> area.

## Interaction

*   The source code of the diagram (in Mermaid format) is displayed on the left or bottom side of the note (depending on the layout).
    *   Changing the diagram code will refresh automatically the diagram.
*   The preview of the diagram is displayed at the right or top side of the note (depending on the layout):
    *   There are dedicated buttons at the bottom-right of the preview to control the zoom in, zoom out or re-center the diagram: ![](1_Mermaid%20Diagrams_image.png)
    *   The preview can be moved around by holding the left mouse button and dragging.
    *   Zooming can also be done by using the scroll wheel.
    *   The zoom and position on the preview will remain fixed as the diagram changes, to be able to work more easily with large diagrams.
*   The size of the source/preview panes can be adjusted by hovering over the border between them and dragging it with the mouse.
*   In the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Floating%20buttons.md">Floating buttons</a> area:
    *   The source/preview can be laid out left-right or bottom-top via the _Move editing pane to the left / bottom_ option.
    *   Press _Lock editing_ to automatically mark the note as read-only. In this mode, the code pane is hidden and the diagram is displayed full-size. Similarly, press _Unlock editing_ to mark a read-only note as editable.
    *   Press the _Copy image reference to the clipboard_ to be able to insert the image representation of the diagram into a text note. See <a class="reference-link" href="Text/Images/Image%20references.md">Image references</a> for more information.
    *   Press the _Export diagram as SVG_ to download a scalable/vector rendering of the diagram. Can be used to present the diagram without degrading when zooming.
    *   Press the _Export diagram as PNG_ to download a normal image (at 1x scale, raster) of the diagram. Can be used to send the diagram in more traditional channels such as e-mail.

## Errors in the diagram

If there is an error in the source code, the error will be displayed in an information pane.

During the state of an error, the diagram will no longer be rendered and the previously working diagram will remain in the preview section.