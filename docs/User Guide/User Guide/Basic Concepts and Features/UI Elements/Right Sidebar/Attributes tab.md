# Attributes tab
<figure class="image image-style-align-right image_resized" style="width:34.71%;"><img style="aspect-ratio:596/1688;" src="Attributes tab_image.png" width="596" height="1688"></figure>

The attributes tab provides a more graphical way to view and edit [attributes](../../../Advanced%20Usage/Attributes.md).

## Sections

The attributes are grouped into collapsible sections, each showing the number of attributes it holds next to its name:

*   _Owned_ contains a list of the attributes that belong to this note.
*   _Inherited_ contains the attributes that apply to the current note but come through <a class="reference-link" href="../../../Advanced%20Usage/Attributes/Attribute%20Inheritance.md">Attribute Inheritance</a>. This section is only displayed if the note inherits attributes.
*   _Definitions_ describe the type of attributes and are used in <a class="reference-link" href="../../../Advanced%20Usage/Attributes/Promoted%20Attributes.md">Promoted Attributes</a> and <a class="reference-link" href="../../../Collections/Table.md">Table</a> collections. This section is only displayed if the note has or inherits definitions.

Clicking the name of a section collapses or expands it, and the collapsed state is remembered.

## Toolbar

Above the sections there is a toolbar with:

*   A _Select all_ checkbox, which selects every attribute (see [Selecting attributes](#selecting-attributes)).
*   A <span class="tn-icon bx bx-paste"></span> button, which only appears after attributes are copied. It lists the copied attributes and offers to paste them into the current note or to clear them.
*   A <span class="tn-icon bx bx-plus"></span> _Add a new attribute_ button, which offers to add a label, a relation, a label definition or a relation definition. This shows the full detail popup.

On a note that cannot be edited (such as a page of the in-app help), the paste and add buttons are replaced by a <span class="tn-icon bx bx-lock-alt"></span> _Read-only_ indicator. Attributes can still be selected and copied from such a note.

## Owned attributes

Every item is structured as such:

*   The icon of each item indicates whether it's a [label](../../../Advanced%20Usage/Attributes/Labels.md) (<span class="tn-icon bx bx-hash"></span>) or a [relation](../../../Advanced%20Usage/Attributes/Relations.md) (<span class="tn-icon bx bx-transfer"></span>, link to another note).
*   The first text is the name of the label.
*   The value of the attribute is displayed after the name, if present.
    *   The value is shown in a graphical way: a relation's value is a clickable note link; a color label shows a color chip.

System attributes (that have a special meaning in Trilium) show a small <span class="tn-icon bx bx-cog"></span> cog near the icon and are grouped separately from the user-defined ones.

Interaction:

*   Clicking on the item (apart from the value and links) reveals a dedicated popup where the name, value and <a class="reference-link" href="../../../Advanced%20Usage/Attributes/Attribute%20Inheritance.md">Attribute Inheritance</a> can be defined.
*   The value of the attributes can be edited in-place:
    *   The input box follows the type defined in a corresponding label definition (date, color, dropdown, numbers), as well as for system attributes that have a specific type (e.g. `color`).
    *   For labels, clicking on the value edits its in-place.
        *   Press <kbd>Enter</kbd> to confirm or click outside the input box, or <kbd>Esc</kbd> to dismiss.
        *   For multi-line text, <kbd>Ctrl</kbd>+<kbd>Enter</kbd> confirms whereas <kbd>Enter</kbd> creates a newline.
    *   For checkbox attributes, clicking on the checkbox will toggle its state.
    *   For labels without a value, a value can be added by clicking on the _No value_ text which appears while the mouse is hovered on the item.
    *   For relations, there is a dedicated <span class="tn-icon bx bx-pencil"></span> button instead.
*   An attribute can be deleted by pressing the <span class="tn-icon bx bx-trash"></span> button to its right, which only appears while hovered. A confirmation screen is displayed first to ensure the attribute is not accidentally deleted.

Attributes can be added in two ways:

*   A new label, relation or attribute definition can be added from the <span class="tn-icon bx bx-plus"></span> button in the [toolbar](#toolbar). This shows the full detail popup.
*   To quickly add a label or a relation directly from the sidebar, click the _Add attribute_ (<span class="tn-icon bx bx-plus"></span>) item at the end of the list.
    *   The name field will be focused first. By default, a label will be created instead but it can be toggled to a relation by typing <kbd>~</kbd> or pressing the <span class="tn-icon bx bx-hash"></span> icon (similarly, typing `#` will switch back to a label instead of a relation).
    *   Once the name is filled, press <kbd>Enter</kbd> to continue to the value. Type in a value if desired and then press <kbd>Enter</kbd> again to create the attribute.
    *   Clicking outside the editor will also create the attribute, but only if a name is specified.

## Inherited attributes

Inherited labels or relations are shown in the same fashion as the owned ones.

The only differences are:

*   To the right of the inherited attribute there is a link to the note where the attribute comes from, as well as an <span class="tn-icon bx bx-sitemap"></span> icon to indicate that it's inheritable.
*   Clicking on an inherited attribute will reveal the same popup as owned attributes, but it is not editable. To edit it, first navigate to the note where the attribute is defined.

## Definitions

For attribute definition (see <a class="reference-link" href="../../../Advanced%20Usage/Attributes/Promoted%20Attributes.md">Promoted Attributes</a>):

*   The icon indicates the type of the attribute (text, number).
    *   If an attribute is promoted, it has a small <span class="tn-icon bx bx-chevron-up"></span> chevron icon overlaid on top of it.
*   The name indicates the name of the attribute it defines (without the `label:` or `relation:` prefix).
*   To the right of the name a short summary is displayed which indicates the display name (alias), whether it has multiple values or an inverse relation.
*   Clicking on a definition reveals a popup, where the name, type, display name and other aspects can be configured.
*   To add a label definition, click the _Add definition_ (<span class="tn-icon bx bx-plus"></span>) item at the end of the list; its type can be changed to a relation from the popup. Both kinds of definitions can also be added from the <span class="tn-icon bx bx-plus"></span> button in the [toolbar](#toolbar).
*   For inherited definition, there is a link to the note where the definition comes from, as well as an <span class="tn-icon bx bx-sitemap"></span> icon to indicate that it's inherited.

## Selecting attributes

Multiple attributes can be selected in order to copy or delete them together:

*   Hovering over an attribute shows a checkbox in place of its icon. Click it to select the attribute.
*   Alternatively, hold <kbd>Ctrl</kbd> (<kbd>Cmd</kbd> on macOS) while clicking an attribute to select it, or <kbd>Shift</kbd> to select a range of attributes. A range can span multiple sections.
*   Once at least one attribute is selected, every attribute shows its checkbox, and clicking anywhere on an attribute selects or deselects it instead of opening the detail popup.
*   The _Select all_ checkbox in the toolbar selects every attribute; while attributes are selected, it shows how many. Clicking it again clears the selection, as does pressing <kbd>Esc</kbd>.

While attributes are selected, the toolbar shows:

*   A <span class="tn-icon bx bx-copy"></span> button, which copies the selected attributes.
*   A <span class="tn-icon bx bx-trash"></span> button, which deletes the selected attributes after a confirmation. It only appears if all the selected attributes belong to the current note, since inherited attributes can only be deleted from the note they come from.

Right-clicking an attribute shows a menu with the same actions, as well as pasting. If the attribute is not part of the selection, the menu applies only to that attribute.

## Copying and pasting attributes

Attributes can be copied from one note and pasted into another:

*   To copy, select the attributes and press <kbd>Ctrl</kbd>+<kbd>C</kbd>, or use the <span class="tn-icon bx bx-copy"></span> button in the toolbar or the context menu.
*   To paste, navigate to the destination note and press <kbd>Ctrl</kbd>+<kbd>V</kbd> after clicking anywhere in the attributes tab, or use the <span class="tn-icon bx bx-paste"></span> button in the toolbar. Right-clicking an attribute or an empty area of a section also offers to paste.

Attributes are copied as text, in the same format as the attributes editor (for example `#author=John ~template=#root/abc123 #tag(inheritable)`). As a result:

*   Copied attributes can be pasted into the attributes editor or into a note, and the text of the attributes editor can be pasted into the attributes tab.
*   Attributes can be written by hand in any other application and then pasted into Trilium.

When pasting, the attributes become owned attributes of the current note, even if they were inherited in the source note:

*   If the note already has an attribute with the same name, its value is replaced by the pasted one.
*   If a definition marks the attribute as having multiple values (see <a class="reference-link" href="../../../Advanced%20Usage/Attributes/Promoted%20Attributes.md">Promoted Attributes</a>), the pasted value is added alongside the existing ones instead, unless the same value is already present.

> [!NOTE]
> <kbd>Ctrl</kbd>+<kbd>V</kbd> pastes what the system clipboard holds, whereas the <span class="tn-icon bx bx-paste"></span> button and the context menu paste the attributes last copied in Trilium. The two differ if something else was copied in the meantime.

## Mobile

On mobile, the attributes are the _Attributes_ tab of the note panel (see <a class="reference-link" href="../Right%20Sidebar.md">Right Sidebar</a>), which opens as a sheet at the bottom of the screen from the <span class="tn-icon bx bx-dock-bottom"></span> button beside the <a class="reference-link" href="../Note%20menu.md">Note menu</a>. Selecting _Attributes_ in the note menu, below _Backlinks_ and _Note paths_, opens the panel on that tab. Tapping an attribute opens it on a page of its own, with a <span class="tn-icon bx bx-chevron-left"></span> button to return to the list.

On mobile, the [toolbar](#toolbar) takes the place of the tab's name in the header of the sheet, and each section is displayed as a separate card:

*   Attributes are added from the <span class="tn-icon bx bx-plus"></span> button in the header, or from the <span class="tn-icon bx bx-plus"></span> button above the _Definitions_ card.
*   To select an attribute, press and hold it. Once an attribute is selected, tapping other attributes selects them as well.
*   Copying, pasting and deleting work the same way as on desktop, from the header.