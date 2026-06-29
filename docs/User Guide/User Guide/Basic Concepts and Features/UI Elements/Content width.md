# Content width
Some note types such as <a class="reference-link" href="../../Note%20Types/Text.md">Text</a>, <a class="reference-link" href="../../Note%20Types/Relation%20Map.md">Relation Map</a>, and saved search intentionally limit the width of the content.

This might appear surprising at first, but the idea is to make text fit well on wider screens without appearing distorted. This is especially the case if the document contains <a class="reference-link" href="../../Note%20Types/Text/Images.md">Images</a>, tables or other width-dependent elements.

## Configuring the content width and alignment

The content width is expressed in pixels and can be changed from <a class="reference-link" href="Options.md">Options</a> → _Appearance_ → _Content Width_ and adjusting the _Max content width_ section.

To effectively disable the content width limitation, simply set the width to a value larger than your screen size (e.g. 9999).

By default, the content is aligned to the left, but it can be centered horizontally by checking _Keep content centered_ from the same section as the content width.

## Adjusting at note level

For notes with large elements such as <a class="reference-link" href="../../Note%20Types/Text/Tables.md">Tables</a>, it sometimes makes sense to avoid the content width without affecting other notes. To do so:

*   Since v0.104.0 in the <a class="reference-link" href="New%20Layout.md">New Layout</a> only, go to <a class="reference-link" href="Note%20buttons.md">Note buttons</a> and toggle _Full width_.
*   Or manually apply the `fullContentWidth` [label](../../Advanced%20Usage/Attributes/Labels.md) to the note.

> [!NOTE]
> Some [note types](../../Note%20Types.md) are full width by default, such as the <a class="reference-link" href="../../Note%20Types/Canvas.md">Canvas</a>. In that case the _Full width_ toggle will not be displayed and the label will have no effect.