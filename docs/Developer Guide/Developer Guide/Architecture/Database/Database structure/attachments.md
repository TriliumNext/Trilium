# attachments
| Column Name | Data Type | Nullity | Default value | Description |
| --- | --- | --- | --- | --- |
| `attachmentId` | Text | Non-null |     | Unique ID (e.g. `qhC1vzU4nwSE`) |
| `ownerId` | Text | Non-null |     | The unique ID of a row in <a class="reference-link" href="notes.md">notes</a>. |
| `role` | Text | Non-null |     | The role of the attachment: `image` for images that are attached to a note, `file` for uploaded files. |
| `mime` | Text | Non-null |     | The MIME type of the attachment (e.g. `image/png`) |
| `title` | Text | Non-null |     | The title of the attachment. |
| `isProtected` | Integer | Non-null | 0   | `1` if the entity is [protected](../../../Concepts/Protected%20entities.md), `0` otherwise. |
| `position` | Integer | Non-null | 0   | Not sure where the position is relevant for attachments (saw it with values of 10 and 0). |
| `blobId` | Text | Nullable | `null` | The corresponding `blobId` from the <a class="reference-link" href="blobs.md">blobs</a> table. |
| `dateModified` | Text | Non-null |     | Localized modification date (e.g. `2023-11-08 18:43:44.204+0200`) |
| `utcDateModified` | Text | Non-null |     | Modification date in UTC format (e.g. `2023-11-08 16:43:44.204Z`) |
| `utcDateScheduledForErasure` | Text | Nullable | `null` |     |
| `isDeleted` | Integer | Non-null |     | `1` if the entity is [deleted](../../../Concepts/Deleted%20notes.md), `0` otherwise. |
| `deleteId` | Text | Nullable | `null` |     |