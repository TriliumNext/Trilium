# options
| Column Name | Data Type | Nullity | Default value | Description |
| --- | --- | --- | --- | --- |
| `name` | Text | Non-null |     | The name of option (e.g. `maxContentWidth`) |
| `value` | Text | Non-null |     | The value of the option. |
| `isSynced` | Integer | Non-null | 0   | `0` if the option is not synchronized and thus can differ between clients, `1` if the option is synchronized. |
| `utcDateModified` | Text | Non-null |     | Modification date in UTC format (e.g. `2023-11-08 16:43:44.204Z`) |