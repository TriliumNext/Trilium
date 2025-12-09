# Relation Map
Relation map is a type of note which visualizes notes and their [relations](../Advanced%20Usage/Attributes.md).

## Interaction

*   To create a new note and add it to the board, press the plus button in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Floating%20buttons.md">Floating buttons</a>.
    *   Afterwards, click anywhere on the map to place it there.
    *   The note will be placed as a sub-child of the map.
*   An existing note can also be dragged from the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>. It will be placed at the position it's dragged on.
    *   Multiple notes can also be dragged via <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree/Multiple%20selection.md">Multiple selection</a>. The notes will be positioned near the dragged position without overlapping.
    *   The dragged note can be a sub-child of the map, or it can be at any arbitrary position.
*   To create a relationship, hold the mouse on the box on the right of a note and then:
    *   Drag it over another note to create a relationship pointing from the first note to the second one.
    *   Drag over the same note to create a self-referencing relationship (represented as a loop).
    *   Once dragged, enter the name of the relationship to create. To cancel, simply dismiss the dialog or press <kbd>Esc</kbd>.
*   To open a note, either click on the note (opening it in the current view) or use the right click menu to open in a new tab.
*   To edit the title of a note or to delete it (either from the map, or delete it completely), right click the note.
*   To delete a relationship, right click it and select the corresponding option.

## Development process demo

This is a basic example how you can create simple diagram using relation maps:

<img src="1_Relation Map_relation-map-.png" width="934" height="667">

And this is how you can create it:

<img src="1_Relation Map_relation-map-.gif" width="812" height="585">

We start completely from scratch by first creating new note called "Development process" and changing its type to "Relation map". After that we create new notes one by one and place them by clicking into the map. We also drag [relations](../Advanced%20Usage/Attributes.md)between notes and name them. That's all!

Items on the map - "Specification", "Development", "Testing" and "Demo" are actually notes which have been created under "Development process" note - you can click on them and write some content. Connections between notes are called "[relations](../Advanced%20Usage/Attributes.md)".

## Family demo

This is more complicated demo using some advanced concepts. Resulting diagram is here:

<img src="Relation Map_relation-map-.png" width="941" height="758">

This is how you get to it:

<img src="Relation Map_relation-map-.gif" width="812" height="585">

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