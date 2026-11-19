# API Reference
This is the internal API used by the Trilium Notes client application.

**Important:** This API is primarily intended for internal use by the Trilium client. For external integrations, please use the [ETAPI (External Trilium API)](https://github.com/TriliumNext/Trilium/blob/main/docs/User%20Guide/User%20Guide/Advanced%20Usage/ETAPI%20\(REST%20API\).md#etapi-rest-api) instead.

## Signing in

Most endpoints require session-based authentication. You can authenticate using:

*   **Password login**: POST to `/login` with password
*   **Token authentication**: Generate a token via `/api/login/token`
*   **Sync authentication**: Use document secret for sync operations

## Rate Limiting

Authentication endpoints are rate-limited to prevent brute force attacks.

## CSRF Protection

State-changing operations require CSRF tokens when using session authentication.

## <span class="tn-icon bx bx-lock-alt"></span> Authentication

### `sessionAuth`

API key in the `trilium.sid` cookie.

Session cookie obtained from login

### `tokenAuth`

API key in the `Authorization` header.

API token in format "Bearer {token}"

## <span class="tn-icon bx bx-log-in"></span> Sessions

Login, logout, and session management

### Login with password

`POST /login` · `login`

Responds with 401 when the password is wrong or, with two-factor authentication enabled, the TOTP token is missing or wrong.

**Authorization**: none

**Request body** (required)

*   `application/x-www-form-urlencoded`: `object`

| Property | Description |
| --- | --- |
| `password`  <br>_required_ | `string (password)` |
| `totpToken` | `string`  <br>TOTP token if 2FA is enabled |

**Responses**

=== "200: Login successful"

    **Response headers**

    | Name | Description |
    | --- | --- |
    | `Set-Cookie` | `string`  <br>Example: `trilium.sid=s%3A...` |

    No content.

=== "401: Invalid credentials"

    No content.

### Generate API token

`POST /api/login/token` · `generateToken`

**Authorization**: none

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `password`  <br>_required_ | `string (password)` |
| `tokenName` | `string`  <br>Optional name for the token |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "password": "string",
    "tokenName": "string"
}
```

</div>
</div>

**Responses**

=== "201: Token created"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `authToken` | `string`  <br>API authentication token |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "authToken": "string"
    }
    ```

    </div>
    </div>

### Sync login using document secret

`POST /api/login/sync` · `loginSync`

**Authorization**: none

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `timestamp`  <br>_required_ | `string (date-time)` |
| `hash`  <br>_required_ | `string`  <br>HMAC hash of document secret and timestamp |
| `syncVersion`  <br>_required_ | `integer` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "timestamp": "2019-08-24T14:15:22Z",
    "hash": "string",
    "syncVersion": 0
}
```

</div>
</div>

**Responses**

=== "200: Login successful"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `instanceId` | `string` |
    | `maxEntityChangeId` | `string` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "instanceId": "string",
        "maxEntityChangeId": "string"
    }
    ```

    </div>
    </div>

=== "400: Sync version / document secret mismatch"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `message` | `string` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "message": "Non-matching sync versions, local is version ${server syncVersion}, remote is ${requested syncVersion}. It is recommended to run same version of Trilium on both sides of sync"
    }
    ```

    </div>
    </div>

=== "401: Timestamp mismatch"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `message` | `string` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "message": "Auth request time is out of sync, please check that both client and server have correct time. The difference between clocks has to be smaller than 5 minutes"
    }
    ```

    </div>
    </div>

### Enter protected session

`POST /api/login/protected` · `enterProtectedSession`

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `password`  <br>_required_ | `string (password)` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "password": "string"
}
```

</div>
</div>

**Responses**

=== "200: Protected session entered"

    No content.

=== "401: Invalid password"

    No content.

### Exit protected session

`POST /api/logout/protected` · `exitProtectedSession`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "204: Protected session exited"

    No content.

### Keep protected session alive

`POST /api/login/protected/touch` · `touchProtectedSession`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "204: Session refreshed"

    No content.

### Get OAuth status

`GET /api/oauth/status` · `getOAuthStatus`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: OAuth status"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `enabled` | `boolean` |
    | `configured` | `boolean` |
    | `providers` | `array of string` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "enabled": true,
        "configured": true,
        "providers": [
            "string"
        ]
    }
    ```

    </div>
    </div>

### Validate OAuth configuration

`GET /api/oauth/validate` · `validateOAuth`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: OAuth validation result"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `valid` | `boolean` |
    | `errors` | `array of string` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "valid": true,
        "errors": [
            "string"
        ]
    }
    ```

    </div>
    </div>

## <span class="tn-icon bx bx-note"></span> Notes

Core note operations

### Get note metadata

`GET /api/notes/{noteId}` · `getNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: Note metadata"

    *   `application/json`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId`  <br>_required_ | `string`  <br>12-character note ID |
    | `title`  <br>_required_ | `string`  <br>Note title |
    | `type`  <br>_required_ | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
    | `mime`  <br>_required_ | `string`  <br>MIME type |
    | `isProtected`  <br>_required_ | `boolean`  <br>Whether note is protected |
    | `blobId` | `string`  <br>ID of content blob |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "ur11rSfHkzeV",
        "title": "string",
        "type": "text",
        "mime": "text/html",
        "isProtected": true,
        "blobId": "string",
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateCreated": "2025-02-13 07:42:47.698Z",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

=== "404: Note not found"

    No content.

### Delete note

`DELETE /api/notes/{noteId}` · `deleteNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Query parameters**

| Name | Description |
| --- | --- |
| `taskId`  <br>_required_ | `string`  <br>Task group identifier |
| `eraseNotes` | `boolean` |
| `last`  <br>_required_ | `boolean`  <br>Whether this is the last request of this task group |

**Responses**

=== "204: Note deleted"

    No content.

=== "404: Note not found"

    No content.

### Get note content

`GET /api/notes/{noteId}/blob` · `getNoteContent`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: Note content"

    *   `application/json`: [`Blob`](#schema-Blob)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `blobId` | `string` |
    | `content` | `string \| null`  <br>`null` if not text. |
    | `contentLength` | `integer` |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "blobId": "8iqMIB8eiY1tPYmElfjm",
        "content": "string",
        "contentLength": 0,
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

=== "404: Note not found"

    No content.

### Update note content

`PUT /api/notes/{noteId}/data` · `updateNoteContent`

Saves the content of a note. A save with `base` names the version that the content is based on: it is refused with 409, and saves nothing, when the note has another format (type, or Markdown and other code) or another blob, or when an attachment row does not hold. In such a save, a row with `attachmentId` replaces that attachment only while it is at `blobId`, and a row without one creates an attachment of its title, refused when the note has one. The answer is what the next save is based on. A save without `base` is unconditional, and answers 204.

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `content`  <br>_required_ | `string` |
| `attachments` | array of [`SavedAttachmentRow`](#schema-SavedAttachmentRow) |
| `base` | [`NoteSaveBase`](#schema-NoteSaveBase)  <br>What a save of the content of a note is based on |
| `keepOther` | `boolean`  <br>Saves over the version that `base` names, which another writer saved, after the note keeps that version as a revision |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "content": "string",
    "attachments": [
        {
            "attachmentId": "string",
            "blobId": "string",
            "role": "string",
            "title": "string",
            "mime": "string",
            "content": "string",
            "position": 0,
            "encoding": "base64"
        }
    ],
    "base": {
        "blobId": "string",
        "type": "string",
        "mime": "string"
    },
    "keepOther": true
}
```

</div>
</div>

**Responses**

=== "200: Content updated, by a save with `base`"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `blobId`  <br>_required_ | `string` |
    | `attachments`  <br>_required_ | array of [`SavedAttachmentBase`](#schema-SavedAttachmentBase)  <br>The attachments that the save created or replaced |
    | `content` | `string`  <br>The content as stored, when the server changed what was sent |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "blobId": "string",
        "attachments": [
            {
                "attachmentId": "string",
                "title": "string",
                "blobId": "string"
            }
        ],
        "content": "string"
    }
    ```

    </div>
    </div>

=== "204: Content updated, by a save without `base`"

    No content.

=== "400: A malformed `base`, or `keepOther` without `base`"

    No content.

=== "404: Note not found"

    No content.

=== "409: The note has another format or version than the save is based on"

    *   `application/json`: [`SaveConflict`](#schema-SaveConflict)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `reason`  <br>_required_ | `string`  <br>One of `format`, `version`. |
    | `message`  <br>_required_ | `string` |
    | `blobId`  <br>_required_ | `string`  <br>The blob of the note now, which a save that keeps its version names |
    | `type`  <br>_required_ | `string` |
    | `mime`  <br>_required_ | `string` |
    | `isVersioned`  <br>_required_ | `boolean`  <br>Whether the note keeps revisions |
    | `attachments`  <br>_required_ | array of [`SavedAttachmentBase`](#schema-SavedAttachmentBase)  <br>The attachments that the save names, by ID or by title, as the note has them now. A save that keeps its version replaces them at these blobs. |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "reason": "format",
        "message": "string",
        "blobId": "string",
        "type": "string",
        "mime": "string",
        "isVersioned": true,
        "attachments": [
            {
                "attachmentId": "string",
                "title": "string",
                "blobId": "string"
            }
        ]
    }
    ```

    </div>
    </div>

### Get note timestamps

`GET /api/notes/{noteId}/metadata` · `getNoteMetadata`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: Note timestamps"

    *   `application/json`: [`Timestamps`](#schema-Timestamps)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateCreated": "2025-02-13 07:42:47.698Z",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

=== "404: Note not found"

    No content.

### Get blocks of a text note

`GET /api/notes/{noteId}/blocks` · `getNoteBlocks`

The blocks of a text note that `block` points at, as their exact HTML source, so that an excerpt can edit them apart from the rest of the note. The range must be a run of whole sibling blocks. A run of list items comes inside a copy of its list, numbered as in the note.

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Query parameters**

| Name | Description |
| --- | --- |
| `block`  <br>_required_ | `string`  <br>The block id of one block, or the ids of the first and the last block of a range joined with `:` |

**Responses**

=== "200: The HTML of the blocks"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `content`  <br>_required_ | `string` |
    | `hash`  <br>_required_ | `string`  <br>The hash of `content`, which a save of the blocks is based on |
    | `note`  <br>_required_ | `string`  <br>The whole note that `content` was read from, which a draft of the blocks goes into |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "content": "<p data-trilium-block-id=\"eaJkN47U8kI4\">First paragraph</p>",
        "hash": "string",
        "note": "string"
    }
    ```

    </div>
    </div>

=== "400: No `block` parameter, a note that is not a text note, or a protected note without a protected session"

    No content.

=== "404: The note or a block of the range does not exist, or the range is not a run of whole sibling blocks"

    No content.

### Replace blocks of a text note

`PUT /api/notes/{noteId}/blocks` · `updateNoteBlocks`

Replaces the blocks that `block` points at with `content` and saves the note as `PUT /api/notes/{noteId}/data` does, with a revision when one is due. The rest of the note keeps its bytes. Block ids in `content` that the note holds outside the range are removed. For a run of list items, `content` is a list: when its tag and `class` match the original list, its items replace the run and its other attributes apply to the whole list; otherwise the original list is split around `content`. `block` is the range as the note stores it before the change; once the blocks at its edges change, later requests use the new range.

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Query parameters**

| Name | Description |
| --- | --- |
| `block`  <br>_required_ | `string`  <br>The block id of one block, or the ids of the first and the last block of a range joined with `:` |

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `content`  <br>_required_ | `string`  <br>The HTML of the blocks |
| `attachments` | array of [`SavedAttachmentRow`](#schema-SavedAttachmentRow) |
| `base` | `object`  <br>The `hash` of the blocks as read. The save is refused with 409 when the blocks have changed since; a change elsewhere in the note goes through. |
| `base.hash`  <br>_required_ | `string` |
| `keepOther` | `boolean`  <br>Saves over the blocks that `base` names, after the note keeps its version as a revision |
| `block` | `string`  <br>The range of the blocks after the save, when it differs from `block` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "content": "<p data-trilium-block-id=\"eaJkN47U8kI4\">First paragraph</p>",
    "attachments": [
        {
            "attachmentId": "string",
            "blobId": "string",
            "role": "string",
            "title": "string",
            "mime": "string",
            "content": "string",
            "position": 0,
            "encoding": "base64"
        }
    ],
    "base": {
        "hash": "string"
    },
    "keepOther": true,
    "block": "string"
}
```

</div>
</div>

**Responses**

=== "200: Blocks replaced, by a save with `base`"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `hash`  <br>_required_ | `string \| null`  <br>The hash of the blocks as saved, `null` when they cannot be read apart |
    | `note`  <br>_required_ | `string`  <br>The whole note as the save left it, which a draft of the blocks goes into |
    | `attachments`  <br>_required_ | array of [`SavedAttachmentBase`](#schema-SavedAttachmentBase)  <br>The attachments that the save created or replaced |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "hash": "string",
        "note": "string",
        "attachments": [
            {
                "attachmentId": "string",
                "title": "string",
                "blobId": "string"
            }
        ]
    }
    ```

    </div>
    </div>

=== "204: Blocks replaced, by a save without `base`"

    No content.

=== "400: No `block` parameter, no `content`, a malformed `base`, `keepOther` without `base`, a note that is not a text note in a save without `base`, or a protected note without a protected session"

    No content.

=== "404: The note or a block of the range does not exist, or the range is not a run of whole sibling blocks"

    No content.

=== "409: The blocks, or an attachment that the save replaces, changed since they were read (`version`), or the blocks can no longer be saved apart (`format`, `range`)"

    *   `application/json`: [`BlocksVersionConflict`](#schema-BlocksVersionConflict) | [`BlocksGoneConflict`](#schema-BlocksGoneConflict)

    ```json
    {
        "reason": "version",
        "message": "string",
        "hash": "string",
        "attachments": [
            {
                "attachmentId": "string",
                "title": "string",
                "blobId": "string"
            }
        ],
        "isVersioned": true
    }
    ```

### List the places inside a note that a link can point at

`GET /api/notes/{noteId}/references` · `getNoteReferences`

The targets of a note, such as the headings and anchors of a text note, in the order that the link lists show them, the targets of each kind together. A link points at a target by adding its `params` to the path of the note: a heading of a text note through `?block=` and its block id, an anchor through `?bookmark=`. A target without `params` needs a reference first, which `POST /api/notes/{noteId}/references` creates. Such a target is listed only when the note can take one. Titles are plain text, never HTML. A note whose type has no targets lists none. The headings of a PDF file, the headings and bookmarks of a Word (DOCX) or OpenDocument text (ODT) file, and the entries of an EPUB e-book's table of contents come from its ToC cache, which the server builds when it is missing or stale. Where the server cannot read PDFs (standalone, mobile), the answer for a PDF lists none and carries `pendingToc` until the viewer of the file has built the cache. A DOCX, ODT or EPUB file links a heading through `?heading=`, and a DOCX or ODT file a bookmark through `?bookmark=`. An entry of an EPUB's table of contents that its preview does not show is not listed.

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: The targets of the note"

    *   `application/json`: [`NoteReferences`](#schema-NoteReferences)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `targets`  <br>_required_ | array of [`ReferenceTarget`](#schema-ReferenceTarget) |
    | `blobId` | `string`  <br>The blob of the note that the targets were read from |
    | `pendingToc` | [`PendingToc`](#schema-PendingToc)  <br>A table of contents that the viewer of the document builds |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "targets": [
            {
                "kind": "heading",
                "title": "Installation",
                "level": 2,
                "params": {
                    "block": "eaJkN47U8kI4"
                }
            }
        ],
        "blobId": "string",
        "pendingToc": {
            "format": "pdf"
        }
    }
    ```

    </div>
    </div>

=== "400: A protected note without a protected session"

    No content.

=== "404: Note not found"

    No content.

### Give a target a reference

`POST /api/notes/{noteId}/references` · `createNoteReference`

Gives a target that `GET /api/notes/{noteId}/references` lists without `params` a reference, unless it has one, and returns the link parameters that point at it. A request names the target by exactly one of `index` and `line`. By `index`, the target is the one at that position among the targets of its `kind` while its title is still `title`, otherwise the only target of that kind with that title. By `line`, which only Markdown notes take, it is the only heading whose block starts on that source line, while its title is `title`. A request that names the `blobId` of its listing is refused with 409, reason `listing`, when the note has another blob: the targets are then listed again. For a heading of a text note, the reference is a block id. Read-only notes get the reference too. It is the only change to the content, and no revision is saved.

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `kind`  <br>_required_ | [`ReferenceKind`](#schema-ReferenceKind)  <br>The kind of a target, which sets how the link lists show it. One of `heading`, `anchor`. |
| `index` | `integer`  <br>The position of the target among the targets of its kind. Not sent with `line`. |
| `line` | `integer`  <br>The 1-based source line where the block of a heading of a Markdown note starts, in the blob `blobId`. Not sent with `index`, and requires `blobId`. |
| `title`  <br>_required_ | `string`  <br>The title of the target there |
| `blobId` | `string`  <br>The `blobId` of the listing that the target was picked from. Required with `line`. |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "kind": "heading",
    "index": 0,
    "line": 12,
    "title": "Installation",
    "blobId": "string"
}
```

</div>
</div>

**Responses**

=== "200: The link parameters of the target"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `params`  <br>_required_ | [`ReferenceParams`](#schema-ReferenceParams)  <br>The parameters of a link that point at a target, not encoded |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "params": {
            "block": "eaJkN47U8kI4"
        }
    }
    ```

    </div>
    </div>

=== "400: A malformed request, a note whose targets take no reference, a `line` for a note that is not Markdown, a protected note without a protected session, or a note whose content cannot be changed, such as a help page"

    No content.

=== "404: Note not found"

    No content.

=== "409: No target matches, because the targets changed since they were listed, or the listing was read from another blob (reason `listing`)"

    No content.

### List the headings of a text note with its content marked by their positions

`GET /api/notes/{noteId}/references/marked` · `getMarkedNoteHeadings`

For a read-only view of a text note, which parses the content otherwise than the server. Answers the heading targets as `GET /api/notes/{noteId}/references` lists them, before any filtering, and the content with `data-trilium-heading-index` on the opening tag of each of them, valued `<markToken>.<position>`. The position is the `index` that `POST /api/notes/{noteId}/references` takes. `markToken` is drawn for each answer and occurs nowhere in the content. Writes nothing.

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: The headings and the marked content"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `blobId` | `string`  <br>The blob that the headings and the content were read from, absent for a note without one |
    | `headings`  <br>_required_ | array of [`ReferenceTarget`](#schema-ReferenceTarget) |
    | `markedContent`  <br>_required_ | `string`  <br>The content with each heading marked; never saved |
    | `markToken`  <br>_required_ | `string`  <br>The token that every mark of this answer starts with |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "blobId": "string",
        "headings": [
            {
                "kind": "heading",
                "title": "Installation",
                "level": 2,
                "params": {
                    "block": "eaJkN47U8kI4"
                }
            }
        ],
        "markedContent": "string",
        "markToken": "Xb2kQ9pLm4Rt"
    }
    ```

    </div>
    </div>

=== "400: A note that is not a text note, or a protected note without a protected session"

    No content.

=== "404: Note not found"

    No content.

### Read the ToC cache of a note

`GET /api/notes/{noteId}/toc` · `getNoteToc`

The table of contents that the ToC cache of a note holds, such as the outline of a PDF file, the headings of a DOCX or ODT file or the entries of an EPUB e-book's table of contents, without building it or writing anything. `ready` is a cache of the note as it is, `stale` one of an earlier blob, `missing` a note without a cache that can be read, `unavailable` a note that is gone or protected without a protected session, and `none` a note that has no table of contents. `pendingToc` tells that the viewer of the document builds the cache, since the server cannot read the format. Each heading carries the `params` of a link to it.

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: The cached table of contents"

    *   `application/json`: [`CachedToc`](#schema-CachedToc)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `string`  <br>One of `ready`, `stale`, `missing`, `unreadable`, `unavailable`, `none`. |
    | `blobId` | `string`  <br>For `ready` and `stale`, the blob that the headings were read from |
    | `headings` | array of [`TocHeading`](#schema-TocHeading) |
    | `pendingToc` | [`PendingToc`](#schema-PendingToc)  <br>A table of contents that the viewer of the document builds |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": "ready",
        "blobId": "string",
        "headings": [
            {
                "id": "0k3x9aa1h7q2mz",
                "title": "Installation",
                "level": 1,
                "params": {
                    "page": "4",
                    "heading": "0k3x9aa1h7q2mz"
                }
            }
        ],
        "pendingToc": {
            "format": "pdf"
        }
    }
    ```

    </div>
    </div>

### Save the table of contents that the viewer read

`PUT /api/notes/{noteId}/toc` · `saveNoteToc`

Saves the table of contents that the viewer of a document read, where the server cannot read the format itself, which is PDF on standalone and mobile. The server checks it, normalizes the titles and computes the ids of the headings. A valid cache that exists already is kept.

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Request body** (required)

*   `application/json`: [`ClientToc`](#schema-ClientToc)

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `targetBlobHash`  <br>_required_ | `string`  <br>The `blobId` of the bytes that the viewer read, from their digest |
| `headings`  <br>_required_ | `array of object`  <br>In document order, without ids: `title` (at most 500 characters), `level` (1 for the first heading, at most one more than the heading before), and the fields of the format |
| `properties` | `object`  <br>The properties of the format, such as `{ "reader": 2 }` |
| `isCut` | `boolean`  <br>Whether the viewer stopped reading at 20,000 headings, before another one. The ids of every heading of a cut table of contents are bound to the blob. |
| `elapsedMs`  <br>_required_ | `number`  <br>How long the viewer took, for the log |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "targetBlobHash": "string",
    "headings": [
        {}
    ],
    "properties": {},
    "isCut": true,
    "elapsedMs": 0
}
```

</div>
</div>

**Responses**

=== "200: The saved cache"

    *   `application/json`: [`CachedToc`](#schema-CachedToc)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `string`  <br>One of `ready`, `stale`, `missing`, `unreadable`, `unavailable`, `none`. |
    | `blobId` | `string`  <br>For `ready` and `stale`, the blob that the headings were read from |
    | `headings` | array of [`TocHeading`](#schema-TocHeading) |
    | `pendingToc` | [`PendingToc`](#schema-PendingToc)  <br>A table of contents that the viewer of the document builds |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": "ready",
        "blobId": "string",
        "headings": [
            {
                "id": "0k3x9aa1h7q2mz",
                "title": "Installation",
                "level": 1,
                "params": {
                    "page": "4",
                    "heading": "0k3x9aa1h7q2mz"
                }
            }
        ],
        "pendingToc": {
            "format": "pdf"
        }
    }
    ```

    </div>
    </div>

=== "400: A malformed table of contents, a note without a table of contents format, a protected note without a protected session, or a server that reads the format itself"

    No content.

=== "404: Note not found"

    No content.

=== "409: The note has another blob than the one the viewer read (reason `changed`)"

    No content.

### Build the ToC cache of a note

`POST /api/notes/{noteId}/toc/build` · `buildNoteToc`

Answers the ToC cache of a note, and builds and saves it first when it is not valid and the server can read the format. Where only the viewer can read it (PDF on standalone and mobile), answers as `GET /api/notes/{noteId}/toc` does, with `pendingToc`. `unreadable` is a file whose table of contents cannot be read.

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: The table of contents"

    *   `application/json`: [`CachedToc`](#schema-CachedToc)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `string`  <br>One of `ready`, `stale`, `missing`, `unreadable`, `unavailable`, `none`. |
    | `blobId` | `string`  <br>For `ready` and `stale`, the blob that the headings were read from |
    | `headings` | array of [`TocHeading`](#schema-TocHeading) |
    | `pendingToc` | [`PendingToc`](#schema-PendingToc)  <br>A table of contents that the viewer of the document builds |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": "ready",
        "blobId": "string",
        "headings": [
            {
                "id": "0k3x9aa1h7q2mz",
                "title": "Installation",
                "level": 1,
                "params": {
                    "page": "4",
                    "heading": "0k3x9aa1h7q2mz"
                }
            }
        ],
        "pendingToc": {
            "format": "pdf"
        }
    }
    ```

    </div>
    </div>

=== "409: The note changed during two builds in a row"

    No content.

### Change note title

`PUT /api/notes/{noteId}/title` · `updateNoteTitle`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `title`  <br>_required_ | `string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "title": "string"
}
```

</div>
</div>

**Responses**

=== "204: Title updated"

    No content.

=== "404: Note not found"

    No content.

### Change note type and MIME

`PUT /api/notes/{noteId}/type` · `updateNoteType`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `type`  <br>_required_ | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
| `mime`  <br>_required_ | `string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "type": "text",
    "mime": "string"
}
```

</div>
</div>

**Responses**

=== "204: Type updated"

    No content.

=== "404: Note not found"

    No content.

### Protect or unprotect note

`PUT /api/notes/{noteId}/protect/{isProtected}` · `protectNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |
| `isProtected`  <br>_required_ | `boolean` |

**Query parameters**

| Name | Description |
| --- | --- |
| `subtree` | `boolean` |

**Responses**

=== "204: Protection status updated"

    No content.

=== "404: Note not found"

    No content.

### Undelete note

`PUT /api/notes/{noteId}/undelete` · `undeleteNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "204: Note undeleted"

    No content.

=== "404: Note not found"

    No content.

### Create new note

`POST /api/notes/{parentNoteId}/children` · `createNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `parentNoteId`  <br>_required_ | `string` |

**Query parameters**

| Name | Description |
| --- | --- |
| `target` | `string`  <br>One of `after`, `into`. |
| `targetBranchId` | `string` |

**Request body** (required)

*   `application/json`: [`CreateNoteRequest`](#schema-CreateNoteRequest)

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `title`  <br>_required_ | `string` |
| `content` | `string` |
| `type`  <br>_required_ | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
| `mime` | `string` |
| `isProtected` | `boolean` |
| `isExpanded` | `boolean` |
| `notePosition` | `integer` |
| `prefix` | `string` |
| `parentNoteId` | `string` |
| `templateNoteId` | `string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "title": "string",
    "content": "string",
    "type": "text",
    "mime": "string",
    "isProtected": true,
    "isExpanded": true,
    "notePosition": 0,
    "prefix": "string",
    "parentNoteId": "string",
    "templateNoteId": "string"
}
```

</div>
</div>

**Responses**

=== "201: Note created"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `note` | [`Note`](#schema-Note) |
    | `branch` | [`Branch`](#schema-Branch) |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "note": {
            "noteId": "ur11rSfHkzeV",
            "title": "string",
            "type": "text",
            "mime": "text/html",
            "isProtected": true,
            "blobId": "string",
            "dateCreated": "2025-02-14 08:19:59.203+0100",
            "dateModified": "2025-02-14 08:19:59.203+0100",
            "utcDateCreated": "2025-02-13 07:42:47.698Z",
            "utcDateModified": "2025-02-13 07:42:47.698Z"
        },
        "branch": {
            "branchId": "string",
            "noteId": "string",
            "parentNoteId": "string",
            "notePosition": 0,
            "prefix": "string",
            "isExpanded": true
        }
    }
    ```

    </div>
    </div>

### Duplicate note subtree

`POST /api/notes/{noteId}/duplicate/{parentNoteId}` · `duplicateNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |
| `parentNoteId`  <br>_required_ | `string` |

**Responses**

=== "201: Note duplicated"

    *   `application/json`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId`  <br>_required_ | `string`  <br>12-character note ID |
    | `title`  <br>_required_ | `string`  <br>Note title |
    | `type`  <br>_required_ | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
    | `mime`  <br>_required_ | `string`  <br>MIME type |
    | `isProtected`  <br>_required_ | `boolean`  <br>Whether note is protected |
    | `blobId` | `string`  <br>ID of content blob |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "ur11rSfHkzeV",
        "title": "string",
        "type": "text",
        "mime": "text/html",
        "isProtected": true,
        "blobId": "string",
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateCreated": "2025-02-13 07:42:47.698Z",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

### Force save revision

`POST /api/notes/{noteId}/revision` · `saveRevision`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "201: Revision saved"

    *   `application/json`: [`Revision`](#schema-Revision)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `revisionId` | `string` |
    | `noteId` | `string` |
    | `title` | `string` |
    | `type` | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
    | `mime` | `string` |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "revisionId": "string",
        "noteId": "string",
        "title": "string",
        "type": "text",
        "mime": "string",
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "utcDateCreated": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

### Sort child notes

`PUT /api/notes/{noteId}/sort-children` · `sortChildren`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `sortBy` | `string`  <br>One of `title`, `dateCreated`, `dateModified`. |
| `sortDirection` | `string`  <br>One of `asc`, `desc`. |
| `foldersFirst` | `boolean` |
| `sortNatural` | `boolean` |
| `sortLocale` | `string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "sortBy": "title",
    "sortDirection": "asc",
    "foldersFirst": true,
    "sortNatural": true,
    "sortLocale": "string"
}
```

</div>
</div>

**Responses**

=== "204: Children sorted"

    No content.

### Convert note to attachment

`POST /api/notes/{noteId}/convert-to-attachment` · `convertToAttachment`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: Note converted to attachment"

    *   `application/json`: [`Attachment`](#schema-Attachment)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `attachmentId`  <br>_required_ | `string` |
    | `ownerId`  <br>_required_ | `string` |
    | `role`  <br>_required_ | `string`  <br>One of `image`, `file`. |
    | `mime`  <br>_required_ | `string` |
    | `title`  <br>_required_ | `string` |
    | `blobId` | `string` |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "attachmentId": "string",
        "ownerId": "string",
        "role": "image",
        "mime": "string",
        "title": "string",
        "blobId": "string",
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

### Upload file to note

`PUT /api/notes/{noteId}/file` · `uploadFileToNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Request body** (required)

*   `multipart/form-data`: `object`

| Property | Description |
| --- | --- |
| `upload` | `string (binary)` |

**Responses**

=== "200: File uploaded"

    *   `application/json`: [`FileUploaded`](#schema-FileUploaded)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `uploaded`  <br>_required_ | `boolean` |
    | `blobId` | `string`  <br>The blob that the upload wrote |
    | `message` | `string`  <br>Why nothing was uploaded |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "uploaded": true,
        "blobId": "string",
        "message": "string"
    }
    ```

    </div>
    </div>

### Open file note

`GET /api/notes/{noteId}/open` · `openFileNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Query parameters**

| Name | Description |
| --- | --- |
| `blobId` | `string`  <br>The blob that the caller expects. When the content holds another one, the route answers 409 without the content. |

**Responses**

=== "200: File content"

    *   `application/octet-stream`: `string (binary)`

=== "409: The note holds another blob than `blobId`"

    No content.

### Download file note

`GET /api/notes/download/{noteId}` · `downloadFileNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: File content"

    **Response headers**

    | Name | Description |
    | --- | --- |
    | `Content-Disposition` | `string`  <br>Example: `attachment; filename="document.pdf"` |

    *   `application/octet-stream`: `string (binary)`

### Download file note (alternative path)

`GET /api/notes/{noteId}/download` · `downloadFileNoteAlt`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: File content"

    **Response headers**

    | Name | Description |
    | --- | --- |
    | `Content-Disposition` | `string`  <br>Example: `attachment; filename="document.pdf"` |

    *   `application/octet-stream`: `string (binary)`

### Save note to temp directory

`POST /api/notes/{noteId}/save-to-tmp-dir` · `saveToTmpDir`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: File saved to temp directory"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `filePath` | `string` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "filePath": "string"
    }
    ```

    </div>
    </div>

### Update note from modified temp file

`POST /api/notes/{noteId}/upload-modified-file` · `uploadModifiedFile`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `filePath`  <br>_required_ | `string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "filePath": "string"
}
```

</div>
</div>

**Responses**

=== "204: Note updated from file"

    No content.

### Retrieve the timestamps of several notes at once

`POST /api/notes/metadata` · `notesMetadata`

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `noteIds` | `array of string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "noteIds": [
        "string"
    ]
}
```

</div>
</div>

**Responses**

=== "200: The timestamps of each note found, keyed by note ID"

    *   `application/json`: `object`

    ```json
    {}
    ```

### Get image from note

`GET /api/images/{noteId}/{filename}` · `getNoteImage`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |
| `filename`  <br>_required_ | `string` |

**Responses**

=== "200: Image content"

    *   `image/*`: `string (binary)`

### Update image note

`PUT /api/images/{noteId}` · `updateImageNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Request body** (required)

*   `multipart/form-data`: `object`

| Property | Description |
| --- | --- |
| `upload` | `string (binary)` |

**Responses**

=== "204: Image updated"

    No content.

### Execute bulk action

`POST /api/bulk-action/execute` · `executeBulkAction`

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `action` | `string` |
| `noteIds` | `array of string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "action": "string",
    "noteIds": [
        "string"
    ]
}
```

</div>
</div>

**Responses**

=== "200: Bulk action results"

    No content.

### Get affected notes count

`POST /api/bulk-action/affected-notes` · `getAffectedNotesCount`

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `action` | `string` |
| `noteIds` | `array of string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "action": "string",
    "noteIds": [
        "string"
    ]
}
```

</div>
</div>

**Responses**

=== "200: Affected notes count"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `count` | `integer` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "count": 0
    }
    ```

    </div>
    </div>

### Preview note deletion

`POST /api/delete-notes-preview` · `previewNoteDeletion`

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `branchIdsToDelete` | `array of string` |
| `deleteAllClones` | `boolean` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "branchIdsToDelete": [
        "string"
    ],
    "deleteAllClones": true
}
```

</div>
</div>

**Responses**

=== "200: Deletion preview"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `notesToDelete` | `array of string` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "notesToDelete": [
            "string"
        ]
    }
    ```

    </div>
    </div>

### Erase deleted notes

`POST /api/notes/erase-deleted-notes-now` · `eraseDeletedNotes`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "204: Deleted notes erased"

    No content.

## <span class="tn-icon bx bx-sitemap"></span> Tree

Note tree structure and branches

### Get tree structure

`GET /api/tree` · `getTree`

**Authorization**: `sessionAuth` or `tokenAuth`

**Query parameters**

| Name | Description |
| --- | --- |
| `subTreeNoteId` | `string`  <br>Limit tree to this note and descendants |

**Responses**

=== "200: Tree structure"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `notes` | array of [`Note`](#schema-Note) |
    | `branches` | array of [`Branch`](#schema-Branch) |
    | `attributes` | array of [`Attribute`](#schema-Attribute) |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "notes": [
            {
                "noteId": "ur11rSfHkzeV",
                "title": "string",
                "type": "text",
                "mime": "text/html",
                "isProtected": true,
                "blobId": "string",
                "dateCreated": "2025-02-14 08:19:59.203+0100",
                "dateModified": "2025-02-14 08:19:59.203+0100",
                "utcDateCreated": "2025-02-13 07:42:47.698Z",
                "utcDateModified": "2025-02-13 07:42:47.698Z"
            }
        ],
        "branches": [
            {
                "branchId": "string",
                "noteId": "string",
                "parentNoteId": "string",
                "notePosition": 0,
                "prefix": "string",
                "isExpanded": true
            }
        ],
        "attributes": [
            {
                "attributeId": "string",
                "noteId": "string",
                "type": "label",
                "name": "string",
                "value": "string",
                "position": 0,
                "isInheritable": true
            }
        ]
    }
    ```

    </div>
    </div>

### Load specific notes

`POST /api/tree/load` · `loadNotes`

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `noteIds`  <br>_required_ | `array of string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "noteIds": [
        "string"
    ]
}
```

</div>
</div>

**Responses**

=== "200: Loaded notes"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `notes` | array of [`Note`](#schema-Note) |
    | `branches` | array of [`Branch`](#schema-Branch) |
    | `attributes` | array of [`Attribute`](#schema-Attribute) |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "notes": [
            {
                "noteId": "ur11rSfHkzeV",
                "title": "string",
                "type": "text",
                "mime": "text/html",
                "isProtected": true,
                "blobId": "string",
                "dateCreated": "2025-02-14 08:19:59.203+0100",
                "dateModified": "2025-02-14 08:19:59.203+0100",
                "utcDateCreated": "2025-02-13 07:42:47.698Z",
                "utcDateModified": "2025-02-13 07:42:47.698Z"
            }
        ],
        "branches": [
            {
                "branchId": "string",
                "noteId": "string",
                "parentNoteId": "string",
                "notePosition": 0,
                "prefix": "string",
                "isExpanded": true
            }
        ],
        "attributes": [
            {
                "attributeId": "string",
                "noteId": "string",
                "type": "label",
                "name": "string",
                "value": "string",
                "position": 0,
                "isInheritable": true
            }
        ]
    }
    ```

    </div>
    </div>

### Delete branch

`DELETE /api/branches/{branchId}` · `deleteBranch`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `branchId`  <br>_required_ | `string` |

**Query parameters**

| Name | Description |
| --- | --- |
| `taskId`  <br>_required_ | `string`  <br>Task group identifier |
| `eraseNotes` | `boolean` |
| `last`  <br>_required_ | `boolean`  <br>Whether this is the last request of this task group |

**Responses**

=== "200: Branch deleted"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteDeleted` | `boolean`  <br>Whether the last note clone was deleted |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteDeleted": true
    }
    ```

    </div>
    </div>

### Move branch to new parent

`PUT /api/branches/{branchId}/move-to/{parentBranchId}` · `moveBranchToParent`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `branchId`  <br>_required_ | `string` |
| `parentBranchId`  <br>_required_ | `string` |

**Responses**

=== "204: Branch moved"

    No content.

### Move branch before another

`PUT /api/branches/{branchId}/move-before/{beforeBranchId}` · `moveBranchBefore`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `branchId`  <br>_required_ | `string` |
| `beforeBranchId`  <br>_required_ | `string` |

**Responses**

=== "204: Branch moved"

    No content.

### Move branch after another

`PUT /api/branches/{branchId}/move-after/{afterBranchId}` · `moveBranchAfter`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `branchId`  <br>_required_ | `string` |
| `afterBranchId`  <br>_required_ | `string` |

**Responses**

=== "204: Branch moved"

    No content.

### Set branch expanded state

`PUT /api/branches/{branchId}/expanded/{expanded}` · `setBranchExpanded`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `branchId`  <br>_required_ | `string` |
| `expanded`  <br>_required_ | `boolean` |

**Responses**

=== "204: Expanded state updated"

    No content.

### Set subtree expanded state

`PUT /api/branches/{branchId}/expanded-subtree/{expanded}` · `setSubtreeExpanded`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `branchId`  <br>_required_ | `string` |
| `expanded`  <br>_required_ | `boolean` |

**Responses**

=== "204: Subtree expanded state updated"

    No content.

### Set branch prefix

`PUT /api/branches/{branchId}/set-prefix` · `setBranchPrefix`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `branchId`  <br>_required_ | `string` |

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `prefix` | `string \| null` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "prefix": "string"
}
```

</div>
</div>

**Responses**

=== "204: Prefix updated"

    No content.

### Clone note to branch

`PUT /api/notes/{noteId}/clone-to-branch/{parentBranchId}` · `cloneToBranch`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |
| `parentBranchId`  <br>_required_ | `string` |

**Responses**

=== "200: Note cloned"

    *   `application/json`: [`Branch`](#schema-Branch)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `branchId`  <br>_required_ | `string`  <br>Branch ID (parentNoteId\_noteId) |
    | `noteId`  <br>_required_ | `string` |
    | `parentNoteId`  <br>_required_ | `string` |
    | `notePosition`  <br>_required_ | `integer` |
    | `prefix` | `string \| null` |
    | `isExpanded` | `boolean` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "branchId": "string",
        "noteId": "string",
        "parentNoteId": "string",
        "notePosition": 0,
        "prefix": "string",
        "isExpanded": true
    }
    ```

    </div>
    </div>

### Clone note to parent note

`PUT /api/notes/{noteId}/clone-to-note/{parentNoteId}` · `cloneToNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |
| `parentNoteId`  <br>_required_ | `string` |

**Responses**

=== "200: Note cloned"

    *   `application/json`: [`Branch`](#schema-Branch)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `branchId`  <br>_required_ | `string`  <br>Branch ID (parentNoteId\_noteId) |
    | `noteId`  <br>_required_ | `string` |
    | `parentNoteId`  <br>_required_ | `string` |
    | `notePosition`  <br>_required_ | `integer` |
    | `prefix` | `string \| null` |
    | `isExpanded` | `boolean` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "branchId": "string",
        "noteId": "string",
        "parentNoteId": "string",
        "notePosition": 0,
        "prefix": "string",
        "isExpanded": true
    }
    ```

    </div>
    </div>

### Clone note after branch

`PUT /api/notes/{noteId}/clone-after/{afterBranchId}` · `cloneAfterBranch`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |
| `afterBranchId`  <br>_required_ | `string` |

**Responses**

=== "200: Note cloned"

    *   `application/json`: [`Branch`](#schema-Branch)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `branchId`  <br>_required_ | `string`  <br>Branch ID (parentNoteId\_noteId) |
    | `noteId`  <br>_required_ | `string` |
    | `parentNoteId`  <br>_required_ | `string` |
    | `notePosition`  <br>_required_ | `integer` |
    | `prefix` | `string \| null` |
    | `isExpanded` | `boolean` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "branchId": "string",
        "noteId": "string",
        "parentNoteId": "string",
        "notePosition": 0,
        "prefix": "string",
        "isExpanded": true
    }
    ```

    </div>
    </div>

### Clone note before branch

`PUT /api/notes/{noteId}/clone-before/{beforeBranchId}` · `cloneBeforeBranch`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |
| `beforeBranchId`  <br>_required_ | `string` |

**Responses**

=== "200: Note cloned"

    *   `application/json`: [`Branch`](#schema-Branch)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `branchId`  <br>_required_ | `string`  <br>Branch ID (parentNoteId\_noteId) |
    | `noteId`  <br>_required_ | `string` |
    | `parentNoteId`  <br>_required_ | `string` |
    | `notePosition`  <br>_required_ | `integer` |
    | `prefix` | `string \| null` |
    | `isExpanded` | `boolean` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "branchId": "string",
        "noteId": "string",
        "parentNoteId": "string",
        "notePosition": 0,
        "prefix": "string",
        "isExpanded": true
    }
    ```

    </div>
    </div>

### Toggle note presence in parent

`PUT /api/notes/{noteId}/toggle-in-parent/{parentNoteId}/{present}` · `toggleInParent`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |
| `parentNoteId`  <br>_required_ | `string` |
| `present`  <br>_required_ | `boolean` |

**Responses**

=== "204: Presence toggled"

    No content.

## <span class="tn-icon bx bx-purchase-tag"></span> Attributes

Note attributes and metadata

### Get effective note attributes

`GET /api/notes/{noteId}/attributes` · `getNoteAttributes`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: Note attributes"

    *   `application/json`: array of [`Attribute`](#schema-Attribute)

    ```json
    [
        {
            "attributeId": "string",
            "noteId": "string",
            "type": "label",
            "name": "string",
            "value": "string",
            "position": 0,
            "isInheritable": true
        }
    ]
    ```

### Update all note attributes

`PUT /api/notes/{noteId}/attributes` · `updateNoteAttributes`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Request body** (required)

*   `application/json`: array of [`Attribute`](#schema-Attribute)

```json
[
    {
        "attributeId": "string",
        "noteId": "string",
        "type": "label",
        "name": "string",
        "value": "string",
        "position": 0,
        "isInheritable": true
    }
]
```

**Responses**

=== "204: Attributes updated"

    No content.

### Add note attribute

`POST /api/notes/{noteId}/attributes` · `addNoteAttribute`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Request body** (required)

*   `application/json`: [`Attribute`](#schema-Attribute)

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `attributeId`  <br>_required_ | `string` |
| `noteId`  <br>_required_ | `string` |
| `type`  <br>_required_ | `string`  <br>One of `label`, `relation`. |
| `name`  <br>_required_ | `string` |
| `value`  <br>_required_ | `string` |
| `position` | `integer` |
| `isInheritable` | `boolean` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "attributeId": "string",
    "noteId": "string",
    "type": "label",
    "name": "string",
    "value": "string",
    "position": 0,
    "isInheritable": true
}
```

</div>
</div>

**Responses**

=== "201: Attribute added"

    *   `application/json`: [`Attribute`](#schema-Attribute)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `attributeId`  <br>_required_ | `string` |
    | `noteId`  <br>_required_ | `string` |
    | `type`  <br>_required_ | `string`  <br>One of `label`, `relation`. |
    | `name`  <br>_required_ | `string` |
    | `value`  <br>_required_ | `string` |
    | `position` | `integer` |
    | `isInheritable` | `boolean` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "attributeId": "string",
        "noteId": "string",
        "type": "label",
        "name": "string",
        "value": "string",
        "position": 0,
        "isInheritable": true
    }
    ```

    </div>
    </div>

### Delete attribute

`DELETE /api/notes/{noteId}/attributes/{attributeId}` · `deleteAttribute`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |
| `attributeId`  <br>_required_ | `string` |

**Responses**

=== "204: Attribute deleted"

    No content.

### Update single attribute

`PUT /api/notes/{noteId}/attribute` · `updateAttribute`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Request body** (required)

*   `application/json`: [`Attribute`](#schema-Attribute)

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `attributeId`  <br>_required_ | `string` |
| `noteId`  <br>_required_ | `string` |
| `type`  <br>_required_ | `string`  <br>One of `label`, `relation`. |
| `name`  <br>_required_ | `string` |
| `value`  <br>_required_ | `string` |
| `position` | `integer` |
| `isInheritable` | `boolean` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "attributeId": "string",
    "noteId": "string",
    "type": "label",
    "name": "string",
    "value": "string",
    "position": 0,
    "isInheritable": true
}
```

</div>
</div>

**Responses**

=== "204: Attribute updated"

    No content.

### Set attribute value

`PUT /api/notes/{noteId}/set-attribute` · `setAttribute`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `type`  <br>_required_ | `string`  <br>One of `label`, `relation`. |
| `name`  <br>_required_ | `string` |
| `value`  <br>_required_ | `string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "type": "label",
    "name": "string",
    "value": "string"
}
```

</div>
</div>

**Responses**

=== "204: Attribute set"

    No content.

### Create relation

`PUT /api/notes/{noteId}/relations/{name}/to/{targetNoteId}` · `createRelation`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |
| `name`  <br>_required_ | `string` |
| `targetNoteId`  <br>_required_ | `string` |

**Responses**

=== "204: Relation created"

    No content.

### Delete relation

`DELETE /api/notes/{noteId}/relations/{name}/to/{targetNoteId}` · `deleteRelation`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |
| `name`  <br>_required_ | `string` |
| `targetNoteId`  <br>_required_ | `string` |

**Responses**

=== "204: Relation deleted"

    No content.

### Get attribute name suggestions

`GET /api/attribute-names` · `getAttributeNames`

**Authorization**: `sessionAuth` or `tokenAuth`

**Query parameters**

| Name | Description |
| --- | --- |
| `type`  <br>_required_ | `string`  <br>One of `label`, `relation`. |
| `query` | `string` |

**Responses**

=== "200: Attribute names"

    *   `application/json`: `array of string`

    ```json
    [
        "string"
    ]
    ```

### Get values for attribute

`GET /api/attribute-values/{attributeName}` · `getAttributeValues`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attributeName`  <br>_required_ | `string` |

**Responses**

=== "200: Attribute values"

    *   `application/json`: `array of string`

    ```json
    [
        "string"
    ]
    ```

## <span class="tn-icon bx bx-paperclip"></span> Attachments

File attachments

### Stream file with partial content support

`GET /api/attachments/{attachmentId}/open-partial` · `openPartialFileAttachment`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | `string` |

**Header parameters**

| Name | Description |
| --- | --- |
| `Range` | `string` |

**Responses**

=== "206: Partial content"

    **Response headers**

    | Name | Description |
    | --- | --- |
    | `Content-Range` | `string`  <br>Example: `bytes 0-1023/146515` |

    *   `application/octet-stream`: `string (binary)`

### Get note attachments

`GET /api/notes/{noteId}/attachments` · `getNoteAttachments`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: Note attachments"

    *   `application/json`: array of [`Attachment`](#schema-Attachment)

    ```json
    [
        {
            "attachmentId": "string",
            "ownerId": "string",
            "role": "image",
            "mime": "string",
            "title": "string",
            "blobId": "string",
            "dateModified": "2025-02-14 08:19:59.203+0100",
            "utcDateModified": "2025-02-13 07:42:47.698Z"
        }
    ]
    ```

### Save attachment

`POST /api/notes/{noteId}/attachments` · `saveAttachment`

Saves an attachment of the note, replacing the one that `matchBy` finds or creating one. A save with `blobId` names the blob that the replaced attachment was read at: it is refused with 409, and saves nothing, when that attachment has another blob now. The answer is what the next save is based on. A save without `blobId` is unconditional, and answers 204.

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Query parameters**

| Name | Description |
| --- | --- |
| `matchBy` | `string`  <br>How the attachment to replace is found: by `attachmentId` (the default) or by `title`. One of `attachmentId`, `title`. |

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `attachmentId` | `string` |
| `role`  <br>_required_ | `string` |
| `mime`  <br>_required_ | `string` |
| `title`  <br>_required_ | `string` |
| `content` | `string` |
| `blobId` | `string`  <br>The blob that the replaced attachment was read at |
| `keepOther` | `boolean`  <br>Saves over the attachment that another writer saved, after the note keeps its version as a revision |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "attachmentId": "string",
    "role": "string",
    "mime": "string",
    "title": "string",
    "content": "string",
    "blobId": "string",
    "keepOther": true
}
```

</div>
</div>

**Responses**

=== "200: Attachment saved, by a save with `blobId`"

    *   `application/json`: [`SavedAttachmentBase`](#schema-SavedAttachmentBase)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `attachmentId`  <br>_required_ | `string` |
    | `title`  <br>_required_ | `string` |
    | `blobId`  <br>_required_ | `string` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "attachmentId": "string",
        "title": "string",
        "blobId": "string"
    }
    ```

    </div>
    </div>

=== "204: Attachment saved, by a save without `blobId`"

    No content.

=== "400: A `blobId` that is not a string, or `keepOther` without `blobId`"

    No content.

=== "404: Note not found"

    No content.

=== "409: The replaced attachment has another blob than the save is based on. `attachments` holds that attachment as it is now."

    *   `application/json`: [`SaveConflict`](#schema-SaveConflict)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `reason`  <br>_required_ | `string`  <br>One of `format`, `version`. |
    | `message`  <br>_required_ | `string` |
    | `blobId`  <br>_required_ | `string`  <br>The blob of the note now, which a save that keeps its version names |
    | `type`  <br>_required_ | `string` |
    | `mime`  <br>_required_ | `string` |
    | `isVersioned`  <br>_required_ | `boolean`  <br>Whether the note keeps revisions |
    | `attachments`  <br>_required_ | array of [`SavedAttachmentBase`](#schema-SavedAttachmentBase)  <br>The attachments that the save names, by ID or by title, as the note has them now. A save that keeps its version replaces them at these blobs. |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "reason": "format",
        "message": "string",
        "blobId": "string",
        "type": "string",
        "mime": "string",
        "isVersioned": true,
        "attachments": [
            {
                "attachmentId": "string",
                "title": "string",
                "blobId": "string"
            }
        ]
    }
    ```

    </div>
    </div>

### Upload attachment file

`POST /api/notes/{noteId}/attachments/upload` · `uploadAttachment`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Query parameters**

| Name | Description |
| --- | --- |
| `link` | `boolean`  <br>`true` answers with a link to the attachment instead of an image URL, and stores a picture as uploaded, without compressing it or shortening its name. |

**Request body** (required)

*   `multipart/form-data`: `object`

| Property | Description |
| --- | --- |
| `upload` | `string (binary)` |

**Responses**

=== "201: Attachment uploaded"

    *   `application/json`: [`Attachment`](#schema-Attachment)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `attachmentId`  <br>_required_ | `string` |
    | `ownerId`  <br>_required_ | `string` |
    | `role`  <br>_required_ | `string`  <br>One of `image`, `file`. |
    | `mime`  <br>_required_ | `string` |
    | `title`  <br>_required_ | `string` |
    | `blobId` | `string` |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "attachmentId": "string",
        "ownerId": "string",
        "role": "image",
        "mime": "string",
        "title": "string",
        "blobId": "string",
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

### Get attachment metadata

`GET /api/attachments/{attachmentId}` · `getAttachment`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | `string` |

**Responses**

=== "200: Attachment metadata"

    *   `application/json`: [`Attachment`](#schema-Attachment)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `attachmentId`  <br>_required_ | `string` |
    | `ownerId`  <br>_required_ | `string` |
    | `role`  <br>_required_ | `string`  <br>One of `image`, `file`. |
    | `mime`  <br>_required_ | `string` |
    | `title`  <br>_required_ | `string` |
    | `blobId` | `string` |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "attachmentId": "string",
        "ownerId": "string",
        "role": "image",
        "mime": "string",
        "title": "string",
        "blobId": "string",
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

### Delete attachment

`DELETE /api/attachments/{attachmentId}` · `deleteAttachment`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | `string` |

**Responses**

=== "204: Attachment deleted"

    No content.

### Get attachment content

`GET /api/attachments/{attachmentId}/blob` · `getAttachmentBlob`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | `string` |

**Query parameters**

| Name | Description |
| --- | --- |
| `preview` | `boolean` |

**Responses**

=== "200: Attachment content"

    *   `application/octet-stream`: `string (binary)`

### List the places inside an attachment that a link can point at

`GET /api/attachments/{attachmentId}/references` · `getAttachmentReferences`

The twin of `GET /api/notes/{noteId}/references` for an attachment, such as the headings of a PDF, DOCX or ODT file or the entries of an EPUB e-book's table of contents. The ToC cache of an attachment is kept on its note.

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | `string` |

**Responses**

=== "200: The targets of the attachment"

    *   `application/json`: [`NoteReferences`](#schema-NoteReferences)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `targets`  <br>_required_ | array of [`ReferenceTarget`](#schema-ReferenceTarget) |
    | `blobId` | `string`  <br>The blob of the note that the targets were read from |
    | `pendingToc` | [`PendingToc`](#schema-PendingToc)  <br>A table of contents that the viewer of the document builds |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "targets": [
            {
                "kind": "heading",
                "title": "Installation",
                "level": 2,
                "params": {
                    "block": "eaJkN47U8kI4"
                }
            }
        ],
        "blobId": "string",
        "pendingToc": {
            "format": "pdf"
        }
    }
    ```

    </div>
    </div>

=== "400: A protected attachment without a protected session"

    No content.

=== "404: Attachment not found"

    No content.

### Read the ToC cache of an attachment

`GET /api/attachments/{attachmentId}/toc` · `getAttachmentToc`

The twin of `GET /api/notes/{noteId}/toc` for an attachment.

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | `string` |

**Responses**

=== "200: The cached table of contents"

    *   `application/json`: [`CachedToc`](#schema-CachedToc)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `string`  <br>One of `ready`, `stale`, `missing`, `unreadable`, `unavailable`, `none`. |
    | `blobId` | `string`  <br>For `ready` and `stale`, the blob that the headings were read from |
    | `headings` | array of [`TocHeading`](#schema-TocHeading) |
    | `pendingToc` | [`PendingToc`](#schema-PendingToc)  <br>A table of contents that the viewer of the document builds |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": "ready",
        "blobId": "string",
        "headings": [
            {
                "id": "0k3x9aa1h7q2mz",
                "title": "Installation",
                "level": 1,
                "params": {
                    "page": "4",
                    "heading": "0k3x9aa1h7q2mz"
                }
            }
        ],
        "pendingToc": {
            "format": "pdf"
        }
    }
    ```

    </div>
    </div>

### Save the table of contents that the viewer of an attachment read

`PUT /api/attachments/{attachmentId}/toc` · `saveAttachmentToc`

The twin of `PUT /api/notes/{noteId}/toc` for an attachment.

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | `string` |

**Request body** (required)

*   `application/json`: [`ClientToc`](#schema-ClientToc)

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `targetBlobHash`  <br>_required_ | `string`  <br>The `blobId` of the bytes that the viewer read, from their digest |
| `headings`  <br>_required_ | `array of object`  <br>In document order, without ids: `title` (at most 500 characters), `level` (1 for the first heading, at most one more than the heading before), and the fields of the format |
| `properties` | `object`  <br>The properties of the format, such as `{ "reader": 2 }` |
| `isCut` | `boolean`  <br>Whether the viewer stopped reading at 20,000 headings, before another one. The ids of every heading of a cut table of contents are bound to the blob. |
| `elapsedMs`  <br>_required_ | `number`  <br>How long the viewer took, for the log |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "targetBlobHash": "string",
    "headings": [
        {}
    ],
    "properties": {},
    "isCut": true,
    "elapsedMs": 0
}
```

</div>
</div>

**Responses**

=== "200: The saved cache"

    *   `application/json`: [`CachedToc`](#schema-CachedToc)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `string`  <br>One of `ready`, `stale`, `missing`, `unreadable`, `unavailable`, `none`. |
    | `blobId` | `string`  <br>For `ready` and `stale`, the blob that the headings were read from |
    | `headings` | array of [`TocHeading`](#schema-TocHeading) |
    | `pendingToc` | [`PendingToc`](#schema-PendingToc)  <br>A table of contents that the viewer of the document builds |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": "ready",
        "blobId": "string",
        "headings": [
            {
                "id": "0k3x9aa1h7q2mz",
                "title": "Installation",
                "level": 1,
                "params": {
                    "page": "4",
                    "heading": "0k3x9aa1h7q2mz"
                }
            }
        ],
        "pendingToc": {
            "format": "pdf"
        }
    }
    ```

    </div>
    </div>

=== "400: A malformed table of contents, or one the server does not take"

    No content.

=== "404: Attachment not found"

    No content.

=== "409: The attachment has another blob than the one the viewer read (reason `changed`)"

    No content.

### Build the ToC cache of an attachment

`POST /api/attachments/{attachmentId}/toc/build` · `buildAttachmentToc`

The twin of `POST /api/notes/{noteId}/toc/build` for an attachment.

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | `string` |

**Responses**

=== "200: The table of contents"

    *   `application/json`: [`CachedToc`](#schema-CachedToc)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `string`  <br>One of `ready`, `stale`, `missing`, `unreadable`, `unavailable`, `none`. |
    | `blobId` | `string`  <br>For `ready` and `stale`, the blob that the headings were read from |
    | `headings` | array of [`TocHeading`](#schema-TocHeading) |
    | `pendingToc` | [`PendingToc`](#schema-PendingToc)  <br>A table of contents that the viewer of the document builds |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": "ready",
        "blobId": "string",
        "headings": [
            {
                "id": "0k3x9aa1h7q2mz",
                "title": "Installation",
                "level": 1,
                "params": {
                    "page": "4",
                    "heading": "0k3x9aa1h7q2mz"
                }
            }
        ],
        "pendingToc": {
            "format": "pdf"
        }
    }
    ```

    </div>
    </div>

=== "409: The attachment changed during two builds in a row"

    No content.

### Rename attachment

`PUT /api/attachments/{attachmentId}/rename` · `renameAttachment`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | `string` |

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `title`  <br>_required_ | `string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "title": "string"
}
```

</div>
</div>

**Responses**

=== "204: Attachment renamed"

    No content.

### Convert attachment to note

`POST /api/attachments/{attachmentId}/convert-to-note` · `convertAttachmentToNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | `string` |

**Responses**

=== "200: Attachment converted to note"

    *   `application/json`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId`  <br>_required_ | `string`  <br>12-character note ID |
    | `title`  <br>_required_ | `string`  <br>Note title |
    | `type`  <br>_required_ | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
    | `mime`  <br>_required_ | `string`  <br>MIME type |
    | `isProtected`  <br>_required_ | `boolean`  <br>Whether note is protected |
    | `blobId` | `string`  <br>ID of content blob |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "ur11rSfHkzeV",
        "title": "string",
        "type": "text",
        "mime": "text/html",
        "isProtected": true,
        "blobId": "string",
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateCreated": "2025-02-13 07:42:47.698Z",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

### Update attachment file

`PUT /api/attachments/{attachmentId}/file` · `updateAttachmentFile`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | `string` |

**Request body** (required)

*   `multipart/form-data`: `object`

| Property | Description |
| --- | --- |
| `upload` | `string (binary)` |

**Responses**

=== "200: Attachment file updated"

    *   `application/json`: [`FileUploaded`](#schema-FileUploaded)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `uploaded`  <br>_required_ | `boolean` |
    | `blobId` | `string`  <br>The blob that the upload wrote |
    | `message` | `string`  <br>Why nothing was uploaded |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "uploaded": true,
        "blobId": "string",
        "message": "string"
    }
    ```

    </div>
    </div>

### Open attachment

`GET /api/attachments/{attachmentId}/open` · `openAttachment`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | `string` |

**Query parameters**

| Name | Description |
| --- | --- |
| `blobId` | `string`  <br>The blob that the caller expects. When the content holds another one, the route answers 409 without the content. |

**Responses**

=== "200: Attachment content"

    *   `application/octet-stream`: `string (binary)`

=== "409: The attachment holds another blob than `blobId`"

    No content.

### Download attachment

`GET /api/attachments/download/{attachmentId}` · `downloadAttachment`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | `string` |

**Responses**

=== "200: Attachment content"

    **Response headers**

    | Name | Description |
    | --- | --- |
    | `Content-Disposition` | `string`  <br>Example: `attachment; filename="document.pdf"` |

    *   `application/octet-stream`: `string (binary)`

### Download attachment (alternative path)

`GET /api/attachments/{attachmentId}/download` · `downloadAttachmentAlt`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | `string` |

**Responses**

=== "200: Attachment content"

    **Response headers**

    | Name | Description |
    | --- | --- |
    | `Content-Disposition` | `string`  <br>Example: `attachment; filename="document.pdf"` |

    *   `application/octet-stream`: `string (binary)`

### Get all attachment information

`GET /api/attachments/{attachmentId}/all` · `getAllAttachmentInfo`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | `string` |

**Responses**

=== "200: Attachment information"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `attachmentId` | `string` |
    | `title` | `string` |
    | `mime` | `string` |
    | `isProtected` | `boolean` |
    | `position` | `integer` |
    | `contentLength` | `integer` |
    | `ownerId` | `string` |
    | `dateCreated` | `string (date-time)` |
    | `dateModified` | `string (date-time)` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "attachmentId": "string",
        "title": "string",
        "mime": "string",
        "isProtected": true,
        "position": 0,
        "contentLength": 0,
        "ownerId": "string",
        "dateCreated": "2019-08-24T14:15:22Z",
        "dateModified": "2019-08-24T14:15:22Z"
    }
    ```

    </div>
    </div>

### Save attachment to temporary directory

`POST /api/attachments/{attachmentId}/save-to-tmp-dir` · `saveAttachmentToTmpDir`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | `string` |

**Responses**

=== "200: Attachment saved"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `tmpPath` | `string`  <br>Path to temporary file |
    | `success` | `boolean` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "tmpPath": "string",
        "success": true
    }
    ```

    </div>
    </div>

### Upload modified attachment file

`POST /api/attachments/{attachmentId}/upload-modified-file` · `uploadModifiedAttachmentFile`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | `string` |

**Request body** (required)

*   `multipart/form-data`: `object`

| Property | Description |
| --- | --- |
| `upload` | `string (binary)` |

**Responses**

=== "200: Modified file uploaded"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `success` | `boolean` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "success": true
    }
    ```

    </div>
    </div>

### Get attached image

`GET /api/attachments/{attachmentId}/image/{filename}` · `getAttachmentImage`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | `string` |
| `filename`  <br>_required_ | `string` |

**Responses**

=== "200: Image content"

    *   `image/*`: `string (binary)`

### Erase unused attachments

`POST /api/notes/erase-unused-attachments-now` · `eraseUnusedAttachments`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "204: Unused attachments erased"

    No content.

## <span class="tn-icon bx bx-history"></span> Revisions

Note revision history

### Get note revisions

`GET /api/notes/{noteId}/revisions` · `getNoteRevisions`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: Note revisions"

    *   `application/json`: array of [`Revision`](#schema-Revision)

    ```json
    [
        {
            "revisionId": "string",
            "noteId": "string",
            "title": "string",
            "type": "text",
            "mime": "string",
            "dateCreated": "2025-02-14 08:19:59.203+0100",
            "utcDateCreated": "2025-02-13 07:42:47.698Z"
        }
    ]
    ```

### Erase all note revisions

`DELETE /api/notes/{noteId}/revisions` · `eraseNoteRevisions`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "204: Revisions erased"

    No content.

### Keep unsaved changes as a revision

`POST /api/notes/{noteId}/revisions/draft` · `saveDraftRevision`

Keeps the changes that an editor could not save, after a conflict or a conversion of the note, as a revision in the format they were written in, with their attachment edits written into the copies of the attachments. A draft of an excerpt is put into `fragment.base.note`, the note as its editor read it, not as it is now. Without a `base`, or where that note no longer holds the blocks with the hash `fragment.base.hash`, the revision holds the blocks alone, with the source `fragment`, and cannot be restored. A repeated request with the same `revisionId` makes one revision. A note that keeps no revisions keeps no draft.

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `revisionId`  <br>_required_ | `string`  <br>Drawn by the client once for each draft |
| `type`  <br>_required_ | `string` |
| `mime`  <br>_required_ | `string` |
| `content` | `string`  <br>The content of the whole note; or `fragment` |
| `fragment` | `object`  <br>The edited blocks of an excerpt, and the range they replace |
| `fragment.content`  <br>_required_ | `string` |
| `fragment.block`  <br>_required_ | `string` |
| `fragment.base` | `object`  <br>The note that the blocks were read from |
| `fragment.base.note`  <br>_required_ | `string`  <br>The content of the whole note, as the editor last read or saved it |
| `fragment.base.hash`  <br>_required_ | `string`  <br>The hash of the blocks of the range in `note` |
| `attachments` | array of [`SavedAttachmentRow`](#schema-SavedAttachmentRow) |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "revisionId": "string",
    "type": "string",
    "mime": "string",
    "content": "string",
    "fragment": {
        "content": "string",
        "block": "string",
        "base": {
            "note": "string",
            "hash": "string"
        }
    },
    "attachments": [
        {
            "attachmentId": "string",
            "blobId": "string",
            "role": "string",
            "title": "string",
            "mime": "string",
            "content": "string",
            "position": 0,
            "encoding": "base64"
        }
    ]
}
```

</div>
</div>

**Responses**

=== "200: The revision of the draft"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `revisionId`  <br>_required_ | `string` |
    | `isKept`  <br>_required_ | `boolean`  <br>Whether the note keeps the revision |
    | `isFragment`  <br>_required_ | `boolean`  <br>Whether the revision holds the blocks alone |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "revisionId": "string",
        "isKept": true,
        "isFragment": true
    }
    ```

    </div>
    </div>

=== "400: A malformed draft, a revision ID of another note, or a note whose content is not available"

    No content.

=== "404: Note not found"

    No content.

### Get revision details

`GET /api/revisions/{revisionId}` · `getRevision`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `revisionId`  <br>_required_ | `string` |

**Responses**

=== "200: Revision details"

    *   `application/json`: [`Revision`](#schema-Revision)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `revisionId` | `string` |
    | `noteId` | `string` |
    | `title` | `string` |
    | `type` | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
    | `mime` | `string` |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "revisionId": "string",
        "noteId": "string",
        "title": "string",
        "type": "text",
        "mime": "string",
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "utcDateCreated": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

### Erase revision

`DELETE /api/revisions/{revisionId}` · `eraseRevision`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `revisionId`  <br>_required_ | `string` |

**Responses**

=== "204: Revision erased"

    No content.

### Get revision content

`GET /api/revisions/{revisionId}/blob` · `getRevisionBlob`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `revisionId`  <br>_required_ | `string` |

**Query parameters**

| Name | Description |
| --- | --- |
| `preview` | `boolean` |

**Responses**

=== "200: Revision content"

    *   `text/html`: `string`
    *   `text/plain`: `string`
    *   `application/octet-stream`: `string (binary)`

### Restore revision

`POST /api/revisions/{revisionId}/restore` · `restoreRevision`

Restores the revision as the content of its note, with its attachments, and the links and relations of that content.

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `revisionId`  <br>_required_ | `string` |

**Responses**

=== "204: Revision restored, or there is no revision of that ID"

    No content.

=== "400: A revision of the source `fragment`, which holds blocks of the note alone"

    No content.

### Download revision

`GET /api/revisions/{revisionId}/download` · `downloadRevision`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `revisionId`  <br>_required_ | `string` |

**Responses**

=== "200: Revision content"

    **Response headers**

    | Name | Description |
    | --- | --- |
    | `Content-Disposition` | `string` |

    *   `application/octet-stream`: `string (binary)`

### Cleanup old revisions

`POST /api/revisions/erase-all-excess-revisions` · `eraseExcessRevisions`

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body**

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `snapshotsToKeep` | `integer`  <br>Snapshots to keep per note, standing in for the revisionSnapshotNumberLimit option. -1 keeps every snapshot, 0 keeps none. Omitted, the option applies. A note carrying a valid #versioningLimit follows its own label instead. |
| `keepNamedSnapshots` | `boolean`  <br>Spare named snapshots (those with a description) from erasure and leave them out of the count, so the limit governs the automatic snapshots alone. |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "snapshotsToKeep": 0,
    "keepNamedSnapshots": true
}
```

</div>
</div>

**Responses**

=== "200: Excess revisions erased"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `erasedCount` | `integer` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "erasedCount": 0
    }
    ```

    </div>
    </div>

=== "400: Invalid options"

    No content.

### Get notes edited on date

`GET /api/edited-notes/{date}` · `getEditedNotes`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `date`  <br>_required_ | `string (date)` |

**Responses**

=== "200: Edited notes"

    *   `application/json`: array of [`Note`](#schema-Note)

    ```json
    [
        {
            "noteId": "ur11rSfHkzeV",
            "title": "string",
            "type": "text",
            "mime": "text/html",
            "isProtected": true,
            "blobId": "string",
            "dateCreated": "2025-02-14 08:19:59.203+0100",
            "dateModified": "2025-02-14 08:19:59.203+0100",
            "utcDateCreated": "2025-02-13 07:42:47.698Z",
            "utcDateModified": "2025-02-13 07:42:47.698Z"
        }
    ]
    ```

### Get image from revision

`GET /api/revisions/{revisionId}/image/{filename}` · `getRevisionImage`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `revisionId`  <br>_required_ | `string` |
| `filename`  <br>_required_ | `string` |

**Responses**

=== "200: Image content"

    *   `image/*`: `string (binary)`

## <span class="tn-icon bx bx-search"></span> Search

Search and discovery

### Full text search

`GET /api/search` · `search`

**Authorization**: `sessionAuth` or `tokenAuth`

**Query parameters**

| Name | Description |
| --- | --- |
| `searchString`  <br>_required_ | `string` |

**Responses**

=== "200: Search results"

    *   `application/json`: array of [`SearchResult`](#schema-SearchResult)

    ```json
    [
        {
            "noteId": "string",
            "title": "string",
            "path": "string",
            "score": 0,
            "highlights": [
                "string"
            ]
        }
    ]
    ```

=== "400: Missing or empty search string"

    No content.

### Quick search with highlighting

`GET /api/quick-search` · `quickSearch`

**Authorization**: `sessionAuth` or `tokenAuth`

**Query parameters**

| Name | Description |
| --- | --- |
| `searchString`  <br>_required_ | `string` |

**Responses**

=== "200: Quick search results"

    *   `application/json`: array of [`SearchResult`](#schema-SearchResult)

    ```json
    [
        {
            "noteId": "string",
            "title": "string",
            "path": "string",
            "score": 0,
            "highlights": [
                "string"
            ]
        }
    ]
    ```

=== "400: Missing or empty search string"

    No content.

### Execute search note

`GET /api/search-note/{noteId}` · `executeSearchNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: Search results"

    *   `application/json`: array of [`SearchResult`](#schema-SearchResult)

    ```json
    [
        {
            "noteId": "string",
            "title": "string",
            "path": "string",
            "score": 0,
            "highlights": [
                "string"
            ]
        }
    ]
    ```

### Search and execute actions

`POST /api/search-and-execute-note/{noteId}` · `searchAndExecute`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: Execution results"

    No content.

### Find related notes by attributes

`POST /api/search-related` · `searchRelated`

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `application/json`: [`Attribute`](#schema-Attribute)

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `attributeId`  <br>_required_ | `string` |
| `noteId`  <br>_required_ | `string` |
| `type`  <br>_required_ | `string`  <br>One of `label`, `relation`. |
| `name`  <br>_required_ | `string` |
| `value`  <br>_required_ | `string` |
| `position` | `integer` |
| `isInheritable` | `boolean` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "attributeId": "string",
    "noteId": "string",
    "type": "label",
    "name": "string",
    "value": "string",
    "position": 0,
    "isInheritable": true
}
```

</div>
</div>

**Responses**

=== "200: Related notes"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `count`  <br>_required_ | `integer`  <br>Distinct notes matching, counted before the twenty-result cap. |
    | `results`  <br>_required_ | `array of object`  <br>At most twenty, name-and-value matches ahead of name-only ones. |
    | `results[].notePathArray`  <br>_required_ | `array of string`  <br>Note IDs from the root down to the matched note. |
    | `results[].score`  <br>_required_ | `number`  <br>Search relevance, higher is better. |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "count": 0,
        "results": [
            {
                "notePathArray": [
                    "string"
                ],
                "score": 0
            }
        ]
    }
    ```

    </div>
    </div>

### Search template notes

`GET /api/search-templates` · `searchTemplates`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: Template notes"

    *   `application/json`: array of [`Note`](#schema-Note)

    ```json
    [
        {
            "noteId": "ur11rSfHkzeV",
            "title": "string",
            "type": "text",
            "mime": "text/html",
            "isProtected": true,
            "blobId": "string",
            "dateCreated": "2025-02-14 08:19:59.203+0100",
            "dateModified": "2025-02-14 08:19:59.203+0100",
            "utcDateCreated": "2025-02-13 07:42:47.698Z",
            "utcDateModified": "2025-02-13 07:42:47.698Z"
        }
    ]
    ```

### Get autocomplete suggestions

`GET /api/autocomplete` · `autocomplete`

**Authorization**: `sessionAuth` or `tokenAuth`

**Query parameters**

| Name | Description |
| --- | --- |
| `query`  <br>_required_ | `string` |
| `fastSearch` | `boolean` |
| `activeNoteId` | `string` |

**Responses**

=== "200: Autocomplete suggestions"

    *   `application/json`: `array of object`

    ```json
    [
        {
            "noteId": "_help_gcI7RPbaNSh3",
            "notePath": "root/_hidden/_help/_help_CdNpE2pqjmI6/_help_yIhgI5H7A2Sm/_help_4Gn3psZKsfSm/_help_gcI7RPbaNSh3",
            "noteTitle": "Analog Watch",
            "notePathTitle": "Hidden Notes › User Guide › Scripting › Frontend Basics › Launch Bar Widgets › Analog Watch",
            "highlightedNotePathTitle": "Hidden Notes › User Guide › Scripting › Frontend Basics › Launch Bar Widgets › Analog <b>Wat</b>ch",
            "highlightedNoteTitle": "Analog <b>Wat</b>ch",
            "highlightedParentPathTitle": "Hidden Notes › User Guide › Scripting › Frontend Basics › Launch Bar Widgets",
            "contentSnippet": "This is a more intricate example of a basic widget, which displays an analog watch in the launch bar.",
            "highlightedContentSnippet": "This is a more intricate example of a basic widget, which displays an analog <b>wat</b>ch in the launch bar.",
            "contentSnippetTruncated": true,
            "attributeSnippet": "",
            "matchedTerms": [
                "wat"
            ],
            "icon": "tn-icon bx bx-file"
        }
    ]
    ```

### Find similar notes

`GET /api/similar-notes/{noteId}` · `findSimilarNotes`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: Similar notes"

    *   `application/json`: `array of object`

    ```json
    [
        {
            "noteId": "string",
            "title": "string",
            "similarity": 0
        }
    ]
    ```

## <span class="tn-icon bx bx-transfer"></span> Import/Export

Import and export operations

### Export branch

`GET /api/branches/{branchId}/export/{type}/{format}/{taskId}` · `exportBranch`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `branchId`  <br>_required_ | `string` |
| `type`  <br>_required_ | `string`  <br>One of `subtree`, `single`. |
| `format`  <br>_required_ | `string`  <br>One of `html`, `markdown`, `opml`. |
| `taskId`  <br>_required_ | `string` |

**Responses**

=== "200: Exported content"

    *   `application/octet-stream`: `string (binary)`

### Import notes

`POST /api/notes/{parentNoteId}/notes-import` · `importNotes`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `parentNoteId`  <br>_required_ | `string` |

**Request body** (required)

*   `multipart/form-data`: `object`

| Property | Description |
| --- | --- |
| `upload` | `string (binary)` |
| `safeImport` | `boolean` |
| `shrinkImages` | `boolean` |
| `textImportedAsText` | `boolean` |
| `codeImportedAsCode` | `boolean` |
| `explodeArchives` | `boolean` |
| `replaceUnderscoresWithSpaces` | `boolean` |

**Responses**

=== "200: Import results"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId` | `string` |
    | `note` | [`Note`](#schema-Note) |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "string",
        "note": {
            "noteId": "ur11rSfHkzeV",
            "title": "string",
            "type": "text",
            "mime": "text/html",
            "isProtected": true,
            "blobId": "string",
            "dateCreated": "2025-02-14 08:19:59.203+0100",
            "dateModified": "2025-02-14 08:19:59.203+0100",
            "utcDateCreated": "2025-02-13 07:42:47.698Z",
            "utcDateModified": "2025-02-13 07:42:47.698Z"
        }
    }
    ```

    </div>
    </div>

### Import attachments

`POST /api/notes/{parentNoteId}/attachments-import` · `importAttachments`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `parentNoteId`  <br>_required_ | `string` |

**Request body** (required)

*   `multipart/form-data`: `object`

| Property | Description |
| --- | --- |
| `upload` | `array of string (binary)` |

**Responses**

=== "200: Import results"

    No content.

## <span class="tn-icon bx bx-file"></span> OCR

Text recognition

### Process OCR for a specific note

`POST /api/ocr/process-note/{noteId}` · `ocrProcessNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Request body**

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `language` | `string`  <br>Tesseract language code to use (e.g. 'eng', 'fra', 'deu', 'eng+fra'). If omitted, the language is resolved automatically from the note's language label, the enabled content languages, or the UI locale. |
| `forceReprocess` | `boolean`  <br>Force reprocessing even if OCR already exists |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "language": "string",
    "forceReprocess": false
}
```

</div>
</div>

**Responses**

=== "200: OCR processing completed successfully"

    No content.

=== "400: Bad request - unsupported file type"

    No content.

=== "404: Note not found"

    No content.

=== "500: Internal server error"

    No content.

### Process OCR for a specific attachment

`POST /api/ocr/process-attachment/{attachmentId}` · `ocrProcessAttachment`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | `string`  <br>ID of the attachment to process |

**Request body**

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `language` | `string`  <br>Tesseract language code to use (e.g. 'eng', 'fra', 'deu', 'eng+fra'). If omitted, the language is resolved automatically from the owner note's language label, the enabled content languages, or the UI locale. |
| `forceReprocess` | `boolean`  <br>Force reprocessing even if OCR already exists |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "language": "string",
    "forceReprocess": false
}
```

</div>
</div>

**Responses**

=== "200: OCR processing completed successfully"

    No content.

=== "400: Bad request - unsupported file type"

    No content.

=== "404: Attachment not found"

    No content.

=== "500: Internal server error"

    No content.

### Process OCR for all images without existing OCR results

`POST /api/ocr/batch-process` · `ocrBatchProcess`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: Batch processing initiated successfully"

    No content.

=== "400: Bad request - OCR disabled or already processing"

    No content.

=== "500: Internal server error"

    No content.

### Get batch OCR processing progress

`GET /api/ocr/batch-progress` · `ocrBatchProgress`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: Batch processing progress information"

    No content.

=== "500: Internal server error"

    No content.

## <span class="tn-icon bx bx-sync"></span> Sync

Synchronization between instances

### Test sync connection

`POST /api/sync/test` · `testSync`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: Sync test results"

    No content.

### Trigger sync now

`POST /api/sync/now` · `syncNow`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: Sync started"

    No content.

### Get sync status

`GET /api/sync/check` · `checkSync`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: Sync status"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `synced` | `boolean` |
    | `lastSyncedPush` | `string (date-time)` |
    | `lastSyncedPull` | `string (date-time)` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "synced": true,
        "lastSyncedPush": "2019-08-24T14:15:22Z",
        "lastSyncedPull": "2019-08-24T14:15:22Z"
    }
    ```

    </div>
    </div>

### Get sync changes

`GET /api/sync/changed` · `getSyncChanges`

**Authorization**: `sessionAuth` or `tokenAuth`

**Query parameters**

| Name | Description |
| --- | --- |
| `instanceId`  <br>_required_ | `string` |
| `lastEntityChangeId`  <br>_required_ | `integer` |
| `logMarkerId`  <br>_required_ | `string` |
| `maxBlobContentSize` | `integer`  <br>If set, blob rows whose content exceeds this many bytes are returned with empty content; the entity\_change metadata (including its hash) is unaffected. |

**Responses**

=== "200: Sync changes"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `entityChanges` | array of [`EntityChange`](#schema-EntityChange) |
    | `lastEntityChangeId` | `integer`  <br>If `outstandingPullCount > 0`, pass this as parameter in your next request to continue. |
    | `outstandingPullCount` | `integer`  <br>Number of changes not yet returned by the remote. |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "entityChanges": [
            {
                "entityChange": {
                    "entityName": "string",
                    "changeId": "string"
                },
                "entity": {}
            }
        ],
        "lastEntityChangeId": 0,
        "outstandingPullCount": 0
    }
    ```

    </div>
    </div>

### Push sync changes

`PUT /api/sync/update` · `pushSyncChanges`

Basic usage: set `pageCount = 1`, `pageIndex = 0`, and omit `requestId`. Supply your entity changes in the request body.

**Authorization**: `sessionAuth` or `tokenAuth`

**Query parameters**

| Name | Description |
| --- | --- |
| `logMarkerId`  <br>_required_ | `string` |

**Header parameters**

| Name | Description |
| --- | --- |
| `pageCount`  <br>_required_ | `integer` |
| `pageIndex`  <br>_required_ | `integer` |
| `requestId` | `string` |

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `instanceId` | `string` |
| `entities` | array of [`EntityChange`](#schema-EntityChange) |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "instanceId": "string",
    "entities": [
        {
            "entityChange": {
                "entityName": "string",
                "changeId": "string"
            },
            "entity": {}
        }
    ]
}
```

</div>
</div>

**Responses**

=== "200: Changes processed"

    No content.

### Mark sync as finished

`POST /api/sync/finished` · `finishSync`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "204: Sync finished"

    No content.

### Get sync statistics

`GET /api/sync/stats` · `getSyncStats`

**Authorization**: none

**Responses**

=== "200: Sync statistics"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `initialized` | `boolean` |
    | `stats` | `object` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "initialized": true,
        "stats": {}
    }
    ```

    </div>
    </div>

### Fill entity changes

`POST /api/sync/fill-entity-changes` · `fillEntityChanges`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "204: Entity changes filled"

    No content.

### Force full sync

`POST /api/sync/force-full-sync` · `forceFullSync`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "204: Full sync forced"

    No content.

### Check entity changes consistency

`POST /api/sync/check-entity-changes` · `checkEntityChanges`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: Consistency check results"

    No content.

### Queue sector for sync

`POST /api/sync/queue-sector/{entityName}/{sector}` · `queueSyncSector`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `entityName`  <br>_required_ | `string` |
| `sector`  <br>_required_ | `string` |

**Responses**

=== "204: Sector queued"

    No content.

## <span class="tn-icon bx bx-code-alt"></span> Scripting

Script execution and automation

### Execute script

`POST /api/script/exec` · `executeScript`

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `script`  <br>_required_ | `string` |
| `params` | `array of string` |
| `startNoteId` | `string` |
| `currentNoteId` | `string` |
| `originEntityName` | `string` |
| `originEntityId` | `string` |
| `transactional` | `boolean` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "script": "string",
    "params": [
        "string"
    ],
    "startNoteId": "string",
    "currentNoteId": "string",
    "originEntityName": "string",
    "originEntityId": "string",
    "transactional": true
}
```

</div>
</div>

**Responses**

=== "200: Script execution results"

    *   `application/json`: `object`

    ```json
    {}
    ```

### Run script note

`POST /api/script/run/{noteId}` · `runScriptNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: Script execution results"

    No content.

### Get startup script bundles

`GET /api/script/startup` · `getStartupScripts`

**Authorization**: `sessionAuth` or `tokenAuth`

**Query parameters**

| Name | Description |
| --- | --- |
| `mobile` | `boolean` |

**Responses**

=== "200: Startup scripts"

    *   `application/json`: array of [`ScriptBundle`](#schema-ScriptBundle)

    ```json
    [
        {
            "noteId": "string",
            "script": "string",
            "html": "string",
            "css": "string"
        }
    ]
    ```

### Get widget script bundles

`GET /api/script/widgets` · `getWidgetScripts`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: Widget scripts"

    *   `application/json`: array of [`ScriptBundle`](#schema-ScriptBundle)

    ```json
    [
        {
            "noteId": "string",
            "script": "string",
            "html": "string",
            "css": "string"
        }
    ]
    ```

### Get script bundle for note

`POST /api/script/bundle/{noteId}` · `getScriptBundle`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: Script bundle"

    *   `application/json`: [`ScriptBundle`](#schema-ScriptBundle)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId` | `string` |
    | `script` | `string` |
    | `html` | `string` |
    | `css` | `string` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "string",
        "script": "string",
        "html": "string",
        "css": "string"
    }
    ```

    </div>
    </div>

### Get relation script bundles

`GET /api/script/relation/{noteId}/{relationName}` · `getRelationScripts`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |
| `relationName`  <br>_required_ | `string` |

**Responses**

=== "200: Relation scripts"

    *   `application/json`: array of [`ScriptBundle`](#schema-ScriptBundle)

    ```json
    [
        {
            "noteId": "string",
            "script": "string",
            "html": "string",
            "css": "string"
        }
    ]
    ```

## <span class="tn-icon bx bx-cog"></span> Configuration

System options and settings

### Get application information

`GET /api/app-info` · `getAppInfo`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: Application information"

    *   `application/json`: [`AppInfo`](#schema-AppInfo)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `appVersion` | `string` |
    | `dbVersion` | `integer` |
    | `nodeVersion` | `string` |
    | `syncVersion` | `integer` |
    | `buildDate` | `string (date-time)` |
    | `buildRevision` | `string` |
    | `dataDirectory` | `string` |
    | `clipperProtocolVersion` | `string` |
    | `utcDateTime` | `string (date-time)` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "appVersion": "0.91.6",
        "dbVersion": 228,
        "nodeVersion": "string",
        "syncVersion": 34,
        "buildDate": "2019-08-24T14:15:22Z",
        "buildRevision": "string",
        "dataDirectory": "string",
        "clipperProtocolVersion": "string",
        "utcDateTime": "2019-08-24T14:15:22Z"
    }
    ```

    </div>
    </div>

### Get setup status

`GET /api/setup/status` · `getSetupStatus`

**Authorization**: none

**Responses**

=== "200: Setup status"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `isInitialized` | `boolean` |
    | `schemaExists` | `boolean` |
    | `syncVersion` | `integer` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "isInitialized": true,
        "schemaExists": true,
        "syncVersion": 0
    }
    ```

    </div>
    </div>

### Initialize new document

`POST /api/setup/new-document` · `initNewDocument`

**Authorization**: none

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `password`  <br>_required_ | `string (password)` |
| `theme` | `string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "password": "string",
    "theme": "string"
}
```

</div>
</div>

**Responses**

=== "201: Document initialized"

    No content.

### Setup sync from server

`POST /api/setup/sync-from-server` · `setupSyncFromServer`

**Authorization**: none

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `syncServerHost`  <br>_required_ | `string (uri)` |
| `syncProxy` | `string` |
| `password`  <br>_required_ | `string (password)` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "syncServerHost": "string",
    "syncProxy": "string",
    "password": "string"
}
```

</div>
</div>

**Responses**

=== "200: Sync setup successful"

    No content.

### Get sync seed for setup

`GET /api/setup/sync-seed` · `getSyncSeed`

**Authorization**: none

**Responses**

=== "200: Sync seed information"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `options`  <br>_required_ | `array of object` |
    | `options[].name`  <br>_required_ | `string`  <br>Either `"documentId"` or `"documentSecret"`. |
    | `options[].value`  <br>_required_ | `string` |
    | `syncVersion`  <br>_required_ | `integer` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "options": [
            {
                "name": "string",
                "value": "string"
            }
        ],
        "syncVersion": 0
    }
    ```

    </div>
    </div>

### Get system options

`GET /api/options` · `getOptions`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: System options"

    *   `application/json`: `object`

    ```json
    {}
    ```

### Update multiple options

`PUT /api/options` · `updateOptions`

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `application/json`: `object`

```json
{}
```

**Responses**

=== "204: Options updated"

    No content.

### Update single option

`PUT /api/options/{name}/{value}` · `updateOption`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `name`  <br>_required_ | `string` |
| `value`  <br>_required_ | `string` |

**Responses**

=== "204: Option updated"

    No content.

### Get user-defined themes

`GET /api/options/user-themes` · `getUserThemes`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: User themes"

    *   `application/json`: `array of object`

    ```json
    [
        {
            "name": "string",
            "label": "string"
        }
    ]
    ```

### Get supported locales

`GET /api/options/locales` · `getLocales`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: Supported locales"

    *   `application/json`: `array of object`

    ```json
    [
        {
            "code": "string",
            "name": "string"
        }
    ]
    ```

## <span class="tn-icon bx bx-data"></span> Database

Database operations

### Get database schema

`GET /api/sql/schema` · `getDatabaseSchema`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: Database schema"

    *   `text/plain`: `string`

### Execute SQL from note

`POST /api/sql/execute/{noteId}` · `executeSql`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: SQL execution results"

    *   `application/json`: `array of object`

    ```json
    [
        {}
    ]
    ```

### Create database backup

`POST /api/database/backup-database` · `backupDatabase`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "204: Backup created"

    No content.

### List existing backups

`GET /api/database/backups` · `listBackups`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: Backup list"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `backupFolderPath` | `string \| null`  <br>Directory where the backups are stored, or null if there is no user-accessible location. |
    | `backups` | `array of object` |
    | `backups[].fileName` | `string` |
    | `backups[].filePath` | `string` |
    | `backups[].mtime` | `string (date-time)` |
    | `backups[].fileSize` | `integer`  <br>Size of the backup file, in bytes. |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "backupFolderPath": "string",
        "backups": [
            {
                "fileName": "string",
                "filePath": "string",
                "mtime": "2019-08-24T14:15:22Z",
                "fileSize": 0
            }
        ]
    }
    ```

    </div>
    </div>

### Vacuum database

`POST /api/database/vacuum-database` · `vacuumDatabase`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "204: Database vacuumed"

    No content.

### Anonymize database

`POST /api/database/anonymize/{type}` · `anonymizeDatabase`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `type`  <br>_required_ | `string`  <br>One of `save-as-file`, `save-and-send`. |

**Responses**

=== "200: Anonymization results"

    No content.

### List anonymized databases

`GET /api/database/anonymized-databases` · `listAnonymizedDatabases`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: Anonymized database list"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `anonymizedFolderPath` | `string`  <br>Directory where the anonymized databases are stored. |
    | `databases` | `array of object` |
    | `databases[].fileName` | `string` |
    | `databases[].filePath` | `string` |
    | `databases[].mtime` | `string (date-time)` |
    | `databases[].fileSize` | `integer`  <br>Size of the anonymized database file, in bytes. |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "anonymizedFolderPath": "string",
        "databases": [
            {
                "fileName": "string",
                "filePath": "string",
                "mtime": "2019-08-24T14:15:22Z",
                "fileSize": 0
            }
        ]
    }
    ```

    </div>
    </div>

### Download an anonymized database file

`GET /api/database/anonymized/download` · `downloadAnonymizedDatabase`

Only files inside the anonymized database directory can be downloaded; any other path is refused with 403.

**Authorization**: `sessionAuth` or `tokenAuth`

**Query parameters**

| Name | Description |
| --- | --- |
| `filePath`  <br>_required_ | `string` |

**Responses**

=== "200: Anonymized database file"

    *   `application/x-sqlite3`: `string (binary)`

=== "400: Missing filePath"

    No content.

=== "403: Path not allowed"

    No content.

=== "404: File not found"

    No content.

### Fix consistency issues

`POST /api/database/find-and-fix-consistency-issues` · `fixConsistencyIssues`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: Consistency check results"

    No content.

### Check database integrity

`GET /api/database/check-integrity` · `checkIntegrity`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: Integrity check results"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `results` | `array of string` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "results": [
            "string"
        ]
    }
    ```

    </div>
    </div>

## <span class="tn-icon bx bx-shield-quarter"></span> Security

Security features (2FA, tokens)

### Change password

`POST /api/password/change` · `changePassword`

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `current_password` | `string (password)` |
| `new_password`  <br>_required_ | `string (password)` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "current_password": "string",
    "new_password": "string"
}
```

</div>
</div>

**Responses**

=== "204: Password changed"

    No content.

### Reset password (destructive)

`POST /api/password/reset` · `resetPassword`

**Authorization**: `sessionAuth` or `tokenAuth`

**Query parameters**

| Name | Description |
| --- | --- |
| `really`  <br>_required_ | `string` |

**Responses**

=== "204: Password reset"

    No content.

### Generate a TOTP secret

`GET /api/totp/generate` · `generateTotpSecret`

Generates a fresh TOTP secret without persisting it. The caller must verify a code for this secret (see `/api/totp/verify`) and commit it (see `/api/totp/enable`) before it becomes active.

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: TOTP secret generated"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `success` | `boolean` |
    | `message` | `string`  <br>The bare TOTP secret (for manual entry), or an error message on failure. |
    | `url` | `string`  <br>The `otpauth://` URL the authenticator expects, rendered as a QR code by the client. |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "success": true,
        "message": "string",
        "url": "string"
    }
    ```

    </div>
    </div>

### Verify a generated TOTP secret

`POST /api/totp/verify` · `verifyTotpSecret`

Verifies a freshly generated secret against a code the user produced for it, without persisting anything. On success, issues (unpersisted) recovery codes to be shown as the next enrollment step.

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `secret`  <br>_required_ | `string` |
| `token`  <br>_required_ | `string`  <br>A TOTP code the user generated for the supplied secret. |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "secret": "string",
    "token": "string"
}
```

</div>
</div>

**Responses**

=== "200: Verification result"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `success` | `boolean` |
    | `recoveryCodes` | `array of string`  <br>One-time recovery codes, present only when verification succeeds. |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "success": true,
        "recoveryCodes": [
            "string"
        ]
    }
    ```

    </div>
    </div>

### Enable TOTP with a verified secret

`POST /api/totp/enable` · `enableTotp`

Commits a verified secret together with its recovery codes, activating TOTP. This is the final enrollment step and the only point at which the secret and recovery codes are persisted.

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `secret`  <br>_required_ | `string` |
| `recoveryCodes`  <br>_required_ | `array of string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "secret": "string",
    "recoveryCodes": [
        "string"
    ]
}
```

</div>
</div>

**Responses**

=== "200: Result of enabling TOTP"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `success` | `boolean` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "success": true
    }
    ```

    </div>
    </div>

### Get TOTP status

`GET /api/totp/status` · `getTotpStatus`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: TOTP status"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `success` | `boolean` |
    | `message` | `boolean`  <br>Whether TOTP is the active second factor and a secret is set. |
    | `set` | `boolean`  <br>Whether a TOTP secret is currently stored. |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "success": true,
        "message": true,
        "set": true
    }
    ```

    </div>
    </div>

### Get the stored TOTP secret

`GET /api/totp/get` · `getTotpSecret`

Returns `null` when no secret is set.

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: TOTP secret"

    *   `application/json`: `string | null`

    ```json
    "string"
    ```

### Reset (disable) TOTP

`POST /api/totp/reset` · `resetTotp`

Clears the stored TOTP secret and its recovery codes, disabling TOTP.

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: Result of resetting TOTP"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `success` | `boolean` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "success": true
    }
    ```

    </div>
    </div>

### Check if TOTP recovery codes are set

`GET /api/totp_recovery/enabled` · `isTotpRecoveryEnabled`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: TOTP recovery status"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `success` | `boolean` |
    | `keysExist` | `boolean` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "success": true,
        "keysExist": true
    }
    ```

    </div>
    </div>

### Regenerate TOTP recovery codes

`POST /api/totp_recovery/regenerate` · `regenerateTotpRecoveryCodes`

Issues a fresh batch of recovery codes for the already-enrolled TOTP secret, replacing any existing ones, and returns them for one-time display. Refuses when no TOTP secret is set.

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: Generated recovery codes"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `success` | `boolean` |
    | `recoveryCodes` | `array of string`  <br>New recovery codes, present only when regeneration succeeds. |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "success": true,
        "recoveryCodes": [
            "string"
        ]
    }
    ```

    </div>
    </div>

### Get used TOTP recovery codes

`GET /api/totp_recovery/used` · `getUsedTotpRecoveryCodes`

Returns an empty array if no recovery codes are set, otherwise an object listing each code's status.

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: Recovery code status"

    *   `application/json`: `array of any | object`

    ```json
    [
        null
    ]
    ```

### Verify a TOTP recovery code

`POST /api/totp_recovery/verify` · `verifyTotpRecoveryCode`

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `recovery_code_guess`  <br>_required_ | `string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "recovery_code_guess": "string"
}
```

</div>
</div>

**Responses**

=== "200: Verification result"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `success` | `boolean` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "success": true
    }
    ```

    </div>
    </div>

### List ETAPI tokens

`GET /api/etapi-tokens` · `listEtapiTokens`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: ETAPI tokens"

    *   `application/json`: array of [`EtapiToken`](#schema-EtapiToken)

    ```json
    [
        {
            "etapiTokenId": "string",
            "name": "string",
            "token": "string",
            "dateCreated": "2025-02-14 08:19:59.203+0100",
            "isDeleted": true
        }
    ]
    ```

### Create ETAPI token

`POST /api/etapi-tokens` · `createEtapiToken`

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `name`  <br>_required_ | `string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "name": "string"
}
```

</div>
</div>

**Responses**

=== "201: Token created"

    *   `application/json`: [`EtapiToken`](#schema-EtapiToken)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `etapiTokenId` | `string` |
    | `name` | `string` |
    | `token` | `string` |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `isDeleted` | `boolean` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "etapiTokenId": "string",
        "name": "string",
        "token": "string",
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "isDeleted": true
    }
    ```

    </div>
    </div>

### Delete ETAPI token

`DELETE /api/etapi-tokens/{etapiTokenId}` · `deleteEtapiToken`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `etapiTokenId`  <br>_required_ | `string` |

**Responses**

=== "204: Token deleted"

    No content.

### Update ETAPI token

`PATCH /api/etapi-tokens/{etapiTokenId}` · `updateEtapiToken`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `etapiTokenId`  <br>_required_ | `string` |

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `name` | `string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "name": "string"
}
```

</div>
</div>

**Responses**

=== "200: Token updated"

    *   `application/json`: [`EtapiToken`](#schema-EtapiToken)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `etapiTokenId` | `string` |
    | `name` | `string` |
    | `token` | `string` |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `isDeleted` | `boolean` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "etapiTokenId": "string",
        "name": "string",
        "token": "string",
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "isDeleted": true
    }
    ```

    </div>
    </div>

## <span class="tn-icon bx bx-star"></span> Special Notes

Special note types (calendar, inbox)

### Get/create inbox note

`GET /api/special-notes/inbox/{date}` · `getInboxNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `date`  <br>_required_ | `string (date)` |

**Responses**

=== "200: Inbox note"

    *   `application/json`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId`  <br>_required_ | `string`  <br>12-character note ID |
    | `title`  <br>_required_ | `string`  <br>Note title |
    | `type`  <br>_required_ | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
    | `mime`  <br>_required_ | `string`  <br>MIME type |
    | `isProtected`  <br>_required_ | `boolean`  <br>Whether note is protected |
    | `blobId` | `string`  <br>ID of content blob |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "ur11rSfHkzeV",
        "title": "string",
        "type": "text",
        "mime": "text/html",
        "isProtected": true,
        "blobId": "string",
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateCreated": "2025-02-13 07:42:47.698Z",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

### Resolve where an inbox capture would go

`GET /api/special-notes/inbox-target` · `getInboxTarget`

Reports the destination `/api/special-notes/inbox/{date}` would use, without creating anything. Honours the hoisted note, read from the `trilium-hoisted-note-id` header.

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: The resolved destination"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `kind`  <br>_required_ | `string`  <br>Which rule decided the destination. `dayNote` names no note, because the day note is created when the capture happens. One of `inbox`, `workspaceInbox`, `workspaceRoot`, `dayNote`, `root`. |
    | `noteId` | `string`  <br>Absent for `dayNote`. |
    | `title` | `string`  <br>Absent for `dayNote`. |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "kind": "inbox",
        "noteId": "string",
        "title": "string"
    }
    ```

    </div>
    </div>

### Get/create day note

`GET /api/special-notes/days/{date}` · `getDayNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `date`  <br>_required_ | `string (date)` |

**Responses**

=== "200: Day note"

    *   `application/json`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId`  <br>_required_ | `string`  <br>12-character note ID |
    | `title`  <br>_required_ | `string`  <br>Note title |
    | `type`  <br>_required_ | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
    | `mime`  <br>_required_ | `string`  <br>MIME type |
    | `isProtected`  <br>_required_ | `boolean`  <br>Whether note is protected |
    | `blobId` | `string`  <br>ID of content blob |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "ur11rSfHkzeV",
        "title": "string",
        "type": "text",
        "mime": "text/html",
        "isProtected": true,
        "blobId": "string",
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateCreated": "2025-02-13 07:42:47.698Z",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

### Get/create week note

`GET /api/special-notes/weeks/{week}` · `getWeekNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `week`  <br>_required_ | `string`  <br>Matches `^\d{4}-\d{2}$`. |

**Responses**

=== "200: Week note"

    *   `application/json`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId`  <br>_required_ | `string`  <br>12-character note ID |
    | `title`  <br>_required_ | `string`  <br>Note title |
    | `type`  <br>_required_ | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
    | `mime`  <br>_required_ | `string`  <br>MIME type |
    | `isProtected`  <br>_required_ | `boolean`  <br>Whether note is protected |
    | `blobId` | `string`  <br>ID of content blob |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "ur11rSfHkzeV",
        "title": "string",
        "type": "text",
        "mime": "text/html",
        "isProtected": true,
        "blobId": "string",
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateCreated": "2025-02-13 07:42:47.698Z",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

### Get/create month note

`GET /api/special-notes/months/{month}` · `getMonthNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `month`  <br>_required_ | `string`  <br>Matches `^\d{4}-\d{2}$`. |

**Responses**

=== "200: Month note"

    *   `application/json`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId`  <br>_required_ | `string`  <br>12-character note ID |
    | `title`  <br>_required_ | `string`  <br>Note title |
    | `type`  <br>_required_ | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
    | `mime`  <br>_required_ | `string`  <br>MIME type |
    | `isProtected`  <br>_required_ | `boolean`  <br>Whether note is protected |
    | `blobId` | `string`  <br>ID of content blob |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "ur11rSfHkzeV",
        "title": "string",
        "type": "text",
        "mime": "text/html",
        "isProtected": true,
        "blobId": "string",
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateCreated": "2025-02-13 07:42:47.698Z",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

### Get/create year note

`GET /api/special-notes/years/{year}` · `getYearNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `year`  <br>_required_ | `string`  <br>Matches `^\d{4}$`. |

**Responses**

=== "200: Year note"

    *   `application/json`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId`  <br>_required_ | `string`  <br>12-character note ID |
    | `title`  <br>_required_ | `string`  <br>Note title |
    | `type`  <br>_required_ | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
    | `mime`  <br>_required_ | `string`  <br>MIME type |
    | `isProtected`  <br>_required_ | `boolean`  <br>Whether note is protected |
    | `blobId` | `string`  <br>ID of content blob |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "ur11rSfHkzeV",
        "title": "string",
        "type": "text",
        "mime": "text/html",
        "isProtected": true,
        "blobId": "string",
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateCreated": "2025-02-13 07:42:47.698Z",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

### Create SQL console note

`POST /api/special-notes/sql-console` · `createSqlConsole`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "201: SQL console created"

    *   `application/json`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId`  <br>_required_ | `string`  <br>12-character note ID |
    | `title`  <br>_required_ | `string`  <br>Note title |
    | `type`  <br>_required_ | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
    | `mime`  <br>_required_ | `string`  <br>MIME type |
    | `isProtected`  <br>_required_ | `boolean`  <br>Whether note is protected |
    | `blobId` | `string`  <br>ID of content blob |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "ur11rSfHkzeV",
        "title": "string",
        "type": "text",
        "mime": "text/html",
        "isProtected": true,
        "blobId": "string",
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateCreated": "2025-02-13 07:42:47.698Z",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

### Create search note

`POST /api/special-notes/search-note` · `createSearchNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "201: Search note created"

    *   `application/json`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId`  <br>_required_ | `string`  <br>12-character note ID |
    | `title`  <br>_required_ | `string`  <br>Note title |
    | `type`  <br>_required_ | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
    | `mime`  <br>_required_ | `string`  <br>MIME type |
    | `isProtected`  <br>_required_ | `boolean`  <br>Whether note is protected |
    | `blobId` | `string`  <br>ID of content blob |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "ur11rSfHkzeV",
        "title": "string",
        "type": "text",
        "mime": "text/html",
        "isProtected": true,
        "blobId": "string",
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateCreated": "2025-02-13 07:42:47.698Z",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

### Create launcher

`POST /api/special-notes/launchers/{parentNoteId}/{launcherType}` · `createLauncher`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `parentNoteId`  <br>_required_ | `string` |
| `launcherType`  <br>_required_ | `string` |

**Responses**

=== "201: Launcher created"

    *   `application/json`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId`  <br>_required_ | `string`  <br>12-character note ID |
    | `title`  <br>_required_ | `string`  <br>Note title |
    | `type`  <br>_required_ | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
    | `mime`  <br>_required_ | `string`  <br>MIME type |
    | `isProtected`  <br>_required_ | `boolean`  <br>Whether note is protected |
    | `blobId` | `string`  <br>ID of content blob |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "ur11rSfHkzeV",
        "title": "string",
        "type": "text",
        "mime": "text/html",
        "isProtected": true,
        "blobId": "string",
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateCreated": "2025-02-13 07:42:47.698Z",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

### Get notes for specific month

`GET /api/special-notes/notes-for-month/{month}` · `getNotesForMonth`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `month`  <br>_required_ | `string` |

**Responses**

=== "200: Notes for the month"

    *   `application/json`: array of [`Note`](#schema-Note)

    ```json
    [
        {
            "noteId": "ur11rSfHkzeV",
            "title": "string",
            "type": "text",
            "mime": "text/html",
            "isProtected": true,
            "blobId": "string",
            "dateCreated": "2025-02-14 08:19:59.203+0100",
            "dateModified": "2025-02-14 08:19:59.203+0100",
            "utcDateCreated": "2025-02-13 07:42:47.698Z",
            "utcDateModified": "2025-02-13 07:42:47.698Z"
        }
    ]
    ```

### Get quarter note

`GET /api/special-notes/quarters/{quarter}` · `getQuarter`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `quarter`  <br>_required_ | `string` |

**Responses**

=== "200: Quarter note"

    *   `application/json`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId`  <br>_required_ | `string`  <br>12-character note ID |
    | `title`  <br>_required_ | `string`  <br>Note title |
    | `type`  <br>_required_ | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
    | `mime`  <br>_required_ | `string`  <br>MIME type |
    | `isProtected`  <br>_required_ | `boolean`  <br>Whether note is protected |
    | `blobId` | `string`  <br>ID of content blob |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "ur11rSfHkzeV",
        "title": "string",
        "type": "text",
        "mime": "text/html",
        "isProtected": true,
        "blobId": "string",
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateCreated": "2025-02-13 07:42:47.698Z",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

### Get first day of week for date

`GET /api/special-notes/week-first-day/{date}` · `getWeekFirstDay`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `date`  <br>_required_ | `string (date)` |

**Responses**

=== "200: First day of week"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `date` | `string (date)` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "date": "2019-08-24"
    }
    ```

    </div>
    </div>

### Reset launcher note

`POST /api/special-notes/launchers/{noteId}/reset` · `resetLauncher`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: Launcher reset"

    *   `application/json`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId`  <br>_required_ | `string`  <br>12-character note ID |
    | `title`  <br>_required_ | `string`  <br>Note title |
    | `type`  <br>_required_ | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
    | `mime`  <br>_required_ | `string`  <br>MIME type |
    | `isProtected`  <br>_required_ | `boolean`  <br>Whether note is protected |
    | `blobId` | `string`  <br>ID of content blob |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "ur11rSfHkzeV",
        "title": "string",
        "type": "text",
        "mime": "text/html",
        "isProtected": true,
        "blobId": "string",
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateCreated": "2025-02-13 07:42:47.698Z",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

### Save search note

`POST /api/special-notes/save-search-note` · `saveSearchNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `query` | `string` |
| `title` | `string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "query": "string",
    "title": "string"
}
```

</div>
</div>

**Responses**

=== "201: Search note saved"

    *   `application/json`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId`  <br>_required_ | `string`  <br>12-character note ID |
    | `title`  <br>_required_ | `string`  <br>Note title |
    | `type`  <br>_required_ | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
    | `mime`  <br>_required_ | `string`  <br>MIME type |
    | `isProtected`  <br>_required_ | `boolean`  <br>Whether note is protected |
    | `blobId` | `string`  <br>ID of content blob |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "ur11rSfHkzeV",
        "title": "string",
        "type": "text",
        "mime": "text/html",
        "isProtected": true,
        "blobId": "string",
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateCreated": "2025-02-13 07:42:47.698Z",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

### Save SQL console note

`POST /api/special-notes/save-sql-console` · `saveSqlConsole`

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `sql` | `string` |
| `title` | `string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "sql": "string",
    "title": "string"
}
```

</div>
</div>

**Responses**

=== "201: SQL console saved"

    *   `application/json`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId`  <br>_required_ | `string`  <br>12-character note ID |
    | `title`  <br>_required_ | `string`  <br>Note title |
    | `type`  <br>_required_ | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
    | `mime`  <br>_required_ | `string`  <br>MIME type |
    | `isProtected`  <br>_required_ | `boolean`  <br>Whether note is protected |
    | `blobId` | `string`  <br>ID of content blob |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "ur11rSfHkzeV",
        "title": "string",
        "type": "text",
        "mime": "text/html",
        "isProtected": true,
        "blobId": "string",
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateCreated": "2025-02-13 07:42:47.698Z",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

### Update API script launcher

`PUT /api/special-notes/api-script-launcher` · `updateApiScriptLauncher`

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `code` | `string`  <br>Script code |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "code": "string"
}
```

</div>
</div>

**Responses**

=== "200: API script launcher updated"

    *   `application/json`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId`  <br>_required_ | `string`  <br>12-character note ID |
    | `title`  <br>_required_ | `string`  <br>Note title |
    | `type`  <br>_required_ | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
    | `mime`  <br>_required_ | `string`  <br>MIME type |
    | `isProtected`  <br>_required_ | `boolean`  <br>Whether note is protected |
    | `blobId` | `string`  <br>ID of content blob |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "ur11rSfHkzeV",
        "title": "string",
        "type": "text",
        "mime": "text/html",
        "isProtected": true,
        "blobId": "string",
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateCreated": "2025-02-13 07:42:47.698Z",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

## <span class="tn-icon bx bx-map-alt"></span> Visualization

Maps and visualizations

### Get tree map

`POST /api/note-map/{noteId}/tree` · `getTreeMap`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: Tree map data"

    *   `application/json`: `object`

    ```json
    {}
    ```

### Get link map

`POST /api/note-map/{noteId}/link` · `getLinkMap`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: Link map data"

    *   `application/json`: `object`

    ```json
    {}
    ```

### Get backlinks

`GET /api/note-map/{noteId}/backlinks` · `getBacklinks`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: Backlinks"

    *   `application/json`: `array of object`

    ```json
    [
        {
            "noteId": "string",
            "title": "string"
        }
    ]
    ```

### Get backlink count for note

`GET /api/note-map/{noteId}/backlink-count` · `getBacklinkCount`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: Backlink count"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `count` | `integer`  <br>Number of backlinks to this note |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "count": 0
    }
    ```

    </div>
    </div>

### Get relation map data

`POST /api/relation-map` · `getRelationMap`

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `noteId` | `string` |
| `maxDepth` | `integer` |
| `excludeArchived` | `boolean` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "noteId": "string",
    "maxDepth": 0,
    "excludeArchived": true
}
```

</div>
</div>

**Responses**

=== "200: Relation map data"

    *   `application/json`: `object`

    ```json
    {}
    ```

## <span class="tn-icon bx bx-globe"></span> External

External integrations (clipper, sender)

### Clipper handshake

`GET /api/clipper/handshake` · `clipperHandshake`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: Handshake successful"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `protocolVersion` | `string` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "protocolVersion": "string"
    }
    ```

    </div>
    </div>

### Add web clipping

`POST /api/clipper/clippings` · `addClipping`

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `title` | `string` |
| `content` | `string` |
| `url` | `string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "title": "string",
    "content": "string",
    "url": "string"
}
```

</div>
</div>

**Responses**

=== "201: Clipping created"

    *   `application/json`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId`  <br>_required_ | `string`  <br>12-character note ID |
    | `title`  <br>_required_ | `string`  <br>Note title |
    | `type`  <br>_required_ | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
    | `mime`  <br>_required_ | `string`  <br>MIME type |
    | `isProtected`  <br>_required_ | `boolean`  <br>Whether note is protected |
    | `blobId` | `string`  <br>ID of content blob |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "ur11rSfHkzeV",
        "title": "string",
        "type": "text",
        "mime": "text/html",
        "isProtected": true,
        "blobId": "string",
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateCreated": "2025-02-13 07:42:47.698Z",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

### Create clipper note

`POST /api/clipper/notes` · `createClipperNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `title` | `string` |
| `content` | `string` |
| `parentNoteId` | `string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "title": "string",
    "content": "string",
    "parentNoteId": "string"
}
```

</div>
</div>

**Responses**

=== "201: Note created"

    *   `application/json`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId`  <br>_required_ | `string`  <br>12-character note ID |
    | `title`  <br>_required_ | `string`  <br>Note title |
    | `type`  <br>_required_ | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
    | `mime`  <br>_required_ | `string`  <br>MIME type |
    | `isProtected`  <br>_required_ | `boolean`  <br>Whether note is protected |
    | `blobId` | `string`  <br>ID of content blob |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "ur11rSfHkzeV",
        "title": "string",
        "type": "text",
        "mime": "text/html",
        "isProtected": true,
        "blobId": "string",
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateCreated": "2025-02-13 07:42:47.698Z",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

### Open note in clipper

`POST /api/clipper/open/{noteId}` · `openNoteInClipper`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: Note opened in clipper"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `success` | `boolean` |
    | `url` | `string`  <br>URL to open in clipper |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "success": true,
        "url": "string"
    }
    ```

    </div>
    </div>

### Sender login

`POST /api/sender/login` · `senderLogin`

**Authorization**: none

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `username`  <br>_required_ | `string` |
| `password`  <br>_required_ | `string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "username": "string",
    "password": "string"
}
```

</div>
</div>

**Responses**

=== "200: Login successful"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `token` | `string` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "token": "string"
    }
    ```

    </div>
    </div>

### Upload image from sender

`POST /api/sender/image` · `uploadSenderImage`

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `multipart/form-data`: `object`

| Property | Description |
| --- | --- |
| `upload` | `string (binary)` |

**Responses**

=== "201: Image uploaded"

    *   `application/json`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId`  <br>_required_ | `string`  <br>12-character note ID |
    | `title`  <br>_required_ | `string`  <br>Note title |
    | `type`  <br>_required_ | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
    | `mime`  <br>_required_ | `string`  <br>MIME type |
    | `isProtected`  <br>_required_ | `boolean`  <br>Whether note is protected |
    | `blobId` | `string`  <br>ID of content blob |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "ur11rSfHkzeV",
        "title": "string",
        "type": "text",
        "mime": "text/html",
        "isProtected": true,
        "blobId": "string",
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateCreated": "2025-02-13 07:42:47.698Z",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

### Save note from sender

`POST /api/sender/note` · `saveSenderNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `title` | `string` |
| `content` | `string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "title": "string",
    "content": "string"
}
```

</div>
</div>

**Responses**

=== "201: Note saved"

    *   `application/json`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId`  <br>_required_ | `string`  <br>12-character note ID |
    | `title`  <br>_required_ | `string`  <br>Note title |
    | `type`  <br>_required_ | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
    | `mime`  <br>_required_ | `string`  <br>MIME type |
    | `isProtected`  <br>_required_ | `boolean`  <br>Whether note is protected |
    | `blobId` | `string`  <br>ID of content blob |
    | `dateCreated` | [`DateTime`](#schema-DateTime) |
    | `dateModified` | [`DateTime`](#schema-DateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "ur11rSfHkzeV",
        "title": "string",
        "type": "text",
        "mime": "text/html",
        "isProtected": true,
        "blobId": "string",
        "dateCreated": "2025-02-14 08:19:59.203+0100",
        "dateModified": "2025-02-14 08:19:59.203+0100",
        "utcDateCreated": "2025-02-13 07:42:47.698Z",
        "utcDateModified": "2025-02-13 07:42:47.698Z"
    }
    ```

    </div>
    </div>

## <span class="tn-icon bx bx-wrench"></span> Utilities

Miscellaneous utilities

### Get system metrics

`GET /api/metrics` · `getMetrics`

**Authorization**: `sessionAuth` or `tokenAuth`

**Query parameters**

| Name | Description |
| --- | --- |
| `format` | `string`  <br>Response format - 'prometheus' (default) for Prometheus text format, 'json' for JSON. One of `prometheus`, `json`. |

**Responses**

=== "200: Instance metrics"

    === "`text/plain`: `string`"

    === "`application/json`: `object`"

        <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
        <div class="trilium-multicolumn-column">

        | Property | Description |
        | --- | --- |
        | `version` | `object` |
        | `version.app` | `string` |
        | `version.db` | `integer` |
        | `version.node` | `string` |
        | `version.sync` | `integer` |
        | `version.buildDate` | `string` |
        | `version.buildRevision` | `string` |
        | `database` | `object` |
        | `database.totalNotes` | `integer` |
        | `database.deletedNotes` | `integer` |
        | `database.activeNotes` | `integer` |
        | `database.protectedNotes` | `integer` |
        | `database.totalAttachments` | `integer` |
        | `database.deletedAttachments` | `integer` |
        | `database.activeAttachments` | `integer` |
        | `database.totalRevisions` | `integer` |
        | `database.totalBranches` | `integer` |
        | `database.totalAttributes` | `integer` |
        | `database.totalBlobs` | `integer` |
        | `database.totalEtapiTokens` | `integer` |
        | `database.totalRecentNotes` | `integer` |
        | `noteTypes` | `object` |
        | `attachmentTypes` | `object` |
        | `statistics` | `object` |
        | `statistics.oldestNote` | `string \| null` |
        | `statistics.newestNote` | `string \| null` |
        | `statistics.lastModified` | `string \| null` |
        | `statistics.databaseSizeBytes` | `integer \| null` |
        | `timestamp` | `string` |

        </div>
        <div class="trilium-multicolumn-column">

        ```json
        {
            "version": {
                "app": "0.91.6",
                "db": 231,
                "node": "v18.17.0",
                "sync": 35,
                "buildDate": "2024-09-07T18:36:34Z",
                "buildRevision": "7c0d6930fa8f20d269dcfbcbc8f636a25f6bb9a7"
            },
            "database": {
                "totalNotes": 1234,
                "deletedNotes": 56,
                "activeNotes": 1178,
                "protectedNotes": 23,
                "totalAttachments": 89,
                "deletedAttachments": 5,
                "activeAttachments": 84,
                "totalRevisions": 567,
                "totalBranches": 1200,
                "totalAttributes": 345,
                "totalBlobs": 678,
                "totalEtapiTokens": 3,
                "totalRecentNotes": 50
            },
            "noteTypes": {
                "text": 800,
                "code": 200,
                "image": 100,
                "file": 50
            },
            "attachmentTypes": {
                "image/png": 45,
                "image/jpeg": 30,
                "application/pdf": 14
            },
            "statistics": {
                "oldestNote": "2020-01-01T00:00:00.000Z",
                "newestNote": "2024-12-01T12:00:00.000Z",
                "lastModified": "2024-12-01T11:30:00.000Z",
                "databaseSizeBytes": 52428800
            },
            "timestamp": "2024-12-01T12:00:00.000Z"
        }
        ```

        </div>
        </div>

=== "400: Invalid format parameter"

    No content.

=== "500: Error collecting metrics"

    No content.

### Run system diagnostics

`GET /api/system-checks` · `runSystemChecks`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: System check results"

    *   `application/json`: `array of object`

    ```json
    [
        {
            "name": "string",
            "status": "pass",
            "message": "string"
        }
    ]
    ```

### Health check endpoint

`GET /api/health-check` · `healthCheck`

**Authorization**: none

**Responses**

=== "200: Service is healthy"

    *   `text/plain`: `string`

### Get backend log

`GET /api/backend-log` · `getBackendLog`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: Backend log entries"

    *   `application/json`: `array of object`

    ```json
    [
        {
            "timestamp": "2019-08-24T14:15:22Z",
            "level": "string",
            "message": "string"
        }
    ]
    ```

### Get note size

`GET /api/stats/note-size/{noteId}` · `getNoteSize`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: Note size"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `size` | `integer` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "size": 0
    }
    ```

    </div>
    </div>

### Get subtree size

`GET /api/stats/subtree-size/{noteId}` · `getSubtreeSize`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |

**Responses**

=== "200: Subtree size"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `size` | `integer` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "size": 0
    }
    ```

    </div>
    </div>

### Get keyboard actions

`GET /api/keyboard-actions` · `getKeyboardActions`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: Keyboard actions"

    *   `application/json`: `array of object`

    ```json
    [
        {
            "actionName": "string",
            "shortcut": "string",
            "description": "string"
        }
    ]
    ```

### Get keyboard shortcuts for notes

`GET /api/keyboard-shortcuts-for-notes` · `getKeyboardShortcutsForNotes`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: Keyboard shortcuts for notes"

    *   `application/json`: `array of object`

    ```json
    [
        {
            "noteId": "string",
            "shortcut": "string",
            "title": "string"
        }
    ]
    ```

### Get font CSS

`GET /api/fonts` · `getFonts`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: Font CSS"

    *   `text/css`: `string`

### Add recent note

`POST /api/recent-notes` · `addRecentNote`

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "noteId": "string"
}
```

</div>
</div>

**Responses**

=== "204: Note added to recent"

    No content.

### Get recent changes

`GET /api/recent-changes/{ancestorNoteId}` · `getRecentChanges`

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `ancestorNoteId`  <br>_required_ | `string` |

**Responses**

=== "200: Recent changes"

    *   `application/json`: `array of object`

    ```json
    [
        {
            "noteId": "string",
            "title": "string",
            "dateModified": "2019-08-24T14:15:22Z"
        }
    ]
    ```

### Get recently changed note IDs

`GET /api/recent-changes/{ancestorNoteId}/note-ids` · `getRecentlyChangedNoteIds`

Returns the IDs of the most recently modified live notes under the ancestor, newest first. Under `root`, notes found only in the hidden subtree are left out.

**Authorization**: `sessionAuth` or `tokenAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `ancestorNoteId`  <br>_required_ | `string` |

**Query parameters**

| Name | Description |
| --- | --- |
| `limit`  <br>_required_ | `integer`  <br>The maximum number of note IDs to return. |

**Responses**

=== "200: Note IDs, newest first"

    *   `application/json`: `array of string`

    ```json
    [
        "string"
    ]
    ```

=== "400: Missing or non-positive limit"

    No content.

### Get the glyph of every icon

`GET /api/icon-packs.css` · `getIconPackGlyphCss`

A stylesheet with the `::before` rule that places the character of each icon of each icon pack. The bootstrap data carries the fonts of the packs and links this stylesheet with a `v` parameter derived from its content, so the response can be cached for good. Served without a session, like the bootstrap data that names it on the login screen.

**Authorization**: none

**Query parameters**

| Name | Description |
| --- | --- |
| `v` | `string`  <br>The content version the bootstrap data names; any value returns the current stylesheet |

**Responses**

=== "200: The glyph rules of the icon packs"

    *   `text/css`: `string`

### Get every icon of each icon pack

`GET /api/other/icon-registry` · `getIconRegistry`

Lists the icons that the icon picker searches. The bootstrap data names only the icon packs, since the full list runs to over a megabyte with many packs installed.

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: The icons of each icon pack"

    *   `application/json`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `sources` | `array of object` |
    | `sources[].prefix` | `string` |
    | `sources[].name` | `string` |
    | `sources[].icon` | `string`  <br>An icon class that identifies the pack |
    | `sources[].icons` | `array of object` |
    | `sources[].icons[].id` | `string`  <br>The icon's classes, such as `bx bx-star` |
    | `sources[].icons[].terms` | `array of string` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "sources": [
            {
                "prefix": "string",
                "name": "string",
                "icon": "string",
                "icons": [
                    {
                        "id": "string",
                        "terms": [
                            "string"
                        ]
                    }
                ]
            }
        ]
    }
    ```

    </div>
    </div>

### Get icon usage statistics

`GET /api/other/icon-usage` · `getIconUsage`

**Authorization**: `sessionAuth` or `tokenAuth`

**Responses**

=== "200: Icon usage stats"

    *   `application/json`: `object`

    ```json
    {}
    ```

### Render markdown to HTML

`POST /api/other/render-markdown` · `renderMarkdown`

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `markdownContent`  <br>_required_ | `string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "markdownContent": "string"
}
```

</div>
</div>

**Responses**

=== "200: Rendered HTML"

    *   `text/html`: `string`

### Renders given HTML to Markdown

`POST /api/other/to-markdown` · `toMarkdown`

**Authorization**: `sessionAuth` or `tokenAuth`

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `htmlContent`  <br>_required_ | `string` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "htmlContent": "string"
}
```

</div>
</div>

**Responses**

=== "200: Rendered Markdown"

    *   `text/plain`: `string`

## <span class="tn-icon bx bx-cube"></span> Schemas

### <a id="schema-Note"></a>`Note`

| Property | Description |
| --- | --- |
| `noteId`  <br>_required_ | `string`  <br>12-character note ID |
| `title`  <br>_required_ | `string`  <br>Note title |
| `type`  <br>_required_ | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
| `mime`  <br>_required_ | `string`  <br>MIME type |
| `isProtected`  <br>_required_ | `boolean`  <br>Whether note is protected |
| `blobId` | `string`  <br>ID of content blob |
| `dateCreated` | [`DateTime`](#schema-DateTime) |
| `dateModified` | [`DateTime`](#schema-DateTime) |
| `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |
| `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

### <a id="schema-NoteType"></a>`NoteType`

Type: `string`

One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`.

### <a id="schema-Blob"></a>`Blob`

| Property | Description |
| --- | --- |
| `blobId` | `string` |
| `content` | `string \| null`  <br>`null` if not text. |
| `contentLength` | `integer` |
| `dateModified` | [`DateTime`](#schema-DateTime) |
| `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

### <a id="schema-Branch"></a>`Branch`

| Property | Description |
| --- | --- |
| `branchId`  <br>_required_ | `string`  <br>Branch ID (parentNoteId\_noteId) |
| `noteId`  <br>_required_ | `string` |
| `parentNoteId`  <br>_required_ | `string` |
| `notePosition`  <br>_required_ | `integer` |
| `prefix` | `string \| null` |
| `isExpanded` | `boolean` |

### <a id="schema-Attribute"></a>`Attribute`

| Property | Description |
| --- | --- |
| `attributeId`  <br>_required_ | `string` |
| `noteId`  <br>_required_ | `string` |
| `type`  <br>_required_ | `string`  <br>One of `label`, `relation`. |
| `name`  <br>_required_ | `string` |
| `value`  <br>_required_ | `string` |
| `position` | `integer` |
| `isInheritable` | `boolean` |

### <a id="schema-Attachment"></a>`Attachment`

| Property | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | `string` |
| `ownerId`  <br>_required_ | `string` |
| `role`  <br>_required_ | `string`  <br>One of `image`, `file`. |
| `mime`  <br>_required_ | `string` |
| `title`  <br>_required_ | `string` |
| `blobId` | `string` |
| `dateModified` | [`DateTime`](#schema-DateTime) |
| `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

### <a id="schema-Revision"></a>`Revision`

| Property | Description |
| --- | --- |
| `revisionId` | `string` |
| `noteId` | `string` |
| `title` | `string` |
| `type` | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
| `mime` | `string` |
| `dateCreated` | [`DateTime`](#schema-DateTime) |
| `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

### <a id="schema-SearchResult"></a>`SearchResult`

| Property | Description |
| --- | --- |
| `noteId` | `string` |
| `title` | `string` |
| `path` | `string` |
| `score` | `number` |
| `highlights` | `array of string` |

### <a id="schema-EntityChange"></a>`EntityChange`

| Property | Description |
| --- | --- |
| `entityChange` | `object` |
| `entityChange.entityName` | `string` |
| `entityChange.changeId` | `string` |
| `entity` | `object` |

### <a id="schema-DateTime"></a>`DateTime`

Type: `string`

Example: `2025-02-14 08:19:59.203+0100`

### <a id="schema-UtcDateTime"></a>`UtcDateTime`

Result of `new Date().toISOString().replace('T', ' ')`

Type: `string`

Example: `2025-02-13 07:42:47.698Z`

### <a id="schema-Timestamps"></a>`Timestamps`

| Property | Description |
| --- | --- |
| `dateCreated` | [`DateTime`](#schema-DateTime) |
| `dateModified` | [`DateTime`](#schema-DateTime) |
| `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |
| `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Result of `new Date().toISOString().replace('T', ' ')` |

### <a id="schema-ReferenceKind"></a>`ReferenceKind`

The kind of a target, which sets how the link lists show it

Type: `string`

One of `heading`, `anchor`.

Example: `heading`

### <a id="schema-ReferenceParams"></a>`ReferenceParams`

The parameters of a link that point at a target, not encoded

Type: `object`

Example: `[object Object]`

### <a id="schema-ReferenceTarget"></a>`ReferenceTarget`

| Property | Description |
| --- | --- |
| `kind`  <br>_required_ | [`ReferenceKind`](#schema-ReferenceKind)  <br>The kind of a target, which sets how the link lists show it. One of `heading`, `anchor`. |
| `title`  <br>_required_ | `string`  <br>The plain text that the lists show |
| `level` | `integer`  <br>For a kind that nests, the depth of the target, such as 2 for an `<h2>` |
| `params` | [`ReferenceParams`](#schema-ReferenceParams)  <br>The link parameters that point at the target; absent while it needs a reference |

### <a id="schema-NoteReferences"></a>`NoteReferences`

| Property | Description |
| --- | --- |
| `targets`  <br>_required_ | array of [`ReferenceTarget`](#schema-ReferenceTarget) |
| `blobId` | `string`  <br>The blob of the note that the targets were read from |
| `pendingToc` | [`PendingToc`](#schema-PendingToc)  <br>A table of contents that the viewer of the document builds |

### <a id="schema-PendingToc"></a>`PendingToc`

A table of contents that the viewer of the document builds

| Property | Description |
| --- | --- |
| `format`  <br>_required_ | `string` |

### <a id="schema-TocHeading"></a>`TocHeading`

A heading of a table of contents, with the fields of its format, such as `page`

| Property | Description |
| --- | --- |
| `id`  <br>_required_ | `string`  <br>Names the heading in its document, for the `heading` link parameter |
| `title`  <br>_required_ | `string`  <br>Plain text, never HTML |
| `level`  <br>_required_ | `integer` |
| `params` | `object`  <br>The parameters of a link to the heading; absent when no link can reach it |

### <a id="schema-CachedToc"></a>`CachedToc`

| Property | Description |
| --- | --- |
| `status`  <br>_required_ | `string`  <br>One of `ready`, `stale`, `missing`, `unreadable`, `unavailable`, `none`. |
| `blobId` | `string`  <br>For `ready` and `stale`, the blob that the headings were read from |
| `headings` | array of [`TocHeading`](#schema-TocHeading) |
| `pendingToc` | [`PendingToc`](#schema-PendingToc)  <br>A table of contents that the viewer of the document builds |

### <a id="schema-ClientToc"></a>`ClientToc`

| Property | Description |
| --- | --- |
| `targetBlobHash`  <br>_required_ | `string`  <br>The `blobId` of the bytes that the viewer read, from their digest |
| `headings`  <br>_required_ | `array of object`  <br>In document order, without ids: `title` (at most 500 characters), `level` (1 for the first heading, at most one more than the heading before), and the fields of the format |
| `properties` | `object`  <br>The properties of the format, such as `{ "reader": 2 }` |
| `isCut` | `boolean`  <br>Whether the viewer stopped reading at 20,000 headings, before another one. The ids of every heading of a cut table of contents are bound to the blob. |
| `elapsedMs`  <br>_required_ | `number`  <br>How long the viewer took, for the log |

### <a id="schema-FileUploaded"></a>`FileUploaded`

| Property | Description |
| --- | --- |
| `uploaded`  <br>_required_ | `boolean` |
| `blobId` | `string`  <br>The blob that the upload wrote |
| `message` | `string`  <br>Why nothing was uploaded |

### <a id="schema-NoteSaveBase"></a>`NoteSaveBase`

What a save of the content of a note is based on

| Property | Description |
| --- | --- |
| `blobId`  <br>_required_ | `string` |
| `type`  <br>_required_ | `string` |
| `mime`  <br>_required_ | `string` |

### <a id="schema-SavedAttachmentRow"></a>`SavedAttachmentRow`

An attachment that a save writes. With `attachmentId` it replaces that attachment, in a save with a base only while it is at `blobId`; without it, it creates one of its title.

| Property | Description |
| --- | --- |
| `attachmentId` | `string` |
| `blobId` | `string`  <br>The blob that the attachment was read at |
| `role`  <br>_required_ | `string` |
| `title`  <br>_required_ | `string` |
| `mime`  <br>_required_ | `string` |
| `content`  <br>_required_ | `string` |
| `position` | `integer` |
| `encoding` | `string`  <br>One of `base64`. |

### <a id="schema-SavedAttachmentBase"></a>`SavedAttachmentBase`

An attachment as a save left it

| Property | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | `string` |
| `title`  <br>_required_ | `string` |
| `blobId`  <br>_required_ | `string` |

### <a id="schema-SaveConflict"></a>`SaveConflict`

Why a save of a note or an attachment was refused: the note now has another format, after a conversion, or another version than the one the save is based on

| Property | Description |
| --- | --- |
| `reason`  <br>_required_ | `string`  <br>One of `format`, `version`. |
| `message`  <br>_required_ | `string` |
| `blobId`  <br>_required_ | `string`  <br>The blob of the note now, which a save that keeps its version names |
| `type`  <br>_required_ | `string` |
| `mime`  <br>_required_ | `string` |
| `isVersioned`  <br>_required_ | `boolean`  <br>Whether the note keeps revisions |
| `attachments`  <br>_required_ | array of [`SavedAttachmentBase`](#schema-SavedAttachmentBase)  <br>The attachments that the save names, by ID or by title, as the note has them now. A save that keeps its version replaces them at these blobs. |

### <a id="schema-BlocksVersionConflict"></a>`BlocksVersionConflict`

The blocks, or an attachment that the save replaces, changed since they were read

| Property | Description |
| --- | --- |
| `reason`  <br>_required_ | `string`  <br>One of `version`. |
| `message`  <br>_required_ | `string` |
| `hash`  <br>_required_ | `string`  <br>The hash of the blocks now, which a save that keeps its version names |
| `attachments`  <br>_required_ | array of [`SavedAttachmentBase`](#schema-SavedAttachmentBase)  <br>As `attachments` of `SaveConflict` |
| `isVersioned`  <br>_required_ | `boolean`  <br>Whether the note keeps revisions |

### <a id="schema-BlocksGoneConflict"></a>`BlocksGoneConflict`

The blocks can no longer be saved apart: the note was converted (`format`), or the `block` parameter no longer points at blocks that can be edited apart (`range`)

| Property | Description |
| --- | --- |
| `reason`  <br>_required_ | `string`  <br>One of `format`, `range`. |
| `message`  <br>_required_ | `string` |

### <a id="schema-CreateNoteRequest"></a>`CreateNoteRequest`

| Property | Description |
| --- | --- |
| `title`  <br>_required_ | `string` |
| `content` | `string` |
| `type`  <br>_required_ | [`NoteType`](#schema-NoteType)  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `canvas`, `webView`, `launcher`, `doc`, `contentWidget`, `mindMap`, `geoMap`. |
| `mime` | `string` |
| `isProtected` | `boolean` |
| `isExpanded` | `boolean` |
| `notePosition` | `integer` |
| `prefix` | `string` |
| `parentNoteId` | `string` |
| `templateNoteId` | `string` |

### <a id="schema-ScriptBundle"></a>`ScriptBundle`

| Property | Description |
| --- | --- |
| `noteId` | `string` |
| `script` | `string` |
| `html` | `string` |
| `css` | `string` |

### <a id="schema-AppInfo"></a>`AppInfo`

| Property | Description |
| --- | --- |
| `appVersion` | `string` |
| `dbVersion` | `integer` |
| `nodeVersion` | `string` |
| `syncVersion` | `integer` |
| `buildDate` | `string (date-time)` |
| `buildRevision` | `string` |
| `dataDirectory` | `string` |
| `clipperProtocolVersion` | `string` |
| `utcDateTime` | `string (date-time)` |

### <a id="schema-EtapiToken"></a>`EtapiToken`

| Property | Description |
| --- | --- |
| `etapiTokenId` | `string` |
| `name` | `string` |
| `token` | `string` |
| `dateCreated` | [`DateTime`](#schema-DateTime) |
| `isDeleted` | `boolean` |