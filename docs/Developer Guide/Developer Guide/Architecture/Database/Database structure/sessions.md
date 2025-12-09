# sessions
Contains user sessions for authentication purposes. The table is almost a direct mapping of the information that `express-session` requires.

| Column Name | Data Type | Nullity | Default value | Description |
| --- | --- | --- | --- | --- |
| `id` | Text | Non-null |     | Unique, non-sequential ID of the session, directly as indicated by `express-session` |
| `data` | Text | Non-null |     | The session information, in stringified JSON format. |
| `expires` | Integer | Non-null |     | The expiration date of the session, extracted from the session information. Used to rapidly clean up expired sessions. |