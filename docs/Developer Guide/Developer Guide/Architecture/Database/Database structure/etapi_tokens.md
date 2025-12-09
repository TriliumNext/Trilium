# etapi_tokens
| Column Name | Data Type | Nullity | Default value | Description |
| --- | --- | --- | --- | --- |
| `etapiTokenId` | Text | Non-null |     | A unique ID of the token (e.g. `aHmLr5BywvfJ`). |
| `name` | Text | Non-null |     | The name of the token, as is set by the user. |
| `tokenHash` | Text | Non-null |     | The token itself. |
| `utcDateCreated` | Text | Non-null |     | Creation date in UTC format (e.g. `2023-11-08 16:43:44.204Z`) |
| `utcDateModified` | Text | Non-null |     | Modification date in UTC format (e.g. `2023-11-08 16:43:44.204Z`) |
| `isDeleted` | Integer | Non-null | 0   | `1` if the entity is [deleted](../../../Concepts/Deleted%20notes.md), `0` otherwise. |