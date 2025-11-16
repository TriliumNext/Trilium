# recent_notes
| Column Name | Data Type | Nullity | Default value | Description |
| --- | --- | --- | --- | --- |
| `noteId` | Text | Non-null |     | Unique ID of the note (e.g. `yRRTLlqTbGoZ`). |
| `notePath` | Text | Non-null |     | The path (IDs) to the [note](notes.md) from root to the note itself, separated by slashes. |
| `utcDateCreated` | Text | Non-null |     | Creation date in UTC format (e.g. `2023-11-08 16:43:44.204Z`) |