# entity_changes
| Column Name | Data Type | Nullity | Default value | Description |
| --- | --- | --- | --- | --- |
| `id` | Integer | Non-null |     | A sequential numeric index of the entity change. |
| `entityName` | Text | Non-null |     | The type of entity being changed (`attributes`, `branches`, `note_reordering`, etc.) |
| `entityId` | Text | Non-null |     | The ID of the entity being changed. |
| `hash` | Text | Nullable (\*) |     | TODO: Describe how the hash is calculated |
| `isErased` | Integer (1 or 0) | Nullable (\*) |     | TODO: What does this do? |
| `changeId` | Text | Nullable (\*) |     | TODO: What does this do? |
| `componentId` | Text | Nullable (\*) |     | The ID of the UI component that caused this change.  <br>  <br>Examples: `date-note`, `F-PoZMI0vc`, `NA` (catch all) |
| `instanceId` | Text | Nullable (\*) |     | The ID of the [instance](#root/pOsGYCXsbNQG/tC7s2alapj8V/Gzjqa934BdH4/c5xB8m4g2IY6) that created this change. |
| `isSynced` | Integer (1 or 0) | Non-null |     | TODO: What does this do? |
| `utcDateChanged` | Text | Non-null |     | Date of the entity change in UTC format (e.g. `2023-11-08 16:43:44.204Z`) |

Nullable (\*) means all new values are non-null, old rows may contain null values.