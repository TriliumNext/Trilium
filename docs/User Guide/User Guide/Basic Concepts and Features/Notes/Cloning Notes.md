# Cloning Notes
## Motivation

Trilium's core feature is the ability to structure your notes into hierarchical tree-like structure.

It is expected then that you'll have an elaborate and deep note hierarchy - each subtree will represent a more refined and specialized view of your knowledge base.

This is a pretty powerful approach, but it also carries a hidden assumption that each "subtopic" is "owned" by one parent. I'll illustrate this with an example - let's say my basic structure is this:

*   Technology
    *   Programming
        *   Kotlin
        *   JavaScript
    *   Operating systems
        *   Linux
        *   Windows

Now, I'm starting to learn about [Bash](https://en.wikipedia.org/wiki/Bash_\(Unix_shell\)) and would like to create notes related to this topic. But now I'm facing a problem of where to categorize this. The issue here is that Bash is both a programming language and a tool (shell) very much tied into Linux. It seems it belongs to both of these, I can't (and don't want to) choose one over the other.

## Solution

The solution to the problem shown above is to allow notes to have multiple parents.

I call these "clones", but that is a bit misleading - there's no original and cloned note - the notes in both of the parents categories are identical.

Another misleading thing about "cloning" is that it suggests that a copy of the note has been made. That's not really true, the note itself stays in just one original, it is just referenced in multiple places in the tree hierarchy. So changing it in one category changes it in all the others, because they're all the same note.

Here's the final structure with cloning:

*   Technology
    *   Programming
        *   Kotlin
        *   JavaScript
        *   Bash
            *   some sub-notes ...
    *   Operating systems
        *   Linux
            *   Bash
                *   some sub-notes ...
        *   Windows

So now the "Bash" subtree appears on multiple locations in the hierarchy. Both the Bash subtrees are the same and contain the same sub-categories and notes.

### Demo

![](Cloning%20Notes_create-clone.gif)

In the demo, you can see how a clone can be created using the context menu. It's possible to do this also using the Add Link dialog or with <kbd>Ctrl</kbd>+<kbd>C</kbd> and <kbd>Ctrl</kbd>+<kbd>V</kbd> [keyboard shortcuts](../Keyboard%20Shortcuts.md).

You can view the list of all available clones:

*   In the <a class="reference-link" href="../UI%20Elements/Right%20Sidebar/Connections%20tab.md">Connections tab</a> for the <a class="reference-link" href="../UI%20Elements/New%20Layout.md">New Layout</a>.
*   For the old layout, in the "Note Paths" tab in the <a class="reference-link" href="../UI%20Elements/Ribbon.md">Ribbon</a>.

Titles of cloned notes in the tree view have an asterisk to the right to easily see that the note is also placed into some other location.

## Deleting notes/clones

With clones, it might not be immediately obvious how deleting works.

If you try to delete a note, it works like this:

1.  if the note has multiple clones, delete just this clone and leave the actual note (and its other clones) as it is.
2.  if this note doesn't have any other clones, delete the note
    *   Run the whole process starting with 1. on all note's children notes