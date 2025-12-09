# notes
| Column Name | Data Type | Nullity | Default value | Description |
| --- | --- | --- | --- | --- |
| `noteId` | Text | Non-null |     | The unique ID of the note (e.g. `2LJrKqIhr0Pe`). |
| `title` | Text | Non-null | `"note"` | The title of the note, as defined by the user. |
| `isProtected` | Integer | Non-null | 0   | `1` if the entity is [protected](../../../Concepts/Protected%20entities.md), `0` otherwise. |
| `type` | Text | Non-null | `"text"` | The type of note (i.e. `text`, `file`, `code`, `relationMap`, `mermaid`, `canvas`). |
| `mime` | Text | Non-null | `"text/html"` | The MIME type of the note (e.g. `text/html`).. Note that it can be an empty string in some circumstances, but not null. |
| `blobId` | Text | Nullable | `null` | The corresponding ID from <a class="reference-link" href="blobs.md">blobs</a>. Although it can theoretically be `NULL`, haven't found any such note yet. |
| `isDeleted` | Integer | Nullable | 0   | `1` if the entity is [deleted](../../../Concepts/Deleted%20notes.md), `0` otherwise. |
| `deleteId` | Text | Non-null | `null` |     |
| `dateCreated` | Text | Non-null |     | Localized creation date (e.g. `2023-11-08 18:43:44.204+0200`) |
| `dateModified` | Text | Non-null |     | Localized modification date (e.g. `2023-11-08 18:43:44.204+0200`) |
| `utcDateCreated` | Text | Non-null |     | Creation date in UTC format (e.g. `2023-11-08 16:43:44.204Z`) |
| `utcDateModified` | Text | Non-null |     | Modification date in UTC format (e.g. `2023-11-08 16:43:44.204Z`) |