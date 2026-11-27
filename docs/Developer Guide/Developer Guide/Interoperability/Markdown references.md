# Markdown references
This page explains how Trilium stores references to headings and other blocks in Markdown imports and exports.

## Reference anchors

Trilium stores the ID of a referenced block in an empty anchor.

```markdown
## Installation <a data-trilium-block-id="eaJkN47U8kI4"></a>

Download the package for your platform. <a data-trilium-block-id="Hq2LmT0vX9cB"></a>
```

An anchor in a block's text marks that block. On a line by itself, it marks the next block. A blank line follows the anchor.

```markdown
<a data-trilium-block-id="Zk3PqR8sT1uV"></a>

> A quote, referenced as a whole.
```

Trilium places anchors based on the block type.

| Block | Where Trilium stores the ID |
| --- | --- |
| Paragraph, list item, task list item | In an anchor at the end of the text |
| Heading | In an anchor at the end of the text, before any closing `#` characters |
| Table | In an anchor at the end of the first header cell |
| Tab in a tabs block | In an anchor at the end of the tab title, inside the quotes |
| Paragraph that starts with a block formula | In an anchor at the start of the line |
| Empty paragraph | In an anchor after `&nbsp;` |
| Code block, Mermaid diagram, quote, admonition, horizontal rule, tabs block | In an anchor on its own line above the block |
| Table that requires HTML, such as one without a header row | In the `data-trilium-block-id` attribute on the table's HTML wrapper, `<figure class="table" data-trilium-block-id="…">` |
| Other HTML, such as a collapsible block, included note or excerpt, image, aside, or multicolumn layout | In the `data-trilium-block-id` attribute on the element itself |

Inside a quote, list item, or tab, an anchor on its own line keeps the container's `>` prefix or indentation.

Trilium also accepts `<a data-trilium-block-id="ID" />` and an opening tag without a closing `</a>`. You can use single or double quotes around the ID. Keep the tag on one line and include only the `data-trilium-block-id` attribute.

An ID must contain at least one character. Colons are reserved for separating the ends of a range. Trilium generates IDs with 12 letters and digits. For other IDs, Trilium keeps `A` through `Z`, `a` through `z`, `0` through `9`, `_`, `.`, and `-` as written. It encodes other characters as numeric character references, such as `&#32;` for a space. Trilium decodes the ID before validating it, so an ID containing `&#58;` is invalid.

When Trilium renders a Markdown note, it moves the ID from the anchor to the block's HTML element. Text notes store IDs the same way, so this also happens when you import Markdown as a text note or convert a Markdown note to a text note.

```html
<h2 data-trilium-block-id="eaJkN47U8kI4">Installation</h2>
<p data-trilium-block-id="Hq2LmT0vX9cB">Download the package for your platform.</p>
```

Markdown notes also support named anchors such as `<a id="setup"></a>`. Link to a named anchor with `?bookmark=setup`. The `block` parameter is for block IDs.

## Links and excerpts

To link to a block, add the `block` parameter after the note ID. For a range, use the first and last block IDs with a colon between them.

```markdown
[[B9oMG6rFvvfq?block=eaJkN47U8kI4]]
[[B9oMG6rFvvfq?block=eaJkN47U8kI4:Zk3PqR8sT1uV]]
[Installation](#root/B9oMG6rFvvfq?block=eaJkN47U8kI4)
<figure class="include-note" data-note-id="B9oMG6rFvvfq" data-block="eaJkN47U8kI4:Zk3PqR8sT1uV" data-box-size="full"></figure>
```

The last example is an excerpt. It includes only the referenced blocks from the note.

## Behavior

### Headings

*   When you link to a heading through the _Add link_ dialog or the `@` list, Trilium adds an anchor at the end of the heading if it needs one. This updates the target note even if the note is read only.
*   The link follows the anchor when you rename the heading.
*   Leave the anchor out when reading the heading text. The table of contents and the _Add link_ dialog do this automatically.

### Ranges

*   A single block needs one anchor. A range uses two IDs, written as `start:end`, and needs an anchor on each end.
*   A range includes both blocks and everything between them. Trilium uses the order of the blocks in the note, so `end:start` gives the same result.
*   Blocks you add between the two anchors become part of the range.
*   Trilium reads ranges from the rendered note. A range covers whole blocks and preserves surrounding lists or quotes. A paragraph that wraps across several lines in the Markdown source still counts as one block.
*   A reference to a list item includes only that item's own text. Nested items are outside that reference.
*   If either anchor is missing, the whole reference breaks. An excerpt shows _Broken reference_.

### All anchors

*   Only the first anchor in a block counts.
*   Two different notes can use the same ID. Within a note, the ID belongs to the first block that uses it. When you copy a block within the same note, leave its anchor with the original.
*   Inside a code block or inline code, anchor markup is treated as text. For an HTML block, put the ID in the element's `data-trilium-block-id` attribute.
*   An anchor on its own line marks the next block. If you delete that block and leave the anchor, it marks whichever block comes next.
*   Other Markdown renderers hide an anchor inside a block and show an empty paragraph for an anchor on its own line. Renderers that escape HTML show the tag as text.

### Import and export

*   When you export a text note to a Markdown file or a ZIP archive, Trilium writes its block IDs as anchors. _Copy as Markdown_ and the scripting API function `api.htmlToMarkdown()` omit those anchors.
*   When you import Markdown as a text note, Trilium puts the block IDs in `data-trilium-block-id` attributes. When you import it as a Markdown note, Trilium keeps the source as written.
*   Trilium keeps block IDs when you convert between text and Markdown notes. Empty code blocks and tables with a single cell have nowhere to store an anchor in Markdown. Trilium reports any IDs lost from those blocks during conversion.
*   ZIP exports keep the `block` and `bookmark` parameters after the target file name. When you import the archive, Trilium carries those parameters over to the new note IDs. In the _HTML for web_ export format, a `bookmark` becomes a `#` fragment.