# Content hashing
Entity hashing is done in `content_hash#getEntityHashes`.

*   It works by looking at the `entity_changes` table and going through each of the entity names/types:
    *   `blobs`
    *   `attributes`
    *   `revisions`
    *   `attachments`
    *   `notes`
    *   `branches`
    *   `etapi_tokens`
    *   `options`
*   For some reason `note_reordering` entities are ignored specifically.
*   All the rows in `entity_changes` are then ordered alphabetically, based on their `entityId`.
*   Every entity row is then grouped by `entityName` and then by sector. The sector is defined as the first character of the `id`.
*   The hash is altered to add the `isErased` value as well since the hash of deleted entries is not updated.
*   For each sector, the hash is calculated using `utils.hash`, using SHA1 encoded as Base64.