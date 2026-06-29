# SQL migration snippets

Paste a new object at the **TOP** of the `MIGRATIONS` array in
`packages/trilium-core/src/migrations/migrations.ts` (the array is kept in
**descending** order, newest first). The new `version` is
`MIGRATIONS[0].version + 1`. Do **not** bump `appInfo.dbVersion` — it is derived
from `MIGRATIONS[0].version` via `getMaxMigrationVersion()`.

## A. `ALTER TABLE ... ADD COLUMN` (needs `ignoreErrors`)

`ignoreErrors: true` lets a re-run over an already-patched DB log-and-continue
instead of crashing the single migration transaction.

```ts
// Add <column> to <table> for <reason>
{
    version: 239,
    sql: /*sql*/`
        ALTER TABLE notes ADD COLUMN color TEXT DEFAULT '' NOT NULL;
    `,
    ignoreErrors: true
},
```

Then **mirror it into `packages/trilium-core/src/assets/schema.sql`** — add the
column to the matching `CREATE TABLE`. Fresh installs run the schema directly and
never replay migrations (`sql_init.ts:141`), so a column that exists only in a
migration is missing on every new database.

## B. Generic data / DDL change (no column add)

Idempotent statements (`IF NOT EXISTS`, `DELETE`, `UPDATE`) usually do **not**
need `ignoreErrors`; add it only if re-execution could throw. Real examples in
`migrations.ts`: index creation (`235`), option cleanup (`237`), table drops
(`232`).

```ts
// Rename the 'openTabs' option to 'openNoteContexts'
{
    version: 240,
    sql: /*sql*/`
        UPDATE options SET name = 'openNoteContexts' WHERE name = 'openTabs';
        UPDATE entity_changes SET entityId = 'openNoteContexts'
            WHERE entityName = 'options' AND entityId = 'openTabs';
    `
},
```

When a DDL change alters a table's shape (new index that fresh installs should
have, dropped/renamed column, new table), reflect it in `schema.sql` too.

## Checklist

- [ ] New entry at the **top** of `MIGRATIONS`, `version` = previous top + 1
- [ ] `ignoreErrors: true` on `ALTER TABLE ... ADD COLUMN`
- [ ] `schema.sql` mirrors any structural change (column / table / index fresh installs need)
- [ ] `migrations.spec.ts` (unique + descending guard) still green
- [ ] If a column was added to notes/branches/attributes, follow the full
      [column-add checklist](../references/column-add-checklist.md)
