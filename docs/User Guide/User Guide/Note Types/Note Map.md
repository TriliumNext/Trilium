# Note Map
<figure class="image image_resized" style="width:72.68%;"><img style="aspect-ratio:1311/1271;" src="Note Map_image.png" width="1311" height="1271"></figure>

A Note map is a note type which displays a standalone version of the feature of the same name: <a class="reference-link" href="../Advanced%20Usage/Note%20Map%20(Link%20map%2C%20Tree%20map).md">Note Map (Link map, Tree map)</a>. Consult that page for more information on how the note map works and what it displays.

Once created, the note map will display the relations between notes. Only the notes that are part of the parent of the note map will be displayed (including their children).

## Root note

The root note defines the starting point of the graph, from which the relations and the hierarchy are derived from.

There are three possible root notes:

*   The default root note is the parent note of the note map.
*   To use the currently [hoisted note](../Basic%20Concepts%20and%20Features/Navigation/Note%20Hoisting.md) instead, set the `mapRootNoteId` label to `hoisted`.
*   To use a specific note instead, set `mapRootNoteId` to the <a class="reference-link" href="../Advanced%20Usage/Note%20ID.md">Note ID</a> of the desired note.

## Customization

The note map can be customized using the following <a class="reference-link" href="../Advanced%20Usage/Attributes/Labels.md">Labels</a>:

| Label | Description |
| --- | --- |
| `#mapIncludeRelation` | Comma-delimited relation names to include from the note map. |
| `#mapExcludeRelation` | Comma-delimited relation names to exclude from the note map. |
| `#mapRootNoteId` | The ID of the note the map roots from, or `hoisted`. See the root note section above for more information. |