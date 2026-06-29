# Adding a column to a Becca entity — the 5-file chain

Adding a column to `notes` / `attributes` / `branches` is **not** a one-file change. Miss any link and you get a silent failure (no compile error, no test failure) on either fresh installs or becca load. The worked example below adds a hypothetical `color TEXT` column to `attributes`.

> Verify every line number against the live file before editing — they drift. The citations here were checked against the tree at the time of writing.

## The chain (in order)

### 1. `migrations.ts` — the `ALTER TABLE`

Top of the `MIGRATIONS` array (`migrations.ts:11`), new version = `MIGRATIONS[0].version + 1`:

```ts
{
    version: 239,
    sql: /*sql*/`
        ALTER TABLE attributes ADD COLUMN color TEXT DEFAULT '' NOT NULL;
    `,
    ignoreErrors: true
},
```

`ignoreErrors: true` so re-running over an already-patched DB doesn't halt the single migration transaction (`migration.ts:45-70`; the flag is documented at `migrations.ts:359-360` and used on the recent column-adds at `238`/`236`).

### 2. `assets/schema.sql` — mirror it into the `CREATE TABLE`

Fresh installs run `sql.executeScript(schema)` and **never replay migrations** (`sql_init.ts:141`). The `attributes` table lives at `schema.sql:67-78`:

```sql
CREATE TABLE IF NOT EXISTS "attributes"
(
    attributeId      TEXT not null primary key,
    noteId       TEXT not null,
    type         TEXT not null,
    name         TEXT not null,
    value        TEXT default '' not null,
    position     INT  default 0 not null,
    utcDateModified TEXT not null,
    isDeleted    INT  not null,
    `deleteId`    TEXT DEFAULT NULL,
    isInheritable int DEFAULT 0 NULL,
    color        TEXT default '' not null);   -- ← add here
```

There is **no parity test** comparing a fresh schema against a migrated one, so a miss here is invisible until a brand-new DB hits code that reads `color`.

### 3. `packages/commons/src/lib/rows.ts` — the Row interface

`AttributeRow` (`rows.ts:87-96`) is the shared client/server shape:

```ts
export interface AttributeRow {
    attributeId?: string;
    noteId?: string;
    type: AttributeType;
    name: string;
    position?: number | null;
    value?: string;
    isInheritable?: boolean;
    color?: string;            // ← add
    utcDateModified?: string;
}
```

### 4. `entities/battribute.ts` — property + the three accessors

`BAttribute` (`battribute.ts`) needs four edits. **Add the property:**

```ts
color!: string;
```

**`updateFromRow`** (`battribute.ts:53-55`) builds the positional array passed to `update()` — append the new field:

```ts
updateFromRow(row: AttributeRow) {
    this.update([row.attributeId, row.noteId, row.type, row.name, row.value, row.isInheritable, row.position, row.utcDateModified, row.color]);
}
```

**`update([...])`** (`battribute.ts:57-72`) destructures positionally — append in the **same** position:

```ts
update([attributeId, noteId, type, name, value, isInheritable, position, utcDateModified, color]: any) {
    // ...existing assignments...
    this.color = color || "";
    return this;
}
```

**`getPojo()`** (`battribute.ts:222-234`) is what gets written back to SQL on `save()` — add the field or it never persists:

```ts
getPojo() {
    return {
        attributeId: this.attributeId,
        // ...
        color: this.color,
        utcDateModified: this.utcDateModified,
        isDeleted: false
    };
}
```

**Decide, deliberately, about `hashedProperties`** (`battribute.ts:25-27`). A new column is sync-safe **only if you leave it OUT** of `hashedProperties`. Adding it is a cross-instance hash-format break — read [sync-hash-hazard.md](../references/sync-hash-hazard.md) before touching it.

### 5. `becca/becca_loader.ts` — the raw `SELECT` (the positional trap)

`attributes` are bulk-loaded with a **raw positional query** (`becca_loader.ts:53`):

```ts
for (const row of sql.getRawRows<AttributeRow>(/*sql*/`SELECT attributeId, noteId, type, name, value, isInheritable, position, utcDateModified, color FROM attributes WHERE isDeleted = 0`)) {
    new BAttribute().update(row).init();
}
```

`getRawRows` returns **arrays, not objects**, so the `SELECT` column order *is* the `update([...])` parameter order.

## The positional coupling — diagram

```
becca_loader.ts SELECT (raw array, by position)
   SELECT attributeId, noteId, type, name, value, isInheritable, position, utcDateModified, color
            [0]        [1]     [2]   [3]   [4]    [5]            [6]       [7]              [8]
                                          ↓ same order ↓
battribute.ts update([...]) destructure
   update([attributeId, noteId, type, name, value, isInheritable, position, utcDateModified, color])
            [0]         [1]     [2]   [3]   [4]    [5]            [6]       [7]              [8]
```

If you append `color` to the `SELECT` but forget the `update()` destructure (or insert it mid-list in one place only), **every** attribute loads with shifted values — `color` lands in `utcDateModified`, etc. No exception is thrown.

> Which entities have this trap? Only the ones loaded via `getRawRows` + `.update(row)`: **notes** (`becca_loader.ts:41`), **branches** (`:45`), **attributes** (`:53`). `options` and `etapi_tokens` use `sql.getRows` (named objects) + constructor (`:57`, `:61`), so they are **not** positional. Entities loaded lazily (revisions, attachments, blobs) have no `becca_loader` SELECT at all — their `updateFromRow` is field-by-field (e.g. `brevision.ts:59`), so step 5 doesn't apply, but steps 1–4 still do.

## Sanity checklist

- [ ] `migrations.ts` top entry, version = old top + 1, `ignoreErrors: true` for the ALTER
- [ ] `schema.sql` `CREATE TABLE` mirrors the column (fresh-install parity)
- [ ] `rows.ts` Row interface has the field
- [ ] entity: property declared; `updateFromRow`, `update([...])`, `getPojo()` all updated; `hashedProperties` decision made
- [ ] `becca_loader.ts` SELECT lists the column in the **same position** as `update([...])` (notes/branches/attributes only)
- [ ] spec written (see [assets/migration-spec.template.ts](../assets/migration-spec.template.ts))
- [ ] `pnpm --filter server test packages/trilium-core/src/migrations/...` green; `migrations.spec.ts` (unique+descending guard) still green
