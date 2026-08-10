# Attributes tab
<figure class="image image-style-align-right image_resized" style="width:34.71%;"><img style="aspect-ratio:596/1688;" src="Attributes tab_image.png" width="596" height="1688"></figure>

The attributes tab provides a more graphical way to view and edit [attributes](../../../Advanced%20Usage/Attributes.md).

## Sections

The following information is displayed in sections:

*   _Owned attributes_, contains a list of the attributes that belong to this note.
*   _Inherited attributes_ are attributes that apply to the current note but come through <a class="reference-link" href="../../../Advanced%20Usage/Attributes/Attribute%20Inheritance.md">Attribute Inheritance</a>.
*   _Definitions_ describe the type of attributes and are used in <a class="reference-link" href="../../../Advanced%20Usage/Attributes/Promoted%20Attributes.md">Promoted Attributes</a> and <a class="reference-link" href="../../../Collections/Table.md">Table</a> collections.

## Owned attributes

Every item is structured as such:

*   The icon of each item indicates whether it's a [label](../../../Advanced%20Usage/Attributes/Labels.md) or a [relation](../../../Advanced%20Usage/Attributes/Relations.md) (link to another note).
*   The first text is the name of the label.
*   The value of the attribute is displayed after the name, if present.
    *   The value is shown in a graphical way: a relation's value is a clickable note link; a color label shows a color chip.

System attributes (that have a special meaning in Trilium) show a small cog near the icon and are grouped separately from the user-defined ones.

Interaction:

*   Clicking on the item (apart from the value and links) reveals a dedicated popup where the name, value and <a class="reference-link" href="../../../Advanced%20Usage/Attributes/Attribute%20Inheritance.md">Attribute Inheritance</a> can be defined.
*   The value of the attributes can be edited in-place:
    *   The input box follows the type defined in a corresponding label definition (date, color, dropdown, numbers), as well as for system attributes that have a specific type (e.g. `color`).
    *   For labels, clicking on the value edits its in-place.
        *   Press <kbd>Enter</kbd> to confirm or click outside the input box, or <kbd>Esc</kbd> to dismiss.
        *   For multi-line text, <kbd>Ctrl</kbd>+<kbd>Enter</kbd> confirms whereas <kbd>Enter</kbd> creates a newline.
    *   For boolean values, clicking on the checkbox will toggle its state.
    *   For labels without a value, a value can be added by clicking on the _No value_ text which appears while the mouse is hovered on the item.
    *   For relations, there is a dedicated pencil button instead.
*   An attribute can be deleted by pressing the X button to its right, which only appears while hovered. A confirmation screen is displayed first to ensure the attribute is not accidentally deleted.

Attributes can be added in two ways:

*   A new label, relation or attribute definition can be added from the + button near the title of the section. This shows the full detail popup.
*   To quickly add a label or a relation directly from the sidebar, click the _Add attribute_ item at the end of the list.
    *   The name field will be focused first. By default, a label will be created instead but it can be toggled to a relation by typing <kbd>~</kbd> or pressing the icon (similarly, typing `#` will switch back to a label instead of a relation).
    *   Once the name is filled, press <kbd>Enter</kbd> to continue to the value. Type in a value if desired and then press <kbd>Enter</kbd> again to create the attribute.
    *   Clicking outside the editor will also create the attribute, but only if a name is specified.

## Inherited attributes

Inherited labels or relations are shown in the same fashion as _Owned attributes_.

The only differences are:

*   To the right of the inherited attribute there is a link to the note where the attribute comes from, as well as an icon to indicate that it's inheritable.
*   Clicking on an inherited attribute will reveal the same popup as owned attributes, but it is not editable. To edit it, first navigate to the note where the attribute is defined.

## Definitions

For attribute definition (see <a class="reference-link" href="../../../Advanced%20Usage/Attributes/Promoted%20Attributes.md">Promoted Attributes</a>):

*   The icon indicates the type of the attribute (text, number).
    *   If an attribute is promoted, it has a small chevron icon overlaid on top of it.
*   The name indicates the name of the attribute it defines (without the `label:` or `relation:` prefix).
*   To the right of the name a short summary is displayed which indicates the display name (alias), whether it has multiple values or an inverse relation.
*   Clicking on a definition reveals a popup, where the name, type, display name and other aspects can be configured.
*   A new label or relation definition can be added from the + button near the title of the section.
*   For inherited definition, there is a link to the note where the definition comes from, as well as an icon to indicate that it's inherited.

## Mobile

The attributes can also be edited visually on mobile, but not as part of the sidebar. Go to <a class="reference-link" href="../Note%20buttons.md">Note buttons</a> and select _Note attributes_.