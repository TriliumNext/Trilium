# user_data
Contains the user information for two-factor authentication. This table is **not** used for multi-user.

Relevant files:

*   `apps/server/src/services/encryption/open_id_encryption.ts`

| Column Name | Data Type | Nullity | Default value | Description |
| --- | --- | --- | --- | --- |
| `tmpID` | Integer |     |     | A sequential ID of the user. Since only one user is supported by Trilium, this value is always zero. |
| `username` | Text |     |     | The user name as returned from the OAuth operation. |
| `email` | Text |     |     | The email as returned from the OAuth operation. |
| `userIDEncryptedDataKey` | Text |     |     | An encrypted hash of the user subject identifier from the OAuth operation. |
| `userIDVerificationHash` | Text |     |     | A salted hash of the subject identifier from the OAuth operation. |
| `salt` | Text |     |     | The verification salt. |
| `derivedKey` | Text |     |     | A random secure token. |
| `isSetup` | Text |     | `"false"` | Indicates that the user has been saved (`"true"`). |