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

<table>
    <thead>
        <tr>
            <th>Label</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code spellcheck="false">#sorted</code></td>
            <td><p>Keeps child notes sorted by title alphabetically.</p><p>When given a value, it will sort by the value of another label instead. If one of the child notes doesn't have the specified label, the title will be used for them instead.</p></td>
        </tr>
        <tr>
            <td><code spellcheck="false">#sortDirection</code></td>
            <td><p>If <code spellcheck="false">sorted</code> is applied, specifies the direction of the sort:</p><ul><li><code spellcheck="false">ASC</code>, ascending (default)</li><li><code spellcheck="false">DESC</code>, descending</li></ul></td>
        </tr>
        <tr>
            <td><code spellcheck="false">#sortFoldersFirst</code></td>
            <td>If <code spellcheck="false">sorted</code> is applied, folders (notes with children) will be sorted as a group at the top, and the rest will be sorted.</td>
        </tr>
        <tr>
            <td><code spellcheck="false">#sortNatural</code></td>
            <td>Sort numbers naturally instead of alphabetically, so 2 comes before 10.</td>
        </tr>
        <tr>
            <td><code spellcheck="false">#sortLocale</code></td>
            <td>The language code driving the natural sort (e.g. <code spellcheck="false">zh-CN</code>, <code spellcheck="false">de</code>). Only meaningful together with <code spellcheck="false">#sortNatural</code>.</td>
        </tr>
        <tr>
            <td><code spellcheck="false">#top</code></td>
            <td>If <code spellcheck="false">sorted</code> is applied to the parent note, keeps given note on top in its parent.</td>
        </tr>
        <tr>
            <td><code spellcheck="false">#bottom</code></td>
            <td>If <code spellcheck="false">sorted</code> is applied to the parent note, keeps given note on bottom in its parent.</td>
        </tr>
    </tbody>
</table>

Sorting is done by comparing note properties or specific labels on child notes. There are four sorting levels, with the first having the highest priority. Lower priority levels are applied only if higher priority comparisons result in equality.

1.  **Top Label Sorting**: Child notes with the `#top` label will appear at the top of the folder.
2.  **Bottom Label Sorting**: (Introduced in Trilium 0.62) Child notes with the `#bottom` label will appear at the bottom of the folder.
3.  **Property/Label-Based Sorting**: Sorting is based on the parent note's `#sorted` label:
    *   **Default Sorting**: If `#sorted` has no value, notes are sorted alphabetically.
    *   **Property Sorting**: If `#sorted` is set to `title`, `dateModified`, or `dateCreated`, notes are sorted based on the specified property.
    *   **Label Sorting**: If `#sorted` has any other value, this value is treated as the name of a child note's label, and sorting is based on the values of this label. For example, setting `#sorted=myOrder` on the parent note and using `#myOrder=001`, `#myOrder=002`, etc., on child notes.
4.  **Alphabetical Sorting**: Used as a last resort when other criteria result in equality.

All comparisons are made string-wise (e.g., "1" \< "2" or "2020-10-10" < "2021-01-15", but also "2" \> "10").