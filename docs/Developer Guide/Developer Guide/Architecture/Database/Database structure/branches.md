# branches
| Column Name | Data Type | Nullity | Default value | Description |
| --- | --- | --- | --- | --- |
| `branchId` | Text | Non-null |     | The ID of the branch, in the form of `a_b` where `a` is the `parentNoteId` and `b` is the `noteId`. |
| `noteId` | Text | Non-null |     | The ID of the [note](notes.md). |
| `parentNoteId` | Text | Non-null |     | The ID of the parent [note](notes.md) the note belongs to. |
| `notePosition` | Integer | Non-null |     | The position of the branch within the same level of hierarchy, the value is usually a multiple of 10. |
| `prefix` | Text | Nullable |     | The [branch prefix](../../../Concepts/Branch%20prefixes.md) if any, or `NULL` otherwise. |
| `isExpanded` | Integer | Non-null | 0   | Whether the branch should appear expanded (its children shown) to the user. |
| `isDeleted` | Integer | Non-null | 0   | `1` if the entity is [deleted](../../../Concepts/Deleted%20notes.md), `0` otherwise. |
| `deleteId` | Text | Nullable | `null` |     |
| `utcDateModified` | Text | Non-null |     | Modification date in UTC format (e.g. `2023-11-08 16:43:44.204Z`) |