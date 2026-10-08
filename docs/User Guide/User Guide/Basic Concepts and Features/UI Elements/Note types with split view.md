# Note types with split view
Split view is a feature of <a class="reference-link" href="../../Note%20Types/Mermaid%20Diagrams.md">Mermaid Diagrams</a> and <a class="reference-link" href="../../Note%20Types/Markdown.md">Markdown</a> notes which displays both the source code on one side and the preview of the content on the other.

<a class="reference-link" href="../../Note%20Types/Mermaid%20Diagrams.md">Mermaid Diagrams</a> also allow changing between a horizontal or a vertical split, to accommodate for the various sizes of diagrams.

## Display modes and interaction

The split comes with three different display modes which can be toggled from the <a class="reference-link" href="Note%20buttons.md">Note buttons</a>:

*   <span class="tn-icon bx bxs-dock-left"></span> _(Split view)_, in which both the source code is available on one side and can be edited, and the preview is available on the other side.
    *   In this mode, the size of either the source pane or the preview pane can be adjusted by dragging the small border between them.
*   <span class="tn-icon bx bx-code"></span> (_Source view)_ which shows the source code on the entire screen for a more focused editing experience.
*   <span class="tn-icon bx bx-show"></span> _(Preview)_ which displays only the rendering of the diagram or text in full screen, especially useful for read-only notes.

The display node is stored at note level.

## Relation to read-only notes

If a note is marked as [read-only](../Notes/Read-Only%20Notes.md), the source view will not be editable. While in preview mode, marking a note as read-only has no effect since the preview itself is not editable.