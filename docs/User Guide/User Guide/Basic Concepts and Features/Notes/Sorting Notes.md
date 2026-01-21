# Sorting Notes
## Manual sorting

You can sort notes by right-clicking the parent note in the <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Note Tree</a> and selecting Advanced -> Sort notes by ... This will sort existing notes, but will not automatically sort future notes added to this parent note.

The sorting dialog allows:

*   Sorting by title, creation or modification date.
*   Changing sorting direction can also be adjusted (ascending or descending).
*   Ensuring folders are displayed at the top.
*   Natural sort, based on the sorting rules of a particular language.

## Automatic/Permanent Sorting

Child notes can be automatically sorted by attaching specific [labels](../../Advanced%20Usage/Attributes.md) to the parent note:

*   `#sorted`: Enables sorting. Can optionally include the name of the note's property/label for sorting criteria (details below).
*   `#sortDirection`: By default, sorting is ascending. Set this to `desc` to sort in descending order.
*   `#sortFoldersFirst`: Notes with children will be sorted to the top.

Sorting is done by comparing note properties or specific labels on child notes. There are four sorting levels, with the first having the highest priority. Lower priority levels are applied only if higher priority comparisons result in equality.

1.  **Top Label Sorting**: Child notes with the `#top` label will appear at the top of the folder.
2.  **Bottom Label Sorting**: (Introduced in Trilium 0.62) Child notes with the `#bottom` label will appear at the bottom of the folder.
3.  **Property/Label-Based Sorting**: Sorting is based on the parent note's `#sorted` label:
    *   **Default Sorting**: If `#sorted` has no value, notes are sorted alphabetically.
    *   **Property Sorting**: If `#sorted` is set to `title`, `dateModified`, or `dateCreated`, notes are sorted based on the specified property.
    *   **Label Sorting**: If `#sorted` has any other value, this value is treated as the name of a child note's label, and sorting is based on the values of this label. For example, setting `#sorted=myOrder` on the parent note and using `#myOrder=001`, `#myOrder=002`, etc., on child notes.
4.  **Alphabetical Sorting**: Used as a last resort when other criteria result in equality.

All comparisons are made string-wise (e.g., "1" \< "2" or "2020-10-10" < "2021-01-15", but also "2" \> "10").