# revisions
| Column Name | Data Type | Nullity | Default value | Description |
| --- | --- | --- | --- | --- |
| `revisionId` | Text | Non-null |     | Unique ID of the revision (e.g. `0GjgUqnEudI8`). |
| `noteId` | Text | Non-null |     | ID of the [note](notes.md) this revision belongs to. |
| `type` | Text | Non-null | `""` | The type of note (i.e. `text`, `file`, `code`, `relationMap`, `mermaid`, `canvas`). |
| `mime` | Text | Non-null | `""` | The MIME type of the note (e.g. `text/html`). |
| `title` | Text | Non-null |     | The title of the note, as defined by the user. |
| `isProtected` | Integer | Non-null | 0   | `1` if the entity is [protected](../../../Concepts/Protected%20entities.md), `0` otherwise. |
| `blobId` | Text | Nullable | `null` | The corresponding ID from <a class="reference-link" href="blobs.md">blobs</a>. Although it can theoretically be `NULL`, haven't found any such note yet. |
| `utcDateLastEdited` | Text | Non-null |     | **Not sure how it differs from modification date.** |
| `utcDateCreated` | Text | Non-null |     | Creation date in UTC format (e.g. `2023-11-08 16:43:44.204Z`) |
| `utcDateModified` | Text | Non-null |     | Modification date in UTC format (e.g. `2023-11-08 16:43:44.204Z`) |
| `dateLastEdited` | Text | Non-null |     | **Not sure how it differs from modification date.** |
| `dateCreated` | Text | Non-null |     | Localized creatino date (e.g. `2023-08-12 15:10:04.045+0300`) |