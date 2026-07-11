# Hiding the subtree
<figure class="image image-style-align-right"><img style="aspect-ratio:328/45;" src="1_Hiding the subtree_image.png" width="328" height="45"><figcaption>An example of a collection with a relatively large number of children that are hidden from the tree.</figcaption></figure>

The tree works well when the notes are structured in a hierarchy so that the number of items stays small. When a note has a large number of notes (in the order of thousands or tens of thousands), two problems arise:

*   Navigating between notes becomes cumbersome and the tree itself gets cluttered with a large amount of notes.
*   The large amount of notes can slow down the application considerably.

Since v0.102.0, Trilium allows the tree to hide the child notes of particular notes. This works for both <a class="reference-link" href="../../../Collections.md">Collections</a> and normal notes.

## Interaction

When the subtree of a note is hidden, there are a few subtle changes:

*   To indicate that the subtree is hidden, the note will not have an expand button and it will display the number of children to the right.
*   It's not possible to add a new note directly from the tree.
    *   For <a class="reference-link" href="../../../Collections.md">Collections</a>, it's best to use the built-in mechanism to create notes (for example by creating a new point on a geo-map, or by adding a new row in a table).
    *   For normal notes, it's still possible to create children via other means such as using the <a class="reference-link" href="../../../Note%20Types/Text/Links/Internal%20(reference)%20links.md">Internal (reference) links</a> system.
*   Notes can be dragged from outside the note, case in which they will be cloned into it.
    *   Instead of switching to the child notes that were copied, the parent note is highlighted instead.
    *   A notification will indicate this behavior.
*   Similarly, features such as cut/copy and then paste into the note will also work.

## Spotlighting

<figure class="image image-style-align-right"><img style="aspect-ratio:322/83;" src="Hiding the subtree_image.png" width="322" height="83"></figure>

Even if the subtree of a note is hidden, if a child note manages to become active, it will still appear inside the tree in a special state called _spotlighted_.

During this state, the note remains under its normal hierarchy, so that its easy to tell its location. In addition, this means that:

*   The note position is clearly visible when using the <a class="reference-link" href="../../Navigation/Search.md">Search</a>.
*   The note can still be operated on from the tree, such as adding a <a class="reference-link" href="../../Notes/Cloning%20Notes/Branch%20prefix.md">Branch prefix</a> or moving it outside the collection.

The note appears in italics to indicate its temporary display. When switching to another note, the spotlighted note will disappear.

> [!NOTE]
> Only one note can be highlighted at the time. When working with multiple notes such as dragging them into the collection, no note will be spotlighted. This is intentional to avoid displaying a partial state of the subtree.

## Working with collections

For large collections, it can be helpful to hide their child notes for performance reasons or de-cluttering the tree.

To toggle this behavior:

*   Open the collection and in <a class="reference-link" href="../../../Collections/Collection%20Properties.md">Collection Properties</a>, look for _Hide child notes in tree_.
*   Right click the collection note in the <a class="reference-link" href="../Note%20Tree.md">Note Tree</a> and select _Advanced_ → _Show subtree_.

## Working with normal notes

It's possible to hide the subtree for normal notes as well, not just collections. To do so, right click the note in the <a class="reference-link" href="../Note%20Tree.md">Note Tree</a> and select _Advanced_ → _Hide subtree._