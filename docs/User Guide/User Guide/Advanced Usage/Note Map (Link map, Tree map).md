# Note Map (Link map, Tree map)
Note map is a visualization of connections between notes. This provides an insight into a structure ("web") of notes.

There are two types of note map:

*   Link Map, which shows relations between notes.
*   Note Map, which shows the hierarchical tree structure.

## Accessing the note map

The note map comes into multiple flavors:

*   To access the note map for the current note:
    *   On the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/New%20Layout.md">New Layout</a>, the note map is available in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Right%20Sidebar/Connections%20tab.md">Connections tab</a> in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Right%20Sidebar.md">Right Sidebar</a>.
    *   On the old layout, the note map is a tab in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Ribbon.md">Ribbon</a>.
*   To display a full-screen note map, there is a [dedicated note type](../Note%20Types/Note%20Map.md) with the same name.
*   To view the global note map (of all the notes in the knowledge base), there is a dedicated _Note map_ button in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Launch Bar</a>.

## Terminology and structure

*   Each note is represented as a _node_ in the graph, with the title displayed underneath.
    *   When the map is zoomed out, the title can still be viewed by hovering over the node.
    *   The [icon and color](../Basic%20Concepts%20and%20Features/Notes/Note%20Icons%20%26%20Colors.md) of the note are respected.
*   The root node is the reference point for which the relations and hierarchical structure are displayed.
    *   When accessing the note map through the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Ribbon.md">Ribbon</a> or the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Right%20Sidebar.md">Right Sidebar</a> (new layout), the root node is the current note.
    *   When using a dedicated <a class="reference-link" href="../Note%20Types/Note%20Map.md">Note Map</a> note, the root note can be either the parent note, the currently [hoisted](../Basic%20Concepts%20and%20Features/Navigation/Note%20Hoisting.md) note or a specific note. See the note type documentation for more information.

## Interaction

*   Nodes can be dragged around, but they will return to their original position once released.
    *   To have the notes remain in the same position as they were dragged, press the _Fix nodes_ button. The position of the notes is not saved, so it will return to normal once you navigate to another note or restart the application.
*   When hovering over a node, the adjacent relations and nodes are highlighted.
*   The distance between nodes can be adjusted via the slider in the bottom-left. Similarly, this value is not saved.
*   <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Notes/Archived%20Notes.md">Archived Notes</a> are generally ignored by the note map in order to reduce clutter. There is one exception: if the root note is also archived, then all archived notes are displayed too.

## Link Map

<img src="Note Map (Link map, Tree map)_image.png" width="1425" height="1093">

The link map is a visualization of links and <a class="reference-link" href="Attributes/Relations.md">Relations</a> incoming to and outgoing from a particular note.

The map indicates the following types of relations:

*   <a class="reference-link" href="../Note%20Types/Text/Links/Internal%20(reference)%20links.md">Internal (reference) links</a> between notes.
*   <a class="reference-link" href="Attributes/Relations.md">Relations</a>

The link map will also show unlinked notes that are part of the hierarchy as a cloud of unconnected dots. On the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/New%20Layout.md">New Layout</a>, the sidebar deliberately omits this in order to save some space, but they will be revealed once the map is maximized.

## Tree Map

Shows hierarchical map of notes:

<figure class="image"><img style="aspect-ratio:1420/1490;" src="1_Note Map (Link map, Tree map)_image.png" width="1420" height="1490"></figure>

## See also

*   Apart from the note map feature which can be accessed from any note, it is also possible to create a dedicated note which will display the relations in full screen. See <a class="reference-link" href="../Note%20Types/Note%20Map.md">Note Map</a> for more information.
*   <a class="reference-link" href="../Note%20Types/Relation%20Map.md">Relation Map</a> is a similar concept, with some differences:
    *   note map is automatically generated while relation map must be created manually
    *   relation map is a type of note while a link map is just virtual visualization