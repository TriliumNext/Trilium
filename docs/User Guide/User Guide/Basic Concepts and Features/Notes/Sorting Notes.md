# Sorting Notes
Trilium can sort the child notes of a note once, using the _Sort by…_ dialog, or keep them sorted permanently, using the `#sorted` label. Both sort by the same criteria: the title, the creation or modification date, or the value of a label on the child notes, and both can combine several of these into sorting levels.

## Sorting once with the dialog

To sort the children of a note once, right-click it in the <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Note Tree</a> and select _Sort by…_, or select it and press <kbd>Alt</kbd>+<kbd>S</kbd>. The order is applied to the existing child notes only; notes added later are placed wherever they are created.

The dialog consists of:

*   _Sorting criteria_, a list of levels. Each level sorts by _Title_, _Date created_, _Date modified_ or _Label_ (followed by the name of the label), _Ascending_ or _Descending_.
    *   To sort by more than one criterion, select _Add level_. The first level decides the order; the next level only decides between notes the previous ones left equal (see _Sort levels_ below).
    *   To change the order of the levels, use the <span class="tn-icon bx bx-up-arrow-alt"></span> and <span class="tn-icon bx bx-down-arrow-alt"></span> buttons. To remove a level, use the <span class="tn-icon bx bx-x"></span> button.
*   _Sort folders at the top_, which places notes that have children of their own before the others. When the first level is descending, they are placed at the bottom instead.
*   _Natural sort_, which compares numbers and characters by the rules of a language (see _How values are compared_ below). _Natural sort language_ sets the language code, for example `zh-CN` for Chinese.

Notes with `#top` or `#bottom` stay at the top or bottom, as with automatic sorting (see _Pinning notes to the top or bottom_ below).

## Keeping child notes sorted

To keep the children of a note sorted, add the `#sorted` [label](../../Advanced%20Usage/Attributes/Labels.md) to it. Trilium sorts its child notes again whenever a child is added or changes, and whenever the sorting labels change.

| Label | Description |
| --- | --- |
| `#sorted` | Keeps the child notes sorted. Without a value, they are sorted by title; with a value, by the levels it lists (see _Sort levels_ below). `#sorted=off` turns sorting off. |
| `#sortDirection` | `asc` (the default) or `desc`. The direction of every level that doesn't specify its own. |
| `#sortFoldersFirst` | Places notes that have children of their own before the others, or after them when `#sortDirection` is `desc`. |
| `#sortNatural` | Compares numbers by their value instead of character by character, so 2 comes before 10. |
| `#sortLocale` | The language code for `#sortNatural`, for example `zh-CN` or `de`. |
| `#top` | On a child note: keeps it at the top of its sorted parent. |
| `#bottom` | On a child note: keeps it at the bottom of its sorted parent. |

The labels apply to the note that carries them and, when made [inheritable](../../Advanced%20Usage/Attributes/Attribute%20Inheritance.md), to every note below it, so a single `#sorted(inheritable)` sorts a whole subtree. A note created from a [template](../../Advanced%20Usage/Templates.md) that has `#sorted` keeps its children sorted too. To exclude part of such a subtree, add `#sorted=off` to the note whose children must keep their manual order; to exclude everything below it as well, make that label inheritable too.

## Sort levels

The value of `#sorted` is a comma-separated list of levels, written like the `orderBy` of a [search](../Navigation/Search.md). Each level is one of:

*   A label on the child notes, written with `#`, such as `#priority`.
*   One of the properties `title`, `dateCreated` and `dateModified`, written without `#`.
*   `folders`, which only the notes with children of their own have (see _Grouping_ below).

A level can be followed by `asc` or `desc` to set its direction; otherwise it follows `#sortDirection`.

The child notes are sorted by the first level. Notes that are equal at that level are sorted by the second level, and so on. Notes equal at every level are sorted by title, in the direction of `#sortDirection`.

A child note that doesn't have a level's label is placed after every child that has it, whichever direction the level runs in. Between two notes that both lack it, the next level decides.

For example, `#sorted="#priority desc, #dueDate"` on a parent with these children:

| Child note | Labels |
| --- | --- |
| Book report | `#priority=2` `#dueDate=2026-11-01` |
| Groceries | `#priority=1` |
| Taxes | `#priority=2` `#dueDate=2026-10-25` |
| Ideas | none |

sorts them as _Taxes_, _Book report_, _Groceries_, _Ideas_. The highest priority comes first; _Taxes_ and _Book report_ share it, so the earlier due date decides between them. _Ideas_ has no priority and goes last.

A value that is a single name without `#` is read the way older versions did: `title`, `dateCreated` or `dateModified` is a property, and any other name is a label, so `#sorted=myOrder` sorts by the `#myOrder` label of the children.

> [!WARNING]
> Since v0.107.0, a label in a `#sorted` value with more than one level, or with a direction, must be written with `#`. In v0.106.0 the names were written bare, as in `#sorted="priority desc, dueDate"`; such a value now reads both names as properties that don't exist, and the notes fall back to sorting by title. Add a `#` before each label name to restore it.

## Grouping with `first` and `last`

A label followed by `first` or `last` doesn't sort by the label's value: it places the child notes that have the label, with any value, before or after the rest. The levels that follow then sort within each group. Grouping ignores `#sortDirection`.

For example, `#sorted="#archived last, #priority desc"` on a parent with these children:

| Child note | Labels |
| --- | --- |
| Old project | `#archived` `#priority=3` |
| Draft | `#priority=1` |
| Launch | `#priority=3` |
| Meeting notes | none |

sorts them as _Launch_, _Draft_, _Meeting notes_, _Old project_. The [archived note](Archived%20Notes.md) goes below all the others despite its high priority, and the rest are sorted by priority.

`folders first` and `folders last` group the notes that have children of their own. A `folders` level without `first` or `last` also places them first, in either direction. `#sortFoldersFirst` is a shortcut for a `folders first` level; it has no effect when `#sorted` already contains `folders`.

## Pinning notes to the top or bottom

A child note with `#top` stays at the top of a sorted parent, and one with `#bottom` stays at the bottom, whatever the levels of `#sorted` say. When several notes have `#top`, they are sorted by the label's value, so `#top=1` comes before `#top=2`, and a `#top` without a value comes first. `#bottom` works the other way round: the last notes are `#bottom=2`, then `#bottom=1`, then a `#bottom` without a value at the very end.

`#sortFoldersFirst` places the folders right after the `#top` notes.

To pin notes within groups instead of the whole list, name `#top` and `#bottom` in `#sorted` at the position where they apply. For example:

*   `#sorted="#archived last, #top first, #bottom last, title"` keeps archived notes below all the others, including those with `#bottom`. `#top` and `#bottom` then apply within the archived and the non-archived group separately.
*   `#sorted="#archived last, #top first, #bottom last, folders first, title"` also places folders first within each group. `#sortFoldersFirst` does the same: its `folders first` level goes right after the last of `#top` and `#bottom`.
*   Written with `first` or `last`, `#top` and `#bottom` ignore their values. To order several pinned notes by value, add a level after them, such as `#top first, #top, #bottom last, #bottom desc`.

## How values are compared

*   Values are compared as text, character by character, without regard to letter case. Dates in the `YYYY-MM-DD` form sort correctly, but numbers don't: `"10"` comes before `"2"`. Either pad the numbers with zeros (`02`, `10`) or enable `#sortNatural`.
*   With `#sortNatural`, numbers are compared by their value, and the comparison follows the rules of the language set by `#sortLocale` (or the default one), which also ignores accents.
*   The title of a note includes its <a class="reference-link" href="Cloning%20Notes/Branch%20prefix.md">Branch prefix</a>, if it has one in this parent, as `prefix - title`.
*   A label without a value still counts as present: it sorts before the notes that don't have the label, and among the notes that have it, as the smallest value.