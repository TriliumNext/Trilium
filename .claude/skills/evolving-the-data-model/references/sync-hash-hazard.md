# The `hashedProperties` sync-hash hazard

**Adding a property to an entity's `hashedProperties` is a BREAKING cross-instance sync change — not a "make this field sync" switch.** A new column already syncs (it rides in the entity row); `hashedProperties` only controls the *content hash* used to detect divergence. Touch it only when you intend a hash-format break and coordinate it across every instance in a sync cluster at the same time.

## How the hash is built and used

`generateHash()` (`abstract_becca_entity.ts:63-76`) concatenates `|<value>` for each property in the entity's `hashedProperties`, then truncates to 10 chars:

```ts
generateHash(isDeleted?: boolean): string {
    const constructorData = this.constructor as unknown as ConstructorData<T>;
    let contentToHash = "";

    for (const propertyName of constructorData.hashedProperties) {
        contentToHash += `|${(this as any)[propertyName]}`;
    }

    if (isDeleted) {
        contentToHash += "|deleted";
    }

    return hash(contentToHash).substr(0, 10);
}
```

That hash is stamped onto every `entity_changes` row in `putEntityChange()` (`abstract_becca_entity.ts:51-61`):

```ts
entityChangesService.putEntityChange({
    entityName: constructorData.entityName,
    entityId: (this as any)[constructorData.primaryKeyName],
    hash: this.generateHash(isDeleted),
    // ...
});
```

`ConstructorData.hashedProperties` is typed `(keyof T)[]` (`becca-interface.ts:353-357`), so the compiler only checks that names are real properties — it cannot warn you that you changed the *meaning* of the hash. Sync uses these `entity_changes` hashes to decide which side is authoritative during the push→pull→push content-hash verification loop.

## Why adding to `hashedProperties` breaks a cluster

Concatenation order and membership are part of the hash contract. In a multi-instance / multi-version cluster:

- An instance on **old** code computes `hash("|attributeId|noteId|type|name|value|isInheritable")`.
- An instance on **new** code (you added `color`) computes `hash("|attributeId|noteId|type|name|value|isInheritable|color")`.

For the **same** unchanged entity the two hashes differ. Sync now sees perpetual "divergence" it can never reconcile — undebuggable hash mismatches, ping-pong updates, content-hash retry loops. Even reordering the existing list (not adding) breaks it, because the concatenation order changes.

## Decision: should the new column be in `hashedProperties`?

| Situation | In `hashedProperties`? |
|---|---|
| New column is local-only derived/cache data, or you just want it to round-trip through sync | **NO** — leave it out. It still syncs in the row; this is the sync-SAFE default. |
| The column is genuinely part of the entity's synced identity AND you accept a coordinated hash-format break across all instances on the same release | YES — and only then. Treat it like a sync-protocol bump. |

When unsure: **leave it out.** A column omitted from `hashedProperties` still persists and still syncs; the only thing you lose is the field participating in divergence detection — which is exactly what you want for additive, backward-compatible columns.

## Current `hashedProperties` lists (reference)

| Entity | File:line | `hashedProperties` |
|---|---|---|
| BNote | `bnote.ts:61-62` | `["noteId", "title", "isProtected", "type", "mime", "blobId"]` |
| BAttribute | `battribute.ts:25-27` | `["attributeId", "noteId", "type", "name", "value", "isInheritable"]` |
| BBranch | `bbranch.ts:29-30` | `["branchId", "noteId", "parentNoteId", "prefix"]` |
| BRevision | `brevision.ts:33-34` | `["revisionId", "noteId", "title", "description", "source", "isProtected", "dateLastEdited", "dateCreated", "utcDateLastEdited", "utcDateCreated", "utcDateModified", "blobId"]` |
| BAttachment | `battachment.ts:41-42` | `["attachmentId", "ownerId", "role", "mime", "title", "blobId", "utcDateScheduledForErasureSince"]` |
| BBlob | `bblob.ts:11-12` | `["blobId", "content"]` |
| BOption | `boption.ts:17-18` | `["name", "value"]` |
| BEtapiToken | `betapi_token.ts:24-25` | `["etapiTokenId", "name", "tokenHash", "utcDateCreated", "utcDateModified", "isDeleted"]` |
| BRecentNote | `brecent_note.ts:18-19` | `["noteId", "notePath"]` |

Note that even `BAttribute`'s list omits `position` and `utcDateModified` — position reordering and modified-time alone are intentionally *not* treated as content divergence. Mirror that judgment for any new column.
