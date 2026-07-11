# Presentation
<figure class="image"><img style="aspect-ratio:1120/763;" src="Presentation_image.png" width="1120" height="763"></figure>

The Presentation view allows the creation of slideshows directly from within Trilium.

### Creating a new presentation

Right click on an existing note in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a> and select _Insert child note_ and look for _Presentation_.

## How it works

*   Each slide is a child note of the collection.
*   The order of the child notes determines the order of the slides.
*   Unlike traditional presentation software, slides can be laid out both horizontally and vertically (see belwo for more information).
*   Direct children will be laid out horizontally and the children of those will be laid out vertically. Children deeper than two levels of nesting are ignored.

## Interaction and navigation

In the floating buttons section (top-right):

*   Edit button to go to the corresponding note of the current slide.
*   Press Overview button (or the <kbd>O</kbd> key) to show a birds-eye view of the slides. Press the button again to disable it.
*   Press the “Start presentation” button to show the presentation in full-screen.

The following keyboard shortcuts are supported:

*   Press <kbd>←</kbd> and <kbd>→</kbd> (or <kbd>H</kbd> and <kbd>L</kbd>) to go to the slide on the left or on the right (horizontal).
*   Press <kbd>↑</kbd> and <kbd>↓</kbd>  (or <kbd>K</kbd> and <kbd>J</kbd>) to go to the upward or downward slide (vertical).
*   Press <kbd>Space</kbd> and <kbd>Shift</kbd> + <kbd>Space</kbd> or  to go to the next/previous slide in order.
*   And a few more, press <kbd>?</kbd> to display a popup with all the supported keyboard combinations.

## Vertical slides and nesting

Unlike traditional presentation software such as Microsoft PowerPoint, the slides in Trilium can be laid out horizontally or vertically in order to create depth or better organize the slides by topic.

This horizontal/vertical organization affects transitions (especially on the “slide” transition), however it is most noticeable in navigation.

*   Pressing <kbd>←</kbd> and <kbd>→</kbd> will navigate through slides horizontally, thus skipping vertical notes under the current slide. This is useful to skip entire chapters/related slides.
*   Pressing <kbd>↑</kbd> and <kbd>↓</kbd> will navigate through the vertical slides at the current level.
*   Pressing <kbd>Space</kbd> and <kbd>Shift</kbd> + <kbd>Space</kbd> will go to the next/previous slide in order, regardless of the direction. This is generally the key combination to use when presenting.
*   The arrows on the bottom-right of the slide will also reflect this navigation scheme.

<figure class="image image-style-align-right image_resized" style="width:55.57%;"><img style="aspect-ratio:890/569;" src="1_Presentation_image.png" width="890" height="569"></figure>

All direct children of the collection will be laid out horizontally. If a direct child also has children, those children will be placed as vertical slides.

In the following example, the note structure is as follows:

*   Presentation collection
    *   Trilium Notes (demo page)
    *   “Introduction” slide
        *   “The challenge of personal knowledge management”
        *   “Note-taking structures”
    *   “Demo & Feature highlights” slide
        *   “Really fast installation process”
        *   Video slide

## Customization

At collection level, it's possible to adjust:

*   The theme of the entire presentation to one of the predefined themes by going to the <a class="reference-link" href="Collection%20Properties.md">Collection Properties</a> and looking for the _Theme_ option.
*   It's currently not possible to create custom themes, although it is planned.
*   Note that it is note possible to alter the CSS via <a class="reference-link" href="../Theme%20development/Custom%20app-wide%20CSS.md">Custom app-wide CSS</a> because the slides are rendered isolated (in a shadow DOM).

At slide level:

*   It's possible to adjust the background color of a slide by using the [predefined promoted attribute](../Advanced%20Usage/Attributes/Promoted%20Attributes.md) for the color or manually setting `#slide:background` to a hex color.
*   More complex backgrounds can be achieved via gradients. There's no UI for it; it has to be set via `#slide:background` to a CSS gradient definition such as: `linear-gradient(to bottom, #283b95, #17b2c3)`.

## Tips and tricks

*   Text notes generally respect the formatting (bold, italic, foreground and background colors) and font size. Code blocks and tables also work.
*   Try using more than just text notes, the presentation uses the same mechanism as [shared notes](../Advanced%20Usage/Sharing.md) and <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Notes/Note%20List.md">Note List</a> so it should be able to display <a class="reference-link" href="../Note%20Types/Mermaid%20Diagrams.md">Mermaid Diagrams</a>, <a class="reference-link" href="../Note%20Types/Canvas.md">Canvas</a> and <a class="reference-link" href="../Note%20Types/Mind%20Map.md">Mind Map</a> in full-screen (without the interactivity).
    *   Consider using a transparent background for <a class="reference-link" href="../Note%20Types/Canvas.md">Canvas</a>, if the slides have a custom background (go to the hamburger menu in the Canvas, press the button select a custom color and write `transparent`).
    *   For <a class="reference-link" href="../Note%20Types/Mermaid%20Diagrams.md">Mermaid Diagrams</a>, some of them have a predefined background which can be changed via the frontmatter. For example, for XY-charts:
        
        ```
        ---
        config:
            themeVariables:
                xyChart:
                    backgroundColor: transparent
        ---
        ```

## Under the hood

The Presentation view uses [Reveal.js](https://revealjs.com/) to handle the navigation and layout of the slides.