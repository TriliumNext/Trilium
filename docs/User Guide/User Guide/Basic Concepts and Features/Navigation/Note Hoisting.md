# Note Hoisting
Hoisting is a standard outliner feature which allows you to focus on (or "zoom into") a specific note and its subtree by hiding all parent and sibling notes. Demo:

![](Note%20Hoisting_note-hoisting.gif)

In addition to showing only this subtree, hoisting narrows [full text search](Search.md) and [quick search](Quick%20search.md) to that subtree. Every search for a note starts in the same place: [Jump to note](Jump%20to%20%26%20command%20palette.md), typing `@`, a relation's target, quick search, and the other fields that look up a note. The note is named above the results, even when the field is empty. A result can limit that search to itself, and widening it looks through the whole tree without unhoisting. A saved search still follows the hoist, unless the search sets its own ancestor. _Show in full search_ sets that ancestor to the scope the search was using, including the whole tree.

## Showing all notes again

While a note is hoisted, the desktop interface shows a _Show all notes_ button with the <span class="tn-icon bx bx-arrow-back"></span> icon above the <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Note Tree</a>. Click it to unhoist the note and see the whole tree again.

On a phone, the back button at the top level of the hoisted tree turns into a <span class="tn-icon bx bx-exit"></span> button, followed by the hoisted note's title. Tap it to unhoist the note; the tree then shows the level holding the hoisted note, as one more step up.

See also [Workspace](Workspaces.md) which extends this feature.