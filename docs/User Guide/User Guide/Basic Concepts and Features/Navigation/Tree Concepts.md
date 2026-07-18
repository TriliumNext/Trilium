# Tree Concepts
This page explains the basic concepts related to the tree structure of notes in TriliumNext.

## Note

A note is the central entity in TriliumNext. For more details, see <a class="reference-link" href="../Notes.md">Notes</a>.

## Branch

A branch describes the placement of a note within the note tree. Essentially, it is a tuple of `parentNoteId` and `noteId`, indicating that the given note is placed as a child under the specified parent note.

Each note can have multiple branches, meaning any note can be placed in multiple locations within the tree. This concept is referred to as <a class="reference-link" href="../Notes/Cloning%20Notes.md">Cloning Notes</a>.

## Prefix

A prefix is a branch-specific title modifier for a note. If you place your note in two different locations within the tree and want to alter the title slightly in one of those placements, you can use a prefix.

To edit a prefix, right-click on the note in the tree pane and select _Edit branch prefix_.

The prefix is not part of the note itself and is not encrypted when the note is protected. This can be useful if you want part of the title to remain visible in the tree for easier navigation, even when the note is protected.

## Subtree

A subtree consists of a particular note (the subtree root) and all its children and descendants. Some operations, such as exporting, work on entire subtrees.