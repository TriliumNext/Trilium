# Outline tab
The Outline tab appears in the <a class="reference-link" href="../Right%20Sidebar.md">Right Sidebar</a> and displays the headings and highlights for the current note.

## Table of contents

The table of contents displays the titles / headings in the current note and allows easy navigation.

The following note types are supported:

*   <a class="reference-link" href="../../../Note%20Types/Text.md">Text</a>
*   <a class="reference-link" href="../../../Note%20Types/Markdown.md">Markdown</a>
*   <a class="reference-link" href="../../../Note%20Types/File/PDFs.md">PDFs</a>
*   <a class="reference-link" href="../../../AI.md">AI</a> chat notes
*   The pages of the in-app documentation

<figure class="image image-style-align-right image_resized" style="width:47%;"><img style="aspect-ratio:556/205;" src="1_Outline tab_image.png" width="556" height="205"></figure>

### Interaction

*   Clicking on a heading will scroll the document to the position of the heading.
*   Pressing the close button will dismiss the table of contents but it can be shown again from the <a class="reference-link" href="../Floating%20buttons.md">Floating buttons</a> section.

### Configuration

> [!NOTE]
> This section is relevant only for the old layout, the <a class="reference-link" href="../New%20Layout.md">New Layout</a> shows the table of contents regardless of the number of headings.

*   To change the option globally, go to <a class="reference-link" href="#root/_hidden/_options/_optionsTextNotes">Text Notes</a> options, look for the _Table of Contents_ section and configure the minimum amount of headings that need to be present in the current note in order for the table of contents to show:
    *   To always hide it, set the value to a really large number (e.g. 10000).
    *   To always display it if there's at least a single heading, set the value to 1.
*   Use <a class="reference-link" href="../../../Advanced%20Usage/Attributes.md">Attributes</a> to configure the table of contents for a particular note:
    *   `#toc=show` will show the table of contents for that note regardless of the global settings.
    *   Similarly, `#toc=hide` will always hide the table of contents for that note.

## Highlights

<figure class="image image-style-align-right image_resized" style="width:46.04%;"><img style="aspect-ratio:489/240;" src="Outline tab_image.png" width="489" height="240"></figure>

Similar to the table of contents, but instead of headings this feature will list highlighted text from a text note and allow easy navigation to them.

Unlike table of contents which supports multiple note types, the highlights are specific to the <a class="reference-link" href="../../../Note%20Types/Text.md">Text</a> notes.

Highlighted text is defined as:

*   Bold text.
*   Italic text.
*   Underlined text.
*   Text with a foreground color set.
*   Text with a background color/highlight set.

### Interaction

*   Clicking on a highlighted text will scroll the document to its position.
*   For the old layout only, pressing the close button will dismiss the list of highlights but it can be shown again from the <a class="reference-link" href="../Floating%20buttons.md">Floating buttons</a> section.

### Configuration

*   Globally, it's possible to toggle the display of each category of highlighted text (as defined above) 
    *   For the new layout, pressing the gear button in the top-right part of the section will reveal a menu to toggle between the highlight categories.
    *   Alternatively, they can be changed by going to <a class="reference-link" href="#root/_hidden/_options/_optionsTextNotes">Text Notes</a> settings and looking for the _Highlights List_ section.
*   For the old layout only, to suppress the display of highlighted text for one specific note, use <a class="reference-link" href="../../../Advanced%20Usage/Attributes.md">Attributes</a> to add the `#hideHighlightWidget` label.

## PDF-specific outline

When <a class="reference-link" href="../../../Note%20Types/File/PDFs.md">PDFs</a> are opened in Trilium, the <a class="reference-link" href="../Right%20Sidebar.md">Right Sidebar</a> is augmented with PDF-specific navigation, with the following features:

*   Table of contents/outline
    *   All the headings and “bookmarks” will be displayed hierarchically.
    *   The heading on the current page is also highlighted (note that it can be slightly offset depending on how many headings are on the same page).
    *   Clicking on a heading will jump to the corresponding position in the PDF.
*   Pages
    *   A preview of all the pages with a small thumbnail.
    *   Clicking on a page will automatically navigate to that page.
*   Annotations
    *   Highlight and comment annotations are listed here.
    *   For the old layout, this feature is not directly available, however there is a listing of comments directly in the PDF toolbar.
*   Attachments
    *   If the PDF has its own attachments (not to be confused with Trilium's <a class="reference-link" href="../../Notes/Attachments.md">Attachments</a>), they will be displayed in a list.
    *   Some information such as the name and size of the attachment are displayed.
    *   It's possible to download the attachment by clicking on the download button.
*   Layers
    *   A less common feature, if the PDF has toggle-able layers, these layers will be displayed in a list here.
    *   It's possible to toggle the visibility for each individual layer.