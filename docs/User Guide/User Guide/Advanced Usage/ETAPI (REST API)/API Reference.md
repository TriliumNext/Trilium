# API Reference
External Trilium API

## <span class="tn-icon bx bx-lock-alt"></span> Authentication

### `EtapiTokenAuth`

API key in the `Authorization` header.

### `EtapiBasicAuth`

HTTP `basic` authentication.

Basic Auth where username is arbitrary string (e.g. "trilium", not checked), username is the ETAPI token. To emphasize, do not use Trilium password here (won't work), only the generated ETAPI token (from Options -> ETAPI)

## <span class="tn-icon bx bx-note"></span> Notes

Notes and their content, and the import and export of whole subtrees.

### Create a note

`POST /create-note` · `createNote`

Create a note and place it into the note tree

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Request body** (required)

*   `application/json`: [`CreateNoteDef`](#schema-CreateNoteDef)

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `parentNoteId`  <br>_required_ | [`EntityId`](#schema-EntityId)  <br>Note ID of the parent note in the tree |
| `title`  <br>_required_ | `string` |
| `type`  <br>_required_ | `string`  <br>One of `text`, `code`, `file`, `image`, `search`, `book`, `relationMap`, `render`. |
| `mime` | `string`  <br>this needs to be specified only for note types 'code', 'file', 'image'. |
| `content`  <br>_required_ | `string` |
| `notePosition` | `integer`  <br>Position of the note in the parent. Normal ordering is 10, 20, 30 ... So if you want to create a note on the first position, use e.g. 5, for second position 15, for last e.g. 1000000 |
| `prefix` | `string`  <br>Prefix is branch (placement) specific title prefix for the note. Let's say you have your note placed into two different places in the tree, but you want to change the title a bit in one of the placements. For this you can use prefix. |
| `isExpanded` | `boolean`  <br>true if this note (as a folder) should appear expanded |
| `noteId` | [`EntityId`](#schema-EntityId)  <br>DON'T specify unless you want to force a specific noteId |
| `branchId` | [`EntityId`](#schema-EntityId)  <br>DON'T specify unless you want to force a specific branchId |
| `dateCreated` | [`LocalDateTime`](#schema-LocalDateTime)  <br>Local timestap of the note creation. Specify only if you want to override the default (current datetime in the current timezone/offset). |
| `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>UTC timestap of the note creation. Specify only if you want to override the default (current datetime). |
| `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>UTC timestamp of the note's last modification, e.g. to keep the date of a note being migrated from another application. The local dateModified is derived from it. Specify only if you want to override the default (current datetime). |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "parentNoteId": "evnnmvHTCgIn",
    "title": "string",
    "type": "text",
    "mime": "application/json",
    "content": "string",
    "notePosition": 0,
    "prefix": "string",
    "isExpanded": true,
    "noteId": "evnnmvHTCgIn",
    "branchId": "evnnmvHTCgIn",
    "dateCreated": "2021-12-31 20:18:11.930+0100",
    "utcDateCreated": "2021-12-31 19:18:11.930Z",
    "utcDateModified": "2021-12-31 19:18:11.930Z"
}
```

</div>
</div>

**Responses**

=== "201: note created"

    *   `application/json; charset=utf-8`: [`NoteWithBranch`](#schema-NoteWithBranch)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `note` | [`Note`](#schema-Note) |
    | `branch` | [`Branch`](#schema-Branch)  <br>Branch places the note into the tree, it represents the relationship between a parent note and child note |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "note": {
            "noteId": "evnnmvHTCgIn",
            "title": "string",
            "type": "text",
            "mime": "string",
            "isProtected": true,
            "blobId": "string",
            "attributes": [
                {
                    "attributeId": "evnnmvHTCgIn",
                    "noteId": "evnnmvHTCgIn",
                    "type": "label",
                    "name": "shareCss",
                    "value": "string",
                    "position": 0,
                    "isInheritable": true,
                    "utcDateModified": "2021-12-31 19:18:11.930Z"
                }
            ],
            "parentNoteIds": [
                "evnnmvHTCgIn"
            ],
            "childNoteIds": [
                "evnnmvHTCgIn"
            ],
            "parentBranchIds": [
                "evnnmvHTCgIn"
            ],
            "childBranchIds": [
                "evnnmvHTCgIn"
            ],
            "dateCreated": "2021-12-31 20:18:11.930+0100",
            "dateModified": "2021-12-31 20:18:11.930+0100",
            "utcDateCreated": "2021-12-31 19:18:11.930Z",
            "utcDateModified": "2021-12-31 19:18:11.930Z"
        },
        "branch": {
            "branchId": "evnnmvHTCgIn",
            "noteId": "evnnmvHTCgIn",
            "parentNoteId": "evnnmvHTCgIn",
            "prefix": "string",
            "notePosition": 0,
            "isExpanded": true,
            "utcDateModified": "2021-12-31 19:18:11.930Z"
        }
    }
    ```

    </div>
    </div>

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Search notes

`GET /notes` · `searchNotes`

Search notes

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Query parameters**

| Name | Description |
| --- | --- |
| `search`  <br>_required_ | `string`  <br>search query string as described in [https://triliumnext.github.io/Docs/Wiki/search.html](https://triliumnext.github.io/Docs/Wiki/search.html) |
| `fastSearch` | `boolean`  <br>enable fast search (fulltext doesn't look into content) |
| `includeArchivedNotes` | `boolean`  <br>search by default ignores archived notes. Set to 'true' to includes archived notes into search results. |
| `ancestorNoteId` | [`EntityId`](#schema-EntityId)  <br>search only in a subtree identified by the subtree noteId. By default whole tree is searched. |
| `ancestorDepth` | `string`  <br>define how deep in the tree should the notes be searched |
| `orderBy` | `string`  <br>name of the property/label to order search results by |
| `orderDirection` | `string`  <br>order direction, ascending or descending. One of `asc`, `desc`. |
| `limit` | `integer`  <br>limit the number of results you want to receive |
| `debug` | `boolean`  <br>set to true to get debug information in the response (search query parsing) |

**Responses**

=== "200: search response"

    *   `application/json; charset=utf-8`: [`SearchResponse`](#schema-SearchResponse)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `results`  <br>_required_ | array of [`Note`](#schema-Note) |
    | `debugInfo` | `object`  <br>debugging info on parsing the search query enabled with &debug=true parameter |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "results": [
            {
                "noteId": "evnnmvHTCgIn",
                "title": "string",
                "type": "text",
                "mime": "string",
                "isProtected": true,
                "blobId": "string",
                "attributes": [
                    {
                        "attributeId": "evnnmvHTCgIn",
                        "noteId": "evnnmvHTCgIn",
                        "type": "label",
                        "name": "shareCss",
                        "value": "string",
                        "position": 0,
                        "isInheritable": true,
                        "utcDateModified": "2021-12-31 19:18:11.930Z"
                    }
                ],
                "parentNoteIds": [
                    "evnnmvHTCgIn"
                ],
                "childNoteIds": [
                    "evnnmvHTCgIn"
                ],
                "parentBranchIds": [
                    "evnnmvHTCgIn"
                ],
                "childBranchIds": [
                    "evnnmvHTCgIn"
                ],
                "dateCreated": "2021-12-31 20:18:11.930+0100",
                "dateModified": "2021-12-31 20:18:11.930+0100",
                "utcDateCreated": "2021-12-31 19:18:11.930Z",
                "utcDateModified": "2021-12-31 19:18:11.930Z"
            }
        ],
        "debugInfo": {}
    }
    ```

    </div>
    </div>

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Get a note

`GET /notes/{noteId}` · `getNoteById`

Returns a note identified by its ID

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Responses**

=== "200: note response"

    *   `application/json; charset=utf-8`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId` | [`EntityId`](#schema-EntityId) |
    | `title` | `string`  <br>Title of the note. Returned as "\[protected\]" for protected notes, since ETAPI cannot open a protected session. |
    | `type` | `string`  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `webView`, `shortcut`, `doc`, `contentWidget`, `launcher`. |
    | `mime` | `string` |
    | `isProtected` | `boolean` |
    | `blobId` | `string`  <br>ID of the blob object which effectively serves as a content hash |
    | `attributes` | [`AttributeList`](#schema-AttributeList) |
    | `parentNoteIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `childNoteIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `parentBranchIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `childBranchIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `dateCreated` | [`LocalDateTime`](#schema-LocalDateTime) |
    | `dateModified` | [`LocalDateTime`](#schema-LocalDateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime) |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Writable through PATCH, e.g. to restore a migrated note's date after its content was rewritten. The local dateModified is derived from it. |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "evnnmvHTCgIn",
        "title": "string",
        "type": "text",
        "mime": "string",
        "isProtected": true,
        "blobId": "string",
        "attributes": [
            {
                "attributeId": "evnnmvHTCgIn",
                "noteId": "evnnmvHTCgIn",
                "type": "label",
                "name": "shareCss",
                "value": "string",
                "position": 0,
                "isInheritable": true,
                "utcDateModified": "2021-12-31 19:18:11.930Z"
            }
        ],
        "parentNoteIds": [
            "evnnmvHTCgIn"
        ],
        "childNoteIds": [
            "evnnmvHTCgIn"
        ],
        "parentBranchIds": [
            "evnnmvHTCgIn"
        ],
        "childBranchIds": [
            "evnnmvHTCgIn"
        ],
        "dateCreated": "2021-12-31 20:18:11.930+0100",
        "dateModified": "2021-12-31 20:18:11.930+0100",
        "utcDateCreated": "2021-12-31 19:18:11.930Z",
        "utcDateModified": "2021-12-31 19:18:11.930Z"
    }
    ```

    </div>
    </div>

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Delete a note

`DELETE /notes/{noteId}` · `deleteNoteById`

deletes a single note based on the noteId supplied

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Responses**

=== "204: note deleted"

    No content.

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Update a note

`PATCH /notes/{noteId}` · `patchNoteById`

patch a note identified by the noteId with changes in the body

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Request body** (required)

*   `application/json`: [`Note`](#schema-Note)

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `noteId` | [`EntityId`](#schema-EntityId) |
| `title` | `string`  <br>Title of the note. Returned as "\[protected\]" for protected notes, since ETAPI cannot open a protected session. |
| `type` | `string`  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `webView`, `shortcut`, `doc`, `contentWidget`, `launcher`. |
| `mime` | `string` |
| `isProtected` | `boolean` |
| `blobId` | `string`  <br>ID of the blob object which effectively serves as a content hash |
| `attributes` | [`AttributeList`](#schema-AttributeList) |
| `parentNoteIds` | [`EntityIdList`](#schema-EntityIdList) |
| `childNoteIds` | [`EntityIdList`](#schema-EntityIdList) |
| `parentBranchIds` | [`EntityIdList`](#schema-EntityIdList) |
| `childBranchIds` | [`EntityIdList`](#schema-EntityIdList) |
| `dateCreated` | [`LocalDateTime`](#schema-LocalDateTime) |
| `dateModified` | [`LocalDateTime`](#schema-LocalDateTime) |
| `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime) |
| `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Writable through PATCH, e.g. to restore a migrated note's date after its content was rewritten. The local dateModified is derived from it. |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "title": "string",
    "type": "text",
    "mime": "string",
    "blobId": "string",
    "dateCreated": "2021-12-31 20:18:11.930+0100",
    "utcDateCreated": "2021-12-31 19:18:11.930Z",
    "utcDateModified": "2021-12-31 19:18:11.930Z"
}
```

</div>
</div>

**Responses**

=== "200: note updated"

    *   `application/json; charset=utf-8`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId` | [`EntityId`](#schema-EntityId) |
    | `title` | `string`  <br>Title of the note. Returned as "\[protected\]" for protected notes, since ETAPI cannot open a protected session. |
    | `type` | `string`  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `webView`, `shortcut`, `doc`, `contentWidget`, `launcher`. |
    | `mime` | `string` |
    | `isProtected` | `boolean` |
    | `blobId` | `string`  <br>ID of the blob object which effectively serves as a content hash |
    | `attributes` | [`AttributeList`](#schema-AttributeList) |
    | `parentNoteIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `childNoteIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `parentBranchIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `childBranchIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `dateCreated` | [`LocalDateTime`](#schema-LocalDateTime) |
    | `dateModified` | [`LocalDateTime`](#schema-LocalDateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime) |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Writable through PATCH, e.g. to restore a migrated note's date after its content was rewritten. The local dateModified is derived from it. |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "evnnmvHTCgIn",
        "title": "string",
        "type": "text",
        "mime": "string",
        "isProtected": true,
        "blobId": "string",
        "attributes": [
            {
                "attributeId": "evnnmvHTCgIn",
                "noteId": "evnnmvHTCgIn",
                "type": "label",
                "name": "shareCss",
                "value": "string",
                "position": 0,
                "isInheritable": true,
                "utcDateModified": "2021-12-31 19:18:11.930Z"
            }
        ],
        "parentNoteIds": [
            "evnnmvHTCgIn"
        ],
        "childNoteIds": [
            "evnnmvHTCgIn"
        ],
        "parentBranchIds": [
            "evnnmvHTCgIn"
        ],
        "childBranchIds": [
            "evnnmvHTCgIn"
        ],
        "dateCreated": "2021-12-31 20:18:11.930+0100",
        "dateModified": "2021-12-31 20:18:11.930+0100",
        "utcDateCreated": "2021-12-31 19:18:11.930Z",
        "utcDateModified": "2021-12-31 19:18:11.930Z"
    }
    ```

    </div>
    </div>

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Get the content of a note

`GET /notes/{noteId}/content` · `getNoteContent`

Returns note content identified by its ID. The response carries the note's MIME type as its `Content-Type`.

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Responses**

=== "200: note content"

    *   `*/*`: `string (binary)`

### Replace the content of a note

`PUT /notes/{noteId}/content` · `putNoteContentById`

Updates note content identified by its ID

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Request body** (required)

New content of the note. Send text (such as the HTML of a text note) as `text/plain` and binary data (such as the file of an image or file note) as `application/octet-stream`; other content types are not accepted.

*   `text/plain`: `string`
*   `application/octet-stream`: `string (binary)`

**Responses**

=== "204: note content updated"

    No content.

### Export a subtree

`GET /notes/{noteId}/export` · `exportNoteSubtree`

Exports ZIP file export of a given note subtree. To export whole document, use "root" for noteId

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Query parameters**

| Name | Description |
| --- | --- |
| `format` | `any`  <br>One of `html`, `markdown`, `share`. |

**Responses**

=== "200: export ZIP file"

    *   `application/zip`: `string (binary)`

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Import a ZIP archive

`POST /notes/{noteId}/import` · `importZip`

Imports ZIP file into a given note.

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Responses**

=== "201: note created"

    *   `application/json; charset=utf-8`: [`NoteWithBranch`](#schema-NoteWithBranch)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `note` | [`Note`](#schema-Note) |
    | `branch` | [`Branch`](#schema-Branch)  <br>Branch places the note into the tree, it represents the relationship between a parent note and child note |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "note": {
            "noteId": "evnnmvHTCgIn",
            "title": "string",
            "type": "text",
            "mime": "string",
            "isProtected": true,
            "blobId": "string",
            "attributes": [
                {
                    "attributeId": "evnnmvHTCgIn",
                    "noteId": "evnnmvHTCgIn",
                    "type": "label",
                    "name": "shareCss",
                    "value": "string",
                    "position": 0,
                    "isInheritable": true,
                    "utcDateModified": "2021-12-31 19:18:11.930Z"
                }
            ],
            "parentNoteIds": [
                "evnnmvHTCgIn"
            ],
            "childNoteIds": [
                "evnnmvHTCgIn"
            ],
            "parentBranchIds": [
                "evnnmvHTCgIn"
            ],
            "childBranchIds": [
                "evnnmvHTCgIn"
            ],
            "dateCreated": "2021-12-31 20:18:11.930+0100",
            "dateModified": "2021-12-31 20:18:11.930+0100",
            "utcDateCreated": "2021-12-31 19:18:11.930Z",
            "utcDateModified": "2021-12-31 19:18:11.930Z"
        },
        "branch": {
            "branchId": "evnnmvHTCgIn",
            "noteId": "evnnmvHTCgIn",
            "parentNoteId": "evnnmvHTCgIn",
            "prefix": "string",
            "notePosition": 0,
            "isExpanded": true,
            "utcDateModified": "2021-12-31 19:18:11.930Z"
        }
    }
    ```

    </div>
    </div>

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Restore a deleted note

`POST /notes/{noteId}/undelete` · `undeleteNote`

Restore a deleted note. The note must be deleted and must have at least one undeleted parent.

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Responses**

=== "200: note restored successfully"

    *   `application/json; charset=utf-8`: `object`

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

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### List recent changes

`GET /notes/history` · `getNoteHistory`

Returns recent changes including note creations, modifications, and deletions

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Query parameters**

| Name | Description |
| --- | --- |
| `ancestorNoteId` | [`EntityId`](#schema-EntityId)  <br>Limit changes to a subtree identified by this note ID. Defaults to "root" (all notes). |

**Responses**

=== "200: list of recent changes"

    *   `application/json; charset=utf-8`: array of [`RecentChange`](#schema-RecentChange)

    ```json
    [
        {
            "noteId": "evnnmvHTCgIn",
            "title": "string",
            "current_title": "string",
            "current_isDeleted": true,
            "current_deleteId": "string",
            "current_isProtected": true,
            "utcDate": "2021-12-31 19:18:11.930Z",
            "date": "2021-12-31 20:18:11.930+0100",
            "canBeUndeleted": true
        }
    ]
    ```

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

## <span class="tn-icon bx bx-git-branch"></span> Branches

Branches place a note in the tree, under a parent note.

### Create a branch

`POST /branches` · `postBranch`

Create a branch (clone a note to a different location in the tree). In case there is a branch between parent note and child note already, then this will update the existing branch with prefix, notePosition and isExpanded.

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Request body** (required)

*   `application/json`: [`Branch`](#schema-Branch)

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `branchId` | [`EntityId`](#schema-EntityId) |
| `noteId` | [`EntityId`](#schema-EntityId)  <br>identifies the child note |
| `parentNoteId` | [`EntityId`](#schema-EntityId)  <br>identifies the parent note |
| `prefix` | `string` |
| `notePosition` | `integer (int32)` |
| `isExpanded` | `boolean` |
| `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime) |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "branchId": "evnnmvHTCgIn",
    "prefix": "string",
    "notePosition": 0,
    "isExpanded": true
}
```

</div>
</div>

**Responses**

=== "200: existing branch updated"

    *   `application/json; charset=utf-8`: [`Branch`](#schema-Branch)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `branchId` | [`EntityId`](#schema-EntityId) |
    | `noteId` | [`EntityId`](#schema-EntityId)  <br>identifies the child note |
    | `parentNoteId` | [`EntityId`](#schema-EntityId)  <br>identifies the parent note |
    | `prefix` | `string` |
    | `notePosition` | `integer (int32)` |
    | `isExpanded` | `boolean` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime) |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "branchId": "evnnmvHTCgIn",
        "noteId": "evnnmvHTCgIn",
        "parentNoteId": "evnnmvHTCgIn",
        "prefix": "string",
        "notePosition": 0,
        "isExpanded": true,
        "utcDateModified": "2021-12-31 19:18:11.930Z"
    }
    ```

    </div>
    </div>

=== "201: branch created"

    *   `application/json; charset=utf-8`: [`Branch`](#schema-Branch)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `branchId` | [`EntityId`](#schema-EntityId) |
    | `noteId` | [`EntityId`](#schema-EntityId)  <br>identifies the child note |
    | `parentNoteId` | [`EntityId`](#schema-EntityId)  <br>identifies the parent note |
    | `prefix` | `string` |
    | `notePosition` | `integer (int32)` |
    | `isExpanded` | `boolean` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime) |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "branchId": "evnnmvHTCgIn",
        "noteId": "evnnmvHTCgIn",
        "parentNoteId": "evnnmvHTCgIn",
        "prefix": "string",
        "notePosition": 0,
        "isExpanded": true,
        "utcDateModified": "2021-12-31 19:18:11.930Z"
    }
    ```

    </div>
    </div>

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Get a branch

`GET /branches/{branchId}` · `getBranchById`

Returns a branch identified by its ID

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `branchId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Responses**

=== "200: branch response"

    *   `application/json; charset=utf-8`: [`Branch`](#schema-Branch)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `branchId` | [`EntityId`](#schema-EntityId) |
    | `noteId` | [`EntityId`](#schema-EntityId)  <br>identifies the child note |
    | `parentNoteId` | [`EntityId`](#schema-EntityId)  <br>identifies the parent note |
    | `prefix` | `string` |
    | `notePosition` | `integer (int32)` |
    | `isExpanded` | `boolean` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime) |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "branchId": "evnnmvHTCgIn",
        "noteId": "evnnmvHTCgIn",
        "parentNoteId": "evnnmvHTCgIn",
        "prefix": "string",
        "notePosition": 0,
        "isExpanded": true,
        "utcDateModified": "2021-12-31 19:18:11.930Z"
    }
    ```

    </div>
    </div>

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Delete a branch

`DELETE /branches/{branchId}` · `deleteBranchById`

deletes a branch based on the branchId supplied. If this is the last branch of the (child) note, then the note is deleted as well.

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `branchId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Responses**

=== "204: branch deleted"

    No content.

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Update a branch

`PATCH /branches/{branchId}` · `patchBranchById`

patch a branch identified by the branchId with changes in the body. Only prefix and notePosition can be updated. If you want to update other properties, you need to delete the old branch and create a new one.

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `branchId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Request body** (required)

*   `application/json`: [`Branch`](#schema-Branch)

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `branchId` | [`EntityId`](#schema-EntityId) |
| `noteId` | [`EntityId`](#schema-EntityId)  <br>identifies the child note |
| `parentNoteId` | [`EntityId`](#schema-EntityId)  <br>identifies the parent note |
| `prefix` | `string` |
| `notePosition` | `integer (int32)` |
| `isExpanded` | `boolean` |
| `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime) |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "branchId": "evnnmvHTCgIn",
    "prefix": "string",
    "notePosition": 0,
    "isExpanded": true
}
```

</div>
</div>

**Responses**

=== "200: branch updated"

    *   `application/json; charset=utf-8`: [`Branch`](#schema-Branch)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `branchId` | [`EntityId`](#schema-EntityId) |
    | `noteId` | [`EntityId`](#schema-EntityId)  <br>identifies the child note |
    | `parentNoteId` | [`EntityId`](#schema-EntityId)  <br>identifies the parent note |
    | `prefix` | `string` |
    | `notePosition` | `integer (int32)` |
    | `isExpanded` | `boolean` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime) |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "branchId": "evnnmvHTCgIn",
        "noteId": "evnnmvHTCgIn",
        "parentNoteId": "evnnmvHTCgIn",
        "prefix": "string",
        "notePosition": 0,
        "isExpanded": true,
        "utcDateModified": "2021-12-31 19:18:11.930Z"
    }
    ```

    </div>
    </div>

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Refresh the order of child notes

`POST /refresh-note-ordering/{parentNoteId}` · `postRefreshNoteOrdering`

notePositions in branches are not automatically pushed to connected clients and need a specific instruction. If you want your changes to be in effect immediately, call this service after setting branches' notePosition. Note that you need to supply "parentNoteId" of branch(es) with changed positions.

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `parentNoteId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Responses**

=== "204: note ordering refreshed"

    No content.

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

## <span class="tn-icon bx bx-purchase-tag"></span> Attributes

Labels and relations of a note.

### Create an attribute

`POST /attributes` · `postAttribute`

create an attribute for a given note

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Request body** (required)

*   `application/json`: [`Attribute`](#schema-Attribute)

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `attributeId` | [`EntityId`](#schema-EntityId) |
| `noteId` | [`EntityId`](#schema-EntityId)  <br>identifies the child note |
| `type` | `string`  <br>One of `label`, `relation`. |
| `name` | `string`  <br>Matches `^[^\s]+`. |
| `value` | `string` |
| `position` | `integer (int32)` |
| `isInheritable` | `boolean` |
| `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime) |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "attributeId": "evnnmvHTCgIn",
    "type": "label",
    "name": "shareCss",
    "value": "string",
    "position": 0,
    "isInheritable": true
}
```

</div>
</div>

**Responses**

=== "201: attribute created"

    *   `application/json; charset=utf-8`: [`Attribute`](#schema-Attribute)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `attributeId` | [`EntityId`](#schema-EntityId) |
    | `noteId` | [`EntityId`](#schema-EntityId)  <br>identifies the child note |
    | `type` | `string`  <br>One of `label`, `relation`. |
    | `name` | `string`  <br>Matches `^[^\s]+`. |
    | `value` | `string` |
    | `position` | `integer (int32)` |
    | `isInheritable` | `boolean` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime) |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "attributeId": "evnnmvHTCgIn",
        "noteId": "evnnmvHTCgIn",
        "type": "label",
        "name": "shareCss",
        "value": "string",
        "position": 0,
        "isInheritable": true,
        "utcDateModified": "2021-12-31 19:18:11.930Z"
    }
    ```

    </div>
    </div>

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Get an attribute

`GET /attributes/{attributeId}` · `getAttributeById`

Returns an attribute identified by its ID

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attributeId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Responses**

=== "200: attribute response"

    *   `application/json; charset=utf-8`: [`Attribute`](#schema-Attribute)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `attributeId` | [`EntityId`](#schema-EntityId) |
    | `noteId` | [`EntityId`](#schema-EntityId)  <br>identifies the child note |
    | `type` | `string`  <br>One of `label`, `relation`. |
    | `name` | `string`  <br>Matches `^[^\s]+`. |
    | `value` | `string` |
    | `position` | `integer (int32)` |
    | `isInheritable` | `boolean` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime) |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "attributeId": "evnnmvHTCgIn",
        "noteId": "evnnmvHTCgIn",
        "type": "label",
        "name": "shareCss",
        "value": "string",
        "position": 0,
        "isInheritable": true,
        "utcDateModified": "2021-12-31 19:18:11.930Z"
    }
    ```

    </div>
    </div>

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Delete an attribute

`DELETE /attributes/{attributeId}` · `deleteAttributeById`

deletes an attribute based on the attributeId supplied.

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attributeId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Responses**

=== "204: attribute deleted"

    No content.

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Update an attribute

`PATCH /attributes/{attributeId}` · `patchAttributeById`

patch an attribute identified by the attributeId with changes in the body. For labels, only value and position can be updated. For relations, only position can be updated. If you want to modify other properties, you need to delete the old attribute and create a new one.

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attributeId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Request body** (required)

*   `application/json`: [`Attribute`](#schema-Attribute)

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `attributeId` | [`EntityId`](#schema-EntityId) |
| `noteId` | [`EntityId`](#schema-EntityId)  <br>identifies the child note |
| `type` | `string`  <br>One of `label`, `relation`. |
| `name` | `string`  <br>Matches `^[^\s]+`. |
| `value` | `string` |
| `position` | `integer (int32)` |
| `isInheritable` | `boolean` |
| `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime) |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "attributeId": "evnnmvHTCgIn",
    "type": "label",
    "name": "shareCss",
    "value": "string",
    "position": 0,
    "isInheritable": true
}
```

</div>
</div>

**Responses**

=== "200: attribute updated"

    *   `application/json; charset=utf-8`: [`Attribute`](#schema-Attribute)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `attributeId` | [`EntityId`](#schema-EntityId) |
    | `noteId` | [`EntityId`](#schema-EntityId)  <br>identifies the child note |
    | `type` | `string`  <br>One of `label`, `relation`. |
    | `name` | `string`  <br>Matches `^[^\s]+`. |
    | `value` | `string` |
    | `position` | `integer (int32)` |
    | `isInheritable` | `boolean` |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime) |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "attributeId": "evnnmvHTCgIn",
        "noteId": "evnnmvHTCgIn",
        "type": "label",
        "name": "shareCss",
        "value": "string",
        "position": 0,
        "isInheritable": true,
        "utcDateModified": "2021-12-31 19:18:11.930Z"
    }
    ```

    </div>
    </div>

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

## <span class="tn-icon bx bx-paperclip"></span> Attachments

Files attached to a note.

### List the attachments of a note

`GET /notes/{noteId}/attachments` · `getNoteAttachments`

Returns all attachments for a note identified by its ID

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Responses**

=== "200: list of attachments"

    *   `application/json; charset=utf-8`: array of [`Attachment`](#schema-Attachment)

    ```json
    [
        {
            "attachmentId": "evnnmvHTCgIn",
            "ownerId": "evnnmvHTCgIn",
            "role": "string",
            "mime": "string",
            "title": "string",
            "position": 0,
            "blobId": "string",
            "dateModified": "2021-12-31 20:18:11.930+0100",
            "utcDateModified": "2021-12-31 19:18:11.930Z",
            "utcDateScheduledForErasureSince": "2021-12-31 19:18:11.930Z",
            "contentLength": 0
        }
    ]
    ```

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Create an attachment

`POST /attachments` · `postAttachment`

create an attachment

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Request body** (required)

*   `application/json`: [`CreateAttachment`](#schema-CreateAttachment)

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `ownerId` | [`EntityId`](#schema-EntityId)  <br>identifies the owner of the attachment, is either noteId or revisionId |
| `role` | `string` |
| `mime` | `string` |
| `title` | `string` |
| `content` | `string`  <br>Text content of the attachment, stored as-is. To store binary content, create the attachment without it, then upload the data with `PUT /attachments/{attachmentId}/content`. |
| `position` | `integer (int32)` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "ownerId": "evnnmvHTCgIn",
    "role": "string",
    "mime": "string",
    "title": "string",
    "content": "string",
    "position": 0
}
```

</div>
</div>

**Responses**

=== "201: attachment created"

    *   `application/json; charset=utf-8`: [`Attachment`](#schema-Attachment)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `attachmentId` | [`EntityId`](#schema-EntityId) |
    | `ownerId` | [`EntityId`](#schema-EntityId)  <br>identifies the owner of the attachment, is either noteId or revisionId |
    | `role` | `string` |
    | `mime` | `string` |
    | `title` | `string`  <br>Title of the attachment. Returned as "\[protected\]" for protected attachments, since ETAPI cannot open a protected session. |
    | `position` | `integer (int32)` |
    | `blobId` | `string`  <br>ID of the blob object which effectively serves as a content hash |
    | `dateModified` | [`LocalDateTime`](#schema-LocalDateTime) |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime) |
    | `utcDateScheduledForErasureSince` | [`UtcDateTime`](#schema-UtcDateTime) |
    | `contentLength` | `integer (int32)` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "attachmentId": "evnnmvHTCgIn",
        "ownerId": "evnnmvHTCgIn",
        "role": "string",
        "mime": "string",
        "title": "string",
        "position": 0,
        "blobId": "string",
        "dateModified": "2021-12-31 20:18:11.930+0100",
        "utcDateModified": "2021-12-31 19:18:11.930Z",
        "utcDateScheduledForErasureSince": "2021-12-31 19:18:11.930Z",
        "contentLength": 0
    }
    ```

    </div>
    </div>

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Get an attachment

`GET /attachments/{attachmentId}` · `getAttachmentById`

Returns an attachment identified by its ID

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Responses**

=== "200: attachment response"

    *   `application/json; charset=utf-8`: [`Attachment`](#schema-Attachment)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `attachmentId` | [`EntityId`](#schema-EntityId) |
    | `ownerId` | [`EntityId`](#schema-EntityId)  <br>identifies the owner of the attachment, is either noteId or revisionId |
    | `role` | `string` |
    | `mime` | `string` |
    | `title` | `string`  <br>Title of the attachment. Returned as "\[protected\]" for protected attachments, since ETAPI cannot open a protected session. |
    | `position` | `integer (int32)` |
    | `blobId` | `string`  <br>ID of the blob object which effectively serves as a content hash |
    | `dateModified` | [`LocalDateTime`](#schema-LocalDateTime) |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime) |
    | `utcDateScheduledForErasureSince` | [`UtcDateTime`](#schema-UtcDateTime) |
    | `contentLength` | `integer (int32)` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "attachmentId": "evnnmvHTCgIn",
        "ownerId": "evnnmvHTCgIn",
        "role": "string",
        "mime": "string",
        "title": "string",
        "position": 0,
        "blobId": "string",
        "dateModified": "2021-12-31 20:18:11.930+0100",
        "utcDateModified": "2021-12-31 19:18:11.930Z",
        "utcDateScheduledForErasureSince": "2021-12-31 19:18:11.930Z",
        "contentLength": 0
    }
    ```

    </div>
    </div>

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Delete an attachment

`DELETE /attachments/{attachmentId}` · `deleteAttachmentById`

deletes an attachment based on the attachmentId supplied.

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Responses**

=== "204: attachment deleted"

    No content.

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Update an attachment

`PATCH /attachments/{attachmentId}` · `patchAttachmentById`

patch an attachment identified by the attachmentId with changes in the body. Only role, mime, title, and position are patchable.

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Request body** (required)

*   `application/json`: [`Attachment`](#schema-Attachment)

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `attachmentId` | [`EntityId`](#schema-EntityId) |
| `ownerId` | [`EntityId`](#schema-EntityId)  <br>identifies the owner of the attachment, is either noteId or revisionId |
| `role` | `string` |
| `mime` | `string` |
| `title` | `string`  <br>Title of the attachment. Returned as "\[protected\]" for protected attachments, since ETAPI cannot open a protected session. |
| `position` | `integer (int32)` |
| `blobId` | `string`  <br>ID of the blob object which effectively serves as a content hash |
| `dateModified` | [`LocalDateTime`](#schema-LocalDateTime) |
| `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime) |
| `utcDateScheduledForErasureSince` | [`UtcDateTime`](#schema-UtcDateTime) |
| `contentLength` | `integer (int32)` |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "ownerId": "evnnmvHTCgIn",
    "role": "string",
    "mime": "string",
    "title": "string",
    "position": 0,
    "blobId": "string",
    "contentLength": 0
}
```

</div>
</div>

**Responses**

=== "200: attribute updated"

    *   `application/json; charset=utf-8`: [`Attachment`](#schema-Attachment)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `attachmentId` | [`EntityId`](#schema-EntityId) |
    | `ownerId` | [`EntityId`](#schema-EntityId)  <br>identifies the owner of the attachment, is either noteId or revisionId |
    | `role` | `string` |
    | `mime` | `string` |
    | `title` | `string`  <br>Title of the attachment. Returned as "\[protected\]" for protected attachments, since ETAPI cannot open a protected session. |
    | `position` | `integer (int32)` |
    | `blobId` | `string`  <br>ID of the blob object which effectively serves as a content hash |
    | `dateModified` | [`LocalDateTime`](#schema-LocalDateTime) |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime) |
    | `utcDateScheduledForErasureSince` | [`UtcDateTime`](#schema-UtcDateTime) |
    | `contentLength` | `integer (int32)` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "attachmentId": "evnnmvHTCgIn",
        "ownerId": "evnnmvHTCgIn",
        "role": "string",
        "mime": "string",
        "title": "string",
        "position": 0,
        "blobId": "string",
        "dateModified": "2021-12-31 20:18:11.930+0100",
        "utcDateModified": "2021-12-31 19:18:11.930Z",
        "utcDateScheduledForErasureSince": "2021-12-31 19:18:11.930Z",
        "contentLength": 0
    }
    ```

    </div>
    </div>

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Get the content of an attachment

`GET /attachments/{attachmentId}/content` · `getAttachmentContent`

Returns attachment content identified by its ID. The response carries the attachment's MIME type as its `Content-Type`.

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Responses**

=== "200: attachment content"

    *   `*/*`: `string (binary)`

### Replace the content of an attachment

`PUT /attachments/{attachmentId}/content` · `putAttachmentContentById`

Updates attachment content identified by its ID

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `attachmentId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Request body** (required)

New content of the attachment. Send text as `text/plain` and binary data (such as an image or a PDF) as `application/octet-stream`; other content types are not accepted.

*   `text/plain`: `string`
*   `application/octet-stream`: `string (binary)`

**Responses**

=== "204: attachment content updated"

    No content.

## <span class="tn-icon bx bx-history"></span> Revisions

Snapshots of a note's content.

### Create a revision

`POST /notes/{noteId}/revision` · `createRevision`

Create a note revision for the given note

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Query parameters**

| Name | Description |
| --- | --- |
| `format` | `any`  <br>One of `html`, `markdown`. |

**Responses**

=== "204: revision has been created"

    No content.

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### List the revisions of a note

`GET /notes/{noteId}/revisions` · `getNoteRevisions`

Returns the revisions of a note identified by its ID. Protected revisions are omitted, since they cannot be read through ETAPI individually either.

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `noteId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Responses**

=== "200: list of revisions"

    *   `application/json; charset=utf-8`: array of [`Revision`](#schema-Revision)

    ```json
    [
        {
            "revisionId": "evnnmvHTCgIn",
            "noteId": "evnnmvHTCgIn",
            "type": "text",
            "mime": "string",
            "isProtected": true,
            "title": "string",
            "blobId": "string",
            "dateLastEdited": "2021-12-31 20:18:11.930+0100",
            "dateCreated": "2021-12-31 20:18:11.930+0100",
            "utcDateLastEdited": "2021-12-31 19:18:11.930Z",
            "utcDateCreated": "2021-12-31 19:18:11.930Z",
            "utcDateModified": "2021-12-31 19:18:11.930Z",
            "contentLength": 0
        }
    ]
    ```

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Get a revision

`GET /revisions/{revisionId}` · `getRevisionById`

Returns a revision identified by its ID

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `revisionId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Responses**

=== "200: revision response"

    *   `application/json; charset=utf-8`: [`Revision`](#schema-Revision)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `revisionId` | [`EntityId`](#schema-EntityId) |
    | `noteId` | [`EntityId`](#schema-EntityId) |
    | `type` | `string`  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `webView`, `shortcut`, `doc`, `contentWidget`, `launcher`. |
    | `mime` | `string` |
    | `isProtected` | `boolean` |
    | `title` | `string` |
    | `blobId` | `string`  <br>ID of the blob object which effectively serves as a content hash |
    | `dateLastEdited` | [`LocalDateTime`](#schema-LocalDateTime) |
    | `dateCreated` | [`LocalDateTime`](#schema-LocalDateTime) |
    | `utcDateLastEdited` | [`UtcDateTime`](#schema-UtcDateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime) |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime) |
    | `contentLength` | `integer (int32)` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "revisionId": "evnnmvHTCgIn",
        "noteId": "evnnmvHTCgIn",
        "type": "text",
        "mime": "string",
        "isProtected": true,
        "title": "string",
        "blobId": "string",
        "dateLastEdited": "2021-12-31 20:18:11.930+0100",
        "dateCreated": "2021-12-31 20:18:11.930+0100",
        "utcDateLastEdited": "2021-12-31 19:18:11.930Z",
        "utcDateCreated": "2021-12-31 19:18:11.930Z",
        "utcDateModified": "2021-12-31 19:18:11.930Z",
        "contentLength": 0
    }
    ```

    </div>
    </div>

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Get the content of a revision

`GET /revisions/{revisionId}/content` · `getRevisionContent`

Returns revision content identified by its ID

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `revisionId`  <br>_required_ | [`EntityId`](#schema-EntityId) |

**Responses**

=== "200: revision content response"

    *   `text/html`: `string`

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

## <span class="tn-icon bx bx-calendar"></span> Calendar

Day, week, month and year notes of the journal, and the inbox note.

### Get the inbox note

`GET /inbox/{date}` · `getInboxNote`

returns an "inbox" note, into which note can be created. Date will be used depending on whether the inbox is a fixed note (identified with #inbox label) or a day note in a journal. A database with neither returns the root note, and ignores the date, rather than creating a journal to hold a day note.

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `date`  <br>_required_ | `string (date)` |

**Responses**

=== "200: inbox note"

    *   `application/json; charset=utf-8`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId` | [`EntityId`](#schema-EntityId) |
    | `title` | `string`  <br>Title of the note. Returned as "\[protected\]" for protected notes, since ETAPI cannot open a protected session. |
    | `type` | `string`  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `webView`, `shortcut`, `doc`, `contentWidget`, `launcher`. |
    | `mime` | `string` |
    | `isProtected` | `boolean` |
    | `blobId` | `string`  <br>ID of the blob object which effectively serves as a content hash |
    | `attributes` | [`AttributeList`](#schema-AttributeList) |
    | `parentNoteIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `childNoteIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `parentBranchIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `childBranchIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `dateCreated` | [`LocalDateTime`](#schema-LocalDateTime) |
    | `dateModified` | [`LocalDateTime`](#schema-LocalDateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime) |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Writable through PATCH, e.g. to restore a migrated note's date after its content was rewritten. The local dateModified is derived from it. |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "evnnmvHTCgIn",
        "title": "string",
        "type": "text",
        "mime": "string",
        "isProtected": true,
        "blobId": "string",
        "attributes": [
            {
                "attributeId": "evnnmvHTCgIn",
                "noteId": "evnnmvHTCgIn",
                "type": "label",
                "name": "shareCss",
                "value": "string",
                "position": 0,
                "isInheritable": true,
                "utcDateModified": "2021-12-31 19:18:11.930Z"
            }
        ],
        "parentNoteIds": [
            "evnnmvHTCgIn"
        ],
        "childNoteIds": [
            "evnnmvHTCgIn"
        ],
        "parentBranchIds": [
            "evnnmvHTCgIn"
        ],
        "childBranchIds": [
            "evnnmvHTCgIn"
        ],
        "dateCreated": "2021-12-31 20:18:11.930+0100",
        "dateModified": "2021-12-31 20:18:11.930+0100",
        "utcDateCreated": "2021-12-31 19:18:11.930Z",
        "utcDateModified": "2021-12-31 19:18:11.930Z"
    }
    ```

    </div>
    </div>

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Get a day note

`GET /calendar/days/{date}` · `getDayNote`

returns a day note for a given date. Gets created if doesn't exist.

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `date`  <br>_required_ | `string (date)` |

**Responses**

=== "200: day note"

    *   `application/json; charset=utf-8`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId` | [`EntityId`](#schema-EntityId) |
    | `title` | `string`  <br>Title of the note. Returned as "\[protected\]" for protected notes, since ETAPI cannot open a protected session. |
    | `type` | `string`  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `webView`, `shortcut`, `doc`, `contentWidget`, `launcher`. |
    | `mime` | `string` |
    | `isProtected` | `boolean` |
    | `blobId` | `string`  <br>ID of the blob object which effectively serves as a content hash |
    | `attributes` | [`AttributeList`](#schema-AttributeList) |
    | `parentNoteIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `childNoteIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `parentBranchIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `childBranchIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `dateCreated` | [`LocalDateTime`](#schema-LocalDateTime) |
    | `dateModified` | [`LocalDateTime`](#schema-LocalDateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime) |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Writable through PATCH, e.g. to restore a migrated note's date after its content was rewritten. The local dateModified is derived from it. |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "evnnmvHTCgIn",
        "title": "string",
        "type": "text",
        "mime": "string",
        "isProtected": true,
        "blobId": "string",
        "attributes": [
            {
                "attributeId": "evnnmvHTCgIn",
                "noteId": "evnnmvHTCgIn",
                "type": "label",
                "name": "shareCss",
                "value": "string",
                "position": 0,
                "isInheritable": true,
                "utcDateModified": "2021-12-31 19:18:11.930Z"
            }
        ],
        "parentNoteIds": [
            "evnnmvHTCgIn"
        ],
        "childNoteIds": [
            "evnnmvHTCgIn"
        ],
        "parentBranchIds": [
            "evnnmvHTCgIn"
        ],
        "childBranchIds": [
            "evnnmvHTCgIn"
        ],
        "dateCreated": "2021-12-31 20:18:11.930+0100",
        "dateModified": "2021-12-31 20:18:11.930+0100",
        "utcDateCreated": "2021-12-31 19:18:11.930Z",
        "utcDateModified": "2021-12-31 19:18:11.930Z"
    }
    ```

    </div>
    </div>

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Get the day note starting the week

`GET /calendar/week-first-day/{date}` · `getWeekFirstDayNote`

Returns the day note for the first day of the week containing the given date, honouring the configured first day of week. The note is created if it doesn't exist. This returns a day note, not a week note, so unlike /calendar/weeks/{week} it does not require the enableWeekNote label on the calendar root.

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `date`  <br>_required_ | `string (date)`  <br>Any date within the week, in the format YYYY-MM-DD. |

**Responses**

=== "200: day note starting the week"

    *   `application/json; charset=utf-8`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId` | [`EntityId`](#schema-EntityId) |
    | `title` | `string`  <br>Title of the note. Returned as "\[protected\]" for protected notes, since ETAPI cannot open a protected session. |
    | `type` | `string`  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `webView`, `shortcut`, `doc`, `contentWidget`, `launcher`. |
    | `mime` | `string` |
    | `isProtected` | `boolean` |
    | `blobId` | `string`  <br>ID of the blob object which effectively serves as a content hash |
    | `attributes` | [`AttributeList`](#schema-AttributeList) |
    | `parentNoteIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `childNoteIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `parentBranchIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `childBranchIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `dateCreated` | [`LocalDateTime`](#schema-LocalDateTime) |
    | `dateModified` | [`LocalDateTime`](#schema-LocalDateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime) |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Writable through PATCH, e.g. to restore a migrated note's date after its content was rewritten. The local dateModified is derived from it. |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "evnnmvHTCgIn",
        "title": "string",
        "type": "text",
        "mime": "string",
        "isProtected": true,
        "blobId": "string",
        "attributes": [
            {
                "attributeId": "evnnmvHTCgIn",
                "noteId": "evnnmvHTCgIn",
                "type": "label",
                "name": "shareCss",
                "value": "string",
                "position": 0,
                "isInheritable": true,
                "utcDateModified": "2021-12-31 19:18:11.930Z"
            }
        ],
        "parentNoteIds": [
            "evnnmvHTCgIn"
        ],
        "childNoteIds": [
            "evnnmvHTCgIn"
        ],
        "parentBranchIds": [
            "evnnmvHTCgIn"
        ],
        "childBranchIds": [
            "evnnmvHTCgIn"
        ],
        "dateCreated": "2021-12-31 20:18:11.930+0100",
        "dateModified": "2021-12-31 20:18:11.930+0100",
        "utcDateCreated": "2021-12-31 19:18:11.930Z",
        "utcDateModified": "2021-12-31 19:18:11.930Z"
    }
    ```

    </div>
    </div>

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Get a week note

`GET /calendar/weeks/{week}` · `getWeekNote`

Returns a week note for a given ISO week (format YYYY-Www, e.g., 2025-W01). The note is created if it doesn't exist.

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `week`  <br>_required_ | `string`  <br>The ISO 8601 week identifier (YYYY-Www). Matches `[0-9]{4}-W[0-9]{2}`. |

**Responses**

=== "200: week note"

    *   `application/json; charset=utf-8`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId` | [`EntityId`](#schema-EntityId) |
    | `title` | `string`  <br>Title of the note. Returned as "\[protected\]" for protected notes, since ETAPI cannot open a protected session. |
    | `type` | `string`  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `webView`, `shortcut`, `doc`, `contentWidget`, `launcher`. |
    | `mime` | `string` |
    | `isProtected` | `boolean` |
    | `blobId` | `string`  <br>ID of the blob object which effectively serves as a content hash |
    | `attributes` | [`AttributeList`](#schema-AttributeList) |
    | `parentNoteIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `childNoteIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `parentBranchIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `childBranchIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `dateCreated` | [`LocalDateTime`](#schema-LocalDateTime) |
    | `dateModified` | [`LocalDateTime`](#schema-LocalDateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime) |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Writable through PATCH, e.g. to restore a migrated note's date after its content was rewritten. The local dateModified is derived from it. |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "evnnmvHTCgIn",
        "title": "string",
        "type": "text",
        "mime": "string",
        "isProtected": true,
        "blobId": "string",
        "attributes": [
            {
                "attributeId": "evnnmvHTCgIn",
                "noteId": "evnnmvHTCgIn",
                "type": "label",
                "name": "shareCss",
                "value": "string",
                "position": 0,
                "isInheritable": true,
                "utcDateModified": "2021-12-31 19:18:11.930Z"
            }
        ],
        "parentNoteIds": [
            "evnnmvHTCgIn"
        ],
        "childNoteIds": [
            "evnnmvHTCgIn"
        ],
        "parentBranchIds": [
            "evnnmvHTCgIn"
        ],
        "childBranchIds": [
            "evnnmvHTCgIn"
        ],
        "dateCreated": "2021-12-31 20:18:11.930+0100",
        "dateModified": "2021-12-31 20:18:11.930+0100",
        "utcDateCreated": "2021-12-31 19:18:11.930Z",
        "utcDateModified": "2021-12-31 19:18:11.930Z"
    }
    ```

    </div>
    </div>

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Get a month note

`GET /calendar/months/{month}` · `getMonthNote`

Returns a month note for a given month (format YYYY-MM, e.g., 2022-02). The note is created if it doesn't exist.

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `month`  <br>_required_ | `string`  <br>Matches `[0-9]{4}-[0-9]{2}`. |

**Responses**

=== "200: month note"

    *   `application/json; charset=utf-8`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId` | [`EntityId`](#schema-EntityId) |
    | `title` | `string`  <br>Title of the note. Returned as "\[protected\]" for protected notes, since ETAPI cannot open a protected session. |
    | `type` | `string`  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `webView`, `shortcut`, `doc`, `contentWidget`, `launcher`. |
    | `mime` | `string` |
    | `isProtected` | `boolean` |
    | `blobId` | `string`  <br>ID of the blob object which effectively serves as a content hash |
    | `attributes` | [`AttributeList`](#schema-AttributeList) |
    | `parentNoteIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `childNoteIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `parentBranchIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `childBranchIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `dateCreated` | [`LocalDateTime`](#schema-LocalDateTime) |
    | `dateModified` | [`LocalDateTime`](#schema-LocalDateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime) |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Writable through PATCH, e.g. to restore a migrated note's date after its content was rewritten. The local dateModified is derived from it. |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "evnnmvHTCgIn",
        "title": "string",
        "type": "text",
        "mime": "string",
        "isProtected": true,
        "blobId": "string",
        "attributes": [
            {
                "attributeId": "evnnmvHTCgIn",
                "noteId": "evnnmvHTCgIn",
                "type": "label",
                "name": "shareCss",
                "value": "string",
                "position": 0,
                "isInheritable": true,
                "utcDateModified": "2021-12-31 19:18:11.930Z"
            }
        ],
        "parentNoteIds": [
            "evnnmvHTCgIn"
        ],
        "childNoteIds": [
            "evnnmvHTCgIn"
        ],
        "parentBranchIds": [
            "evnnmvHTCgIn"
        ],
        "childBranchIds": [
            "evnnmvHTCgIn"
        ],
        "dateCreated": "2021-12-31 20:18:11.930+0100",
        "dateModified": "2021-12-31 20:18:11.930+0100",
        "utcDateCreated": "2021-12-31 19:18:11.930Z",
        "utcDateModified": "2021-12-31 19:18:11.930Z"
    }
    ```

    </div>
    </div>

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Get a year note

`GET /calendar/years/{year}` · `getYearNote`

Returns a year note for a given year (format YYYY, e.g., 2022). The note is created if it doesn't exist.

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `year`  <br>_required_ | `string`  <br>Matches `^[0-9]{4}$`. |

**Responses**

=== "200: year note"

    *   `application/json; charset=utf-8`: [`Note`](#schema-Note)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `noteId` | [`EntityId`](#schema-EntityId) |
    | `title` | `string`  <br>Title of the note. Returned as "\[protected\]" for protected notes, since ETAPI cannot open a protected session. |
    | `type` | `string`  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `webView`, `shortcut`, `doc`, `contentWidget`, `launcher`. |
    | `mime` | `string` |
    | `isProtected` | `boolean` |
    | `blobId` | `string`  <br>ID of the blob object which effectively serves as a content hash |
    | `attributes` | [`AttributeList`](#schema-AttributeList) |
    | `parentNoteIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `childNoteIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `parentBranchIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `childBranchIds` | [`EntityIdList`](#schema-EntityIdList) |
    | `dateCreated` | [`LocalDateTime`](#schema-LocalDateTime) |
    | `dateModified` | [`LocalDateTime`](#schema-LocalDateTime) |
    | `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime) |
    | `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Writable through PATCH, e.g. to restore a migrated note's date after its content was rewritten. The local dateModified is derived from it. |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "noteId": "evnnmvHTCgIn",
        "title": "string",
        "type": "text",
        "mime": "string",
        "isProtected": true,
        "blobId": "string",
        "attributes": [
            {
                "attributeId": "evnnmvHTCgIn",
                "noteId": "evnnmvHTCgIn",
                "type": "label",
                "name": "shareCss",
                "value": "string",
                "position": 0,
                "isInheritable": true,
                "utcDateModified": "2021-12-31 19:18:11.930Z"
            }
        ],
        "parentNoteIds": [
            "evnnmvHTCgIn"
        ],
        "childNoteIds": [
            "evnnmvHTCgIn"
        ],
        "parentBranchIds": [
            "evnnmvHTCgIn"
        ],
        "childBranchIds": [
            "evnnmvHTCgIn"
        ],
        "dateCreated": "2021-12-31 20:18:11.930+0100",
        "dateModified": "2021-12-31 20:18:11.930+0100",
        "utcDateCreated": "2021-12-31 19:18:11.930Z",
        "utcDateModified": "2021-12-31 19:18:11.930Z"
    }
    ```

    </div>
    </div>

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

## <span class="tn-icon bx bx-key"></span> Tokens

Obtaining and revoking ETAPI tokens with the password.

### Log in

`POST /auth/login` · `login`

get an ETAPI token based on password for further use with ETAPI. Too many requests from one IP address within a short time, such as failed logins, block that address for a while.

**Authorization**: none

**Request body** (required)

*   `application/json`: `object`

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

| Property | Description |
| --- | --- |
| `password` | `string`  <br>user's password used to e.g. login to Trilium server and/or protect notes |
| `totpToken` | `string`  <br>the current TOTP code, or one of the recovery codes; required when multi-factor authentication with TOTP is enabled. Each code is accepted once. |
| `tokenName` | `string`  <br>name of the created token, shown in the list of ETAPI tokens |

</div>
<div class="trilium-multicolumn-column">

```json
{
    "password": "string",
    "totpToken": "string",
    "tokenName": "string"
}
```

</div>
</div>

**Responses**

=== "201: auth token"

    *   `application/json; charset=utf-8`: `object`

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `authToken` | `string` |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "authToken": "Bc4bFn0Ffiok_4NpbVCDnFz7B2WU+pdhW8B5Ne3DiR5wXrEyqdjgRIsk="
    }
    ```

    </div>
    </div>

=== "401: wrong credentials: `WRONG_PASSWORD`, `TOTP_REQUIRED` (TOTP is enabled and no `totpToken` was sent) or `WRONG_TOTP`"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

=== "429: too many requests"

    No content.

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Log out

`POST /auth/logout` · `logout`

logout (delete/deactivate) an ETAPI token

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Responses**

=== "204: logout successful"

    No content.

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

## <span class="tn-icon bx bx-server"></span> Application

Information about the instance, backups and metrics.

### Get application info

`GET /app-info` · `getAppInfo`

returns information about the running Trilium instance

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Responses**

=== "200: app info"

    *   `application/json; charset=utf-8`: [`AppInfo`](#schema-AppInfo)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `appVersion` | `string`  <br>Trilium version |
    | `dbVersion` | `integer (int32)`  <br>DB version |
    | `syncVersion` | `integer (int32)`  <br>Sync protocol version |
    | `buildDate` | `string (date-time)`  <br>build date |
    | `buildRevision` | `string`  <br>git build revision |
    | `dataDirectory` | `string`  <br>data directory where Trilium stores files |
    | `clipperProtocolVersion` | `string`  <br>version of the supported Trilium Web Clipper protocol |
    | `utcDateTime` | `string`  <br>current UTC date time |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "appVersion": "0.50.2",
        "dbVersion": 194,
        "syncVersion": 25,
        "buildDate": "2022-02-09T22:52:36+01:00",
        "buildRevision": "23daaa2387a0655685377f0a541d154aeec2aae8",
        "dataDirectory": "/home/user/data",
        "clipperProtocolVersion": 1.1,
        "utcDateTime": "2022-03-07T21:54:25.277Z"
    }
    ```

    </div>
    </div>

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Create a backup

`PUT /backup/{backupName}` · `createBackup`

Create a database backup under a given name

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Path parameters**

| Name | Description |
| --- | --- |
| `backupName`  <br>_required_ | [`StringId`](#schema-StringId)  <br>If the backupName is e.g. "now", then the backup will be written to "backup-now.db" file |

**Responses**

=== "204: backup has been created"

    No content.

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

### Get instance metrics

`GET /metrics` · `getMetrics`

Returns instance and database metrics for monitoring: note, attachment, revision, branch, attribute and blob counts, note and attachment type breakdowns, version information and database size. Counts only — no note titles, content or attributes.

The same data is served by GET /api/metrics to the web session.

**Authorization**: `EtapiTokenAuth` or `EtapiBasicAuth`

**Query parameters**

| Name | Description |
| --- | --- |
| `format` | `string`  <br>Response format. Defaults to Prometheus text. One of `prometheus`, `json`. |

**Responses**

=== "200: instance metrics"

    === "`text/plain`: `string`"

        ```plaintext
        # HELP trilium_info Trilium instance information
        # TYPE trilium_info gauge
        trilium_info{version="0.99.3",db_version="231"} 1 1701432000

        # HELP trilium_notes_total Total number of notes including deleted
        # TYPE trilium_notes_total gauge
        trilium_notes_total 1234 1701432000
        ```

    === "`application/json`: `Metrics`"

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
        | `noteTypes` | `object`  <br>Number of active notes per note type |
        | `attachmentTypes` | `object`  <br>Number of active attachments per MIME type |
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
                "app": "0.99.3",
                "db": 231,
                "node": "v22.14.0",
                "sync": 35,
                "buildDate": "2024-09-07T18:36:34Z",
                "buildRevision": "7c0d6930fa8f20d269dcfbcbc8f636a25f6bb9a7"
            },
            "database": {
                "totalNotes": 0,
                "deletedNotes": 0,
                "activeNotes": 0,
                "protectedNotes": 0,
                "totalAttachments": 0,
                "deletedAttachments": 0,
                "activeAttachments": 0,
                "totalRevisions": 0,
                "totalBranches": 0,
                "totalAttributes": 0,
                "totalBlobs": 0,
                "totalEtapiTokens": 0,
                "totalRecentNotes": 0
            },
            "noteTypes": {
                "text": 800,
                "code": 200
            },
            "attachmentTypes": {
                "image/png": 45,
                "application/pdf": 14
            },
            "statistics": {
                "oldestNote": "string",
                "newestNote": "string",
                "lastModified": "string",
                "databaseSizeBytes": 0
            },
            "timestamp": "2024-12-01T12:00:00.000Z"
        }
        ```

        </div>
        </div>

=== "default: unexpected error"

    *   `application/json; charset=utf-8`: [`Error`](#schema-Error)

    <div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
    <div class="trilium-multicolumn-column">

    | Property | Description |
    | --- | --- |
    | `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
    | `code`  <br>_required_ | `string`  <br>stable string constant |
    | `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

    </div>
    <div class="trilium-multicolumn-column">

    ```json
    {
        "status": 400,
        "code": "NOTE_IS_PROTECTED",
        "message": "Note 'evnnmvHTCgIn' is protected and cannot be modified through ETAPI"
    }
    ```

    </div>
    </div>

## <span class="tn-icon bx bx-cube"></span> Schemas

### <a id="schema-CreateNoteDef"></a>`CreateNoteDef`

| Property | Description |
| --- | --- |
| `parentNoteId`  <br>_required_ | [`EntityId`](#schema-EntityId)  <br>Note ID of the parent note in the tree |
| `title`  <br>_required_ | `string` |
| `type`  <br>_required_ | `string`  <br>One of `text`, `code`, `file`, `image`, `search`, `book`, `relationMap`, `render`. |
| `mime` | `string`  <br>this needs to be specified only for note types 'code', 'file', 'image'. |
| `content`  <br>_required_ | `string` |
| `notePosition` | `integer`  <br>Position of the note in the parent. Normal ordering is 10, 20, 30 ... So if you want to create a note on the first position, use e.g. 5, for second position 15, for last e.g. 1000000 |
| `prefix` | `string`  <br>Prefix is branch (placement) specific title prefix for the note. Let's say you have your note placed into two different places in the tree, but you want to change the title a bit in one of the placements. For this you can use prefix. |
| `isExpanded` | `boolean`  <br>true if this note (as a folder) should appear expanded |
| `noteId` | [`EntityId`](#schema-EntityId)  <br>DON'T specify unless you want to force a specific noteId |
| `branchId` | [`EntityId`](#schema-EntityId)  <br>DON'T specify unless you want to force a specific branchId |
| `dateCreated` | [`LocalDateTime`](#schema-LocalDateTime)  <br>Local timestap of the note creation. Specify only if you want to override the default (current datetime in the current timezone/offset). |
| `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime)  <br>UTC timestap of the note creation. Specify only if you want to override the default (current datetime). |
| `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>UTC timestamp of the note's last modification, e.g. to keep the date of a note being migrated from another application. The local dateModified is derived from it. Specify only if you want to override the default (current datetime). |

### <a id="schema-Note"></a>`Note`

| Property | Description |
| --- | --- |
| `noteId` | [`EntityId`](#schema-EntityId) |
| `title` | `string`  <br>Title of the note. Returned as "\[protected\]" for protected notes, since ETAPI cannot open a protected session. |
| `type` | `string`  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `webView`, `shortcut`, `doc`, `contentWidget`, `launcher`. |
| `mime` | `string` |
| `isProtected` | `boolean` |
| `blobId` | `string`  <br>ID of the blob object which effectively serves as a content hash |
| `attributes` | [`AttributeList`](#schema-AttributeList) |
| `parentNoteIds` | [`EntityIdList`](#schema-EntityIdList) |
| `childNoteIds` | [`EntityIdList`](#schema-EntityIdList) |
| `parentBranchIds` | [`EntityIdList`](#schema-EntityIdList) |
| `childBranchIds` | [`EntityIdList`](#schema-EntityIdList) |
| `dateCreated` | [`LocalDateTime`](#schema-LocalDateTime) |
| `dateModified` | [`LocalDateTime`](#schema-LocalDateTime) |
| `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime) |
| `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime)  <br>Writable through PATCH, e.g. to restore a migrated note's date after its content was rewritten. The local dateModified is derived from it. |

### <a id="schema-Branch"></a>`Branch`

Branch places the note into the tree, it represents the relationship between a parent note and child note

| Property | Description |
| --- | --- |
| `branchId` | [`EntityId`](#schema-EntityId) |
| `noteId` | [`EntityId`](#schema-EntityId)  <br>identifies the child note |
| `parentNoteId` | [`EntityId`](#schema-EntityId)  <br>identifies the parent note |
| `prefix` | `string` |
| `notePosition` | `integer (int32)` |
| `isExpanded` | `boolean` |
| `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime) |

### <a id="schema-NoteWithBranch"></a>`NoteWithBranch`

| Property | Description |
| --- | --- |
| `note` | [`Note`](#schema-Note) |
| `branch` | [`Branch`](#schema-Branch)  <br>Branch places the note into the tree, it represents the relationship between a parent note and child note |

### <a id="schema-Attachment"></a>`Attachment`

Attachment is owned by a note, has title and content

| Property | Description |
| --- | --- |
| `attachmentId` | [`EntityId`](#schema-EntityId) |
| `ownerId` | [`EntityId`](#schema-EntityId)  <br>identifies the owner of the attachment, is either noteId or revisionId |
| `role` | `string` |
| `mime` | `string` |
| `title` | `string`  <br>Title of the attachment. Returned as "\[protected\]" for protected attachments, since ETAPI cannot open a protected session. |
| `position` | `integer (int32)` |
| `blobId` | `string`  <br>ID of the blob object which effectively serves as a content hash |
| `dateModified` | [`LocalDateTime`](#schema-LocalDateTime) |
| `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime) |
| `utcDateScheduledForErasureSince` | [`UtcDateTime`](#schema-UtcDateTime) |
| `contentLength` | `integer (int32)` |

### <a id="schema-CreateAttachment"></a>`CreateAttachment`

| Property | Description |
| --- | --- |
| `ownerId` | [`EntityId`](#schema-EntityId)  <br>identifies the owner of the attachment, is either noteId or revisionId |
| `role` | `string` |
| `mime` | `string` |
| `title` | `string` |
| `content` | `string`  <br>Text content of the attachment, stored as-is. To store binary content, create the attachment without it, then upload the data with `PUT /attachments/{attachmentId}/content`. |
| `position` | `integer (int32)` |

### <a id="schema-Attribute"></a>`Attribute`

Attribute (Label, Relation) is a key-value record attached to a note.

| Property | Description |
| --- | --- |
| `attributeId` | [`EntityId`](#schema-EntityId) |
| `noteId` | [`EntityId`](#schema-EntityId)  <br>identifies the child note |
| `type` | `string`  <br>One of `label`, `relation`. |
| `name` | `string`  <br>Matches `^[^\s]+`. |
| `value` | `string` |
| `position` | `integer (int32)` |
| `isInheritable` | `boolean` |
| `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime) |

### <a id="schema-AttributeList"></a>`AttributeList`

Type: array of [`Attribute`](#schema-Attribute)

### <a id="schema-SearchResponse"></a>`SearchResponse`

| Property | Description |
| --- | --- |
| `results`  <br>_required_ | array of [`Note`](#schema-Note) |
| `debugInfo` | `object`  <br>debugging info on parsing the search query enabled with &debug=true parameter |

### <a id="schema-EntityId"></a>`EntityId`

Type: `string`

Matches `[a-zA-Z0-9_]{4,32}`.

Example: `evnnmvHTCgIn`

### <a id="schema-StringId"></a>`StringId`

Type: `string`

Matches `[a-zA-Z0-9_]{1,32}`.

Example: `my_ID`

### <a id="schema-EntityIdList"></a>`EntityIdList`

Type: array of [`EntityId`](#schema-EntityId)

### <a id="schema-LocalDateTime"></a>`LocalDateTime`

Type: `string`

Matches `[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}[\+\-][0-9]{4}`.

Example: `2021-12-31 20:18:11.930+0100`

### <a id="schema-UtcDateTime"></a>`UtcDateTime`

Type: `string`

Matches `[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z`.

Example: `2021-12-31 19:18:11.930Z`

### <a id="schema-AppInfo"></a>`AppInfo`

| Property | Description |
| --- | --- |
| `appVersion` | `string`  <br>Trilium version |
| `dbVersion` | `integer (int32)`  <br>DB version |
| `syncVersion` | `integer (int32)`  <br>Sync protocol version |
| `buildDate` | `string (date-time)`  <br>build date |
| `buildRevision` | `string`  <br>git build revision |
| `dataDirectory` | `string`  <br>data directory where Trilium stores files |
| `clipperProtocolVersion` | `string`  <br>version of the supported Trilium Web Clipper protocol |
| `utcDateTime` | `string`  <br>current UTC date time |

### <a id="schema-Error"></a>`Error`

| Property | Description |
| --- | --- |
| `status`  <br>_required_ | `integer (int32)`  <br>HTTP status, identical to the one given in HTTP response |
| `code`  <br>_required_ | `string`  <br>stable string constant |
| `message`  <br>_required_ | `string`  <br>Human readable error, potentially with more details, |

### <a id="schema-Revision"></a>`Revision`

Revision represents a snapshot of note's title and content at some point in the past.

| Property | Description |
| --- | --- |
| `revisionId` | [`EntityId`](#schema-EntityId) |
| `noteId` | [`EntityId`](#schema-EntityId) |
| `type` | `string`  <br>One of `text`, `code`, `render`, `file`, `image`, `search`, `relationMap`, `book`, `noteMap`, `mermaid`, `webView`, `shortcut`, `doc`, `contentWidget`, `launcher`. |
| `mime` | `string` |
| `isProtected` | `boolean` |
| `title` | `string` |
| `blobId` | `string`  <br>ID of the blob object which effectively serves as a content hash |
| `dateLastEdited` | [`LocalDateTime`](#schema-LocalDateTime) |
| `dateCreated` | [`LocalDateTime`](#schema-LocalDateTime) |
| `utcDateLastEdited` | [`UtcDateTime`](#schema-UtcDateTime) |
| `utcDateCreated` | [`UtcDateTime`](#schema-UtcDateTime) |
| `utcDateModified` | [`UtcDateTime`](#schema-UtcDateTime) |
| `contentLength` | `integer (int32)` |

### <a id="schema-RecentChange"></a>`RecentChange`

Represents a recent change event (creation, modification, or deletion).

| Property | Description |
| --- | --- |
| `noteId` | [`EntityId`](#schema-EntityId) |
| `title` | `string`  <br>Title at the time of the change (may be "\[protected\]" for protected notes) |
| `current_title` | `string`  <br>Current title of the note (may be "\[protected\]" for protected notes) |
| `current_isDeleted` | `boolean`  <br>Whether the note is currently deleted |
| `current_deleteId` | `string`  <br>Delete ID if the note is deleted |
| `current_isProtected` | `boolean`  <br>Whether the note is protected |
| `utcDate` | [`UtcDateTime`](#schema-UtcDateTime)  <br>UTC timestamp of the change |
| `date` | [`LocalDateTime`](#schema-LocalDateTime)  <br>Local timestamp of the change |
| `canBeUndeleted` | `boolean`  <br>Whether the note can be undeleted (only present for deleted notes) |

### <a id="schema-Metrics"></a>`Metrics`

Instance and database metrics, as served by GET /etapi/metrics?format=json

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
| `noteTypes` | `object`  <br>Number of active notes per note type |
| `attachmentTypes` | `object`  <br>Number of active attachments per MIME type |
| `statistics` | `object` |
| `statistics.oldestNote` | `string \| null` |
| `statistics.newestNote` | `string \| null` |
| `statistics.lastModified` | `string \| null` |
| `statistics.databaseSizeBytes` | `integer \| null` |
| `timestamp` | `string` |