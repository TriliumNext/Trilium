# Merging Notes
Merging notes combines two or more notes into a new note. The original notes are deleted, and the new note takes their place.

## Merging one note into another

To merge the note you have open with another, open the <a class="reference-link" href="../UI%20Elements/Note%20menu.md">Note menu</a> and choose <span class="tn-icon bx bx-merge"></span>_Merge note with…_. Pick the other note. Both are deleted and replaced by a new note that keeps the open note's title. Its text is the open note's, then the other note's.

The same entry is in the <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Note Tree</a> context menu, on a single note. It merges the chosen note with the one you right-clicked.

## Merging several notes

Select several notes in the <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Note Tree</a> (see <a class="reference-link" href="../UI%20Elements/Note%20Tree/Multiple%20selection.md">Multiple selection</a>), right-click, and choose _Merge notes…_.

You are asked for the title of the new note. The content is appended in the order the notes appear in the tree, starting with the first. Two clones of one note count as a single note, since they are the same note.

## What is combined

*   Text notes are appended to text notes. Where both have content, a horizontal line and the title of the merged note separate them. A note with no content is appended without that heading.
*   Code notes are appended when they use the same language. Markdown is separated with a heading of the merged note's title; other code is separated with a blank line.
*   A note of any other type is merged only when it has no content of its own. A file, an image, or any other content that cannot be combined with the first note, refuses the whole merge, and nothing is deleted.
*   The new note is placed wherever a merged note was cloned. See <a class="reference-link" href="Cloning%20Notes.md">Cloning Notes</a>. A place that would put it inside one of the notes being merged is skipped.
*   Child notes of a merged note move onto the new note, so deleting the parent does not take them with it. If a child cannot be moved without being deleted, the merge is refused.
*   Links to a merged note, including links written in other notes, point at the new note afterwards. Attachments referenced from the appended content are copied across.
*   Labels and relations are copied. A duplicate, the same type, name and value, is kept once, and it stays inheritable when either copy was.

The original notes are then deleted, and the new note is selected. The <a class="reference-link" href="../UI%20Elements/Note%20menu.md">Note menu</a> of that note has <span class="tn-icon bx bx-undo"></span>_Undo merge_, which brings back the most recently merged note: its text, clones, children, links and attributes return with it. The new note's text is left as it is. Either note can be restored, in any order. When every original note has been restored, _Undo merge_ is greyed out, because the note that is left is this one. Deleting it is separate.

<span class="tn-icon bx bx-history"></span>_Merge history_ lists every note that can still be restored, newest first. _Undo_ on a row restores that note. _Forget_ drops that one note only, and leaves the others.

Content from before the merge is kept as a revision described as "Before merging notes". See <a class="reference-link" href="Note%20Revisions.md">Note Revisions</a>. A note with the `#disableVersioning` label, and files and images, are not given that revision. Restoring a deleted note from <a class="reference-link" href="../UI%20Elements/Recent%20Changes.md">Recent Changes</a> brings that note back on its own and does not undo the merge.

## Limitations

*   <a class="reference-link" href="Protected%20Notes.md">Protected notes</a> have to be unlocked first, and a protected note can only be merged with another protected note.
*   The root note, system notes, search notes and launchers cannot be merged.
*   The note the tree is narrowed to cannot be merged. See <a class="reference-link" href="../Navigation/Note%20Hoisting.md">Note Hoisting</a>.

## See also

*   <a class="reference-link" href="Cloning%20Notes.md">Cloning Notes</a>
*   <a class="reference-link" href="../UI%20Elements/Note%20menu.md">Note menu</a>
*   <a class="reference-link" href="../UI%20Elements/Note%20Tree/Note%20tree%20contextual%20menu.md">Note tree contextual menu</a>