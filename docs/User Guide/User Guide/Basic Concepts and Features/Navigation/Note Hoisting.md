# Note Hoisting
Hoisting is a standard outliner feature which allows you to focus on (or "zoom into") a specific note and its subtree by hiding all parent and sibling notes. Demo:

![](Note%20Hoisting_note-hoisting.gif)

In addition to showing only this subtree, hoisting narrows [full text search](Search.md) and [quick search](Quick%20search.md) to that subtree. [Jump to note](Jump%20to%20%26%20command%20palette.md) uses the hoist as where a search starts: with nothing typed it lists the recent notes inside the hoist, and a search lists only the matches inside it. Typing `@` to link a note starts in the same place, and names the hoist above the results even when nothing follows the `@`. Widening that search looks through the whole tree without unhoisting the note, and the recent notes change with it.

## Showing all notes again

While a note is hoisted, the desktop interface shows a _Show all notes_ button with the <span class="tn-icon bx bx-arrow-back"></span> icon above the <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Note Tree</a>. Click it to unhoist the note and see the whole tree again.

On a phone, the back button at the top level of the hoisted tree turns into a <span class="tn-icon bx bx-exit"></span> button, followed by the hoisted note's title. Tap it to unhoist the note; the tree then shows the level holding the hoisted note, as one more step up.

See also [Workspace](Workspaces.md) which extends this feature.