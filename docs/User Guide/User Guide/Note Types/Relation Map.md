# Relation Map
Relation map is a type of note which visualizes notes and their [relations](../Advanced%20Usage/Attributes.md).

## Interaction

*   To create a new note and add it to the map, press the <span class="tn-icon bx bx-note"></span> _Add note_ button at the bottom of the map, then click anywhere on the map to place it there.
    *   While the map waits for the click, a translucent box follows the mouse to show where the note will go. To cancel, press the button again (now labeled _Cancel_) or press <kbd>Esc</kbd>.
    *   The note is created as a child of the map, with the default title of a new note. It opens in the note panel (see below) with its title selected, so you can type its name straight away.
*   An existing note can also be dragged from the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>. It will be placed at the position it's dragged on.
    *   Multiple notes can also be dragged via <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree/Multiple%20selection.md">Multiple selection</a>. The notes will be positioned near the dragged position without overlapping.
    *   The dragged note can be a sub-child of the map, or it can be at any arbitrary position.
*   To create a relationship, hold the mouse on the dot on the right of a note and then:
    *   Drag it over another note to create a relationship pointing from the first note to the second one.
    *   Drag over the same note to create a self-referencing relationship (represented as a loop).
    *   Once dragged, a popover next to the relationship asks for its name. Type a new name and press <kbd>Enter</kbd>, or pick a relation name already in use from the suggestions. To cancel, press <kbd>Esc</kbd>, close the popover or click elsewhere on the map.
*   Each note is shown as a card with its icon and title, colored in the note's color the same way as the cards of a <a class="reference-link" href="../Collections/Kanban%20Board.md">Kanban Board</a>.
*   To view or edit a note, click it on the map. This opens the note panel (see below).
    *   To open the note in a new tab instead, <kbd>Ctrl</kbd>+click it or click it with the middle mouse button. <kbd>Shift</kbd>+click opens it in a new window. The right click menu offers the same options.
*   To edit the title of a note or to delete it (either from the map, or delete it completely), right click the note.
*   To rename or delete a relationship, right click it and select the corresponding option.

## Note panel

When a note on the map is clicked, a panel opens to the right of the map and the note is highlighted. If the panel would cover the note, or the note is partly off-screen, the map pans to bring it into view. The panel contains:

*   The title and icon of the note, both editable.
*   A button to expand the panel over the whole map, and to restore it afterwards.
*   Buttons to interact with the note:
    *   Open the note in the current tab, or, through the <span class="tn-icon bx bx-dots-horizontal-rounded"></span> menu, in a new tab, split, window or the quick edit popup.
    *   A color picker to change the color of the note.
    *   A button to remove the note from the map, which can optionally delete the note as well.
*   The <a class="reference-link" href="../Advanced%20Usage/Attributes/Promoted%20Attributes.md">Promoted Attributes</a> of the note, if any.
*   The note's content, which can be edited directly from the panel.

The color picker and the remove button are not shown if the map is read-only.

Clicking another note on the map switches the panel to it. Similarly, clicking an <a class="reference-link" href="Text/Links/Internal%20(reference)%20links.md">Internal (reference) links</a> inside the panel switches the panel to that note, as long as it is on the map.

To close the panel, press the X button at its top-right, click an empty part of the map, or press <kbd>Esc</kbd>.

On mobile, the note opens as a dialog over the whole screen instead of a panel.

## Development process demo

This is a basic example how you can create simple diagram using relation maps:

<img src="Relation Map_relation-map-dev-process.png" width="934" height="667">

And this is how you can create it:

<img src="Relation Map_relation-map-dev-process-demo.gif" width="812" height="585">

We start completely from scratch by first creating new note called "Development process" and changing its type to "Relation map". After that we create new notes one by one and place them by clicking into the map. We also drag [relations](../Advanced%20Usage/Attributes.md)between notes and name them. That's all!

Items on the map - "Specification", "Development", "Testing" and "Demo" are actually notes which have been created under "Development process" note - you can click on them and write some content. Connections between notes are called "[relations](../Advanced%20Usage/Attributes.md)".

## Family demo

This is more complicated demo using some advanced concepts. Resulting diagram is here:

<img src="Relation Map_relation-map-family.png" width="941" height="758">

This is how you get to it:

<img src="Relation Map_relation-map-family-demo.gif" width="812" height="585">

There are several steps here:

*   we start with empty relation map and two existing notes representing Prince Philip and Queen Elizabeth II. These two notes already have `isPartnerOf` [relations](../Advanced%20Usage/Attributes.md)defined.
    *   There are actually two "inverse" relations (one from Philip to Elizabeth and one from Elizabeth to Philip)
*   we drag both notes to relation map and place to suitable position. Notice how the existing `isPartnerOf` relations are displayed.
*   now we create new note - we name it "Prince Charles" and place it on the relation map by clicking on the desired position. The note is by default created under the relation map note (visible in the note tree on the left).
*   we create two new relations `isChildOf` targeting both Philip and Elizabeth
    *   now there's something unexpected - we can also see the relation to display another `hasChild` relation. This is because there's a [relation definition](../Advanced%20Usage/Attributes/Promoted%20Attributes.md) which puts `isChildOf` as an "[inverse](../Advanced%20Usage/Attributes/Promoted%20Attributes.md)" relation of `hasChildOf` (and vice versa) and thus it is created automatically.
*   we create another note for Princess Diana and create `isPartnerOf` relation from Charles. Again notice how the relation has arrows both ways - this is because `isPartnerOf` definition specifies its inverse relation as again "isPartnerOf" so the opposite relation is created automatically.
*   as the last step we pan & zoom the map to fit better to window dimensions.

Relation definitions mentioned above come from "Person template" note which is assigned to any child of "My Family Tree" relation note. You can play with the whole thing in the [demo notes](../Advanced%20Usage/Database.md).

## Details

You can specify which relations should be displayed with comma delimited names of relations in `displayRelations` label.

Alternatively, you can specify comma delimited list of relation names in `hideRelations` which will display all relations, except for the ones defined in the label.

## See also

*   <a class="reference-link" href="Note%20Map.md">Note Map</a> is a similar concept.