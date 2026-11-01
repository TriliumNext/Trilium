# Entity change tombstones
When an entity is erased, its row in `entity_changes` is **not** deleted — it is flagged. `erase#setEntityChangesAsErased` sets `isErased = true`, refreshes `utcDateChanged` and re-pushes the row through `putEntityChangeWithForcedChange`. The tombstone is what tells every peer "this entity is gone"; without it, a peer that still holds the entity would simply push it back.

## Tombstones are never collected

There is no garbage collection for them. There is no cluster-wide acknowledged-id watermark, no TTL, and no compaction pass. The `entity_changes` table therefore grows monotonically with **lifetime deletion activity**, not with the amount of data a user currently has.

Two things amplify this:

*   **Deletions cascade.** Erasing a note tombstones its branches, attributes and revisions too (`erase#eraseNotes`), so the count tracks edit-and-delete volume rather than note count.
*   **Full initial sync replays the entire history.** A fresh client pulls every row, tombstones included. There is no snapshot or bootstrap path that would let it start from the current state.

A real database observed in 2026 held ~165 000 entity changes against only ~12 000 live entities (1 954 notes, 7 200 attributes, 644 attachments) — roughly **85 % tombstones**.

## Why they cannot simply be deleted

`content_hash#getEntityHashes` folds the flag into the per-sector hash:

```
entityHashMap[sector] = (entityHashMap[sector] || "") + hash + isErased;
```

Erased rows are therefore part of the hash a peer compares against. Deleting tombstones on one instance diverges its sector hashes from any peer that still has them, `checkContentHashes` then fails on nearly every sector, and `addEntityChangesForSector` re-pushes **all** rows for those sectors — including the erased ones, because `putEntityChange` preserves `isErased`. The tombstones come back.

A manual `DELETE FROM entity_changes WHERE isErased = 1` only sticks if it is done on every instance at once, or if the server is the sole surviving source and every client is wiped or brand new (a fresh device has no tombstones to push back). Back up first, and only do it with all clients caught up. It is id-safe: `entity_changes` uses an `AUTOINCREMENT` high-water mark, so ids are never reused.

## The built-in options do not help

*   **`fillEntityChanges`** runs `DELETE FROM entity_changes WHERE isErased = 0` and rebuilds the live rows. Tombstones are untouched, and the rebuilt rows get new ids, which makes peers re-pull them.
*   **`forceFullSync`** resets `lastSyncedPull`/`lastSyncedPush` to 0 and re-pulls everything, tombstones included. It makes the problem worse.

## Blobs are the one exception

The same wall was already hit for blobs and special-cased in `erase#eraseUnusedBlobs`, which purges their change rows outright instead of tombstoning them:

```
// blobs are not marked as erased in entity_changes, they are just purged completely
// this is because technically every keystroke can create a new blob and there would be just too many
sql.executeMany(`DELETE FROM entity_changes WHERE entityName = 'blobs' AND entityId IN (???)`, unusedBlobIds);
```

That exception was never generalised, so every other entity type still accumulates.

## Where it actually bites

The cost is invisible on native clients — better-sqlite3 handles a few hundred thousand rows without complaint. It is only fatal on the WASM targets (standalone in the browser, and the Capacitor mobile app built on it), where SQLite runs synchronously and a long transaction blocks the thread. This is latent debt that the newer targets exposed rather than created.

Any real fix has to address the hash coupling above. The plausible directions are a per-instance acknowledged-id watermark that permits coordinated collection, a snapshot/bootstrap path so fresh clients do not replay history, or generalising the blob purge to other high-churn entity types.