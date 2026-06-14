---
name: evolving-the-data-model
description: Use when adding a DB migration or a new column/field to a Becca entity in Trilium ("add a migration", "new column on notes/attributes", "ALTER TABLE", "add a field to BNote/BAttribute/BBranch", schema change). Migrations are NOT dated .sql files — they are integer-versioned entries in the DESCENDING MIGRATIONS array in packages/trilium-core/src/migrations/migrations.ts (dbVersion is auto-derived from MIGRATIONS[0]), and the schema lives at packages/trilium-core/src/assets/schema.sql. Covers the full file chain for a column-add, the hashedProperties cross-instance sync-hash hazard, CLS-wrapped JS migrations, and the spec harness.
---

# Evolving the Trilium data model

## Migrations are not dated `.sql` files — start here

The intuitive guess — dated SQL files under `apps/server` plus a matching `schema.sql` there — is wrong on both counts. **Neither of these paths exists:**

| Easy wrong guess | Reality |
|---|---|
| `apps/server/src/migrations/YYMMDD_HHMM__description.sql` | No such directory. Migrations are **not** dated `.sql` files — they're entries in the `MIGRATIONS` array (below). |
| `apps/server/src/assets/db/schema.sql` | No such file. The schema for fresh installs lives in core. |

Verified absent: `Glob apps/server/src/migrations/**` and `Glob apps/server/src/assets/db/schema.sql` both return nothing.

**Ground truth:**

- **Migrations** — `packages/trilium-core/src/migrations/migrations.ts`. One `MIGRATIONS` array of `{ version, sql, ignoreErrors? }` (SQL) or `{ version, module }` (JS) objects, kept in **DESCENDING** version order (newest first). Top entry today is `version: 238` (`migrations.ts:14`).
- **Schema for fresh installs** — `packages/trilium-core/src/assets/schema.sql`.
- **`dbVersion` is auto-derived**, never hand-bumped: `getMaxMigrationVersion()` returns `MIGRATIONS[0].version` (`migrations.ts:6-8`) → `appInfo.dbVersion` (`app_info.ts:11`) → `isDbUpToDate()` compares `dbVersion >= appInfo.dbVersion` (`migration.ts:119-129`, the comparison at `:122`).

## The two un-guarded hazards (most data-model bugs are one of these)

`migrations.spec.ts` already asserts **unique + descending** versions (`migrations.spec.ts:5-17`), so a misordered/duplicate version IS caught at CI *if you run the tests*. The genuinely silent traps are:

1. **schema.sql parity.** Fresh installs run `sql.executeScript(schema)` and **never replay migrations** (`sql_init.ts:141`, also `:238` for sync setup). A column added only via `ALTER TABLE` in a migration is **MISSING on every freshly-created DB** unless you hand-mirror it into `schema.sql`. No test compares fresh-vs-migrated schema.
2. **becca_loader positional misalignment.** `notes`, `branches`, `attributes` load via `sql.getRawRows(...)` (positional arrays) fed to `new BAttribute().update(row)`, whose destructure order must match the `SELECT` column order **exactly** (`becca_loader.ts:53` ↔ `battribute.ts:57`). Add a column to one and not the other (or in the wrong position) and every loaded entity silently gets shifted field values — no compile error, no test failure.

A third, deliberate-only hazard: changing **`hashedProperties`** breaks cross-instance sync — see below.

## Decision: what are you doing?

| Task | Files to touch | Template / reference |
|---|---|---|
| Pure schema/data fix (rename option, drop table, add index, plain `ALTER`) | `migrations.ts` (top entry) + `schema.sql` (mirror) | [assets/sql-migration.snippet.md](assets/sql-migration.snippet.md) |
| Data transform needing becca/note APIs | new `0NNN__*.ts` + `migrations.ts` (`module:` entry) | [assets/0NNN__migration.template.ts](assets/0NNN__migration.template.ts) |
| Add a **column/field** to an existing entity | migration + `schema.sql` + `rows.ts` Row + entity (property, `updateFromRow`/`update`/`getPojo`) + `becca_loader` SELECT | [references/column-add-checklist.md](references/column-add-checklist.md) |
| Change which fields are **sync-hashed** | entity `hashedProperties` only — STOP, read the hazard first | [references/sync-hash-hazard.md](references/sync-hash-hazard.md) |

## Recipe: add a migration (SQL)

1. Append a new object at the **TOP** of `MIGRATIONS` with `version: <current MIGRATIONS[0].version + 1>` (so today, `239`).
2. For `ALTER TABLE ... ADD COLUMN`, set `ignoreErrors: true` (re-running over an already-patched DB must not halt the whole transaction — see `238`/`236`, the only two entries that set it, and the `ignoreErrors` doc at `migrations.ts:359-360`).
3. **Mirror** the column/table change into `schema.sql` so fresh installs match.
4. No `appInfo` bump — `dbVersion` reads `MIGRATIONS[0]` automatically.

```ts
// migrations.ts — TOP of the MIGRATIONS array
{
    version: 239,
    sql: /*sql*/`
        ALTER TABLE notes ADD COLUMN color TEXT DEFAULT '' NOT NULL;
    `,
    ignoreErrors: true
},
```

## Recipe: add a migration (JS/TS)

Use this only when the transform needs becca/note APIs (content, attachments, relations). Pure SQL? Stay in SQL.

1. Create `packages/trilium-core/src/migrations/0NNN__<desc>.ts` with a **default-exported function**.
2. Wrap all becca/note work in `getContext().init(() => { becca_loader.load(); ... })` — without CLS context `note.save()`/`setContent()` throw. Models: `0233__migrate_geo_map_to_collection.ts:6-7`, `0234__migrate_ai_chat_to_code.ts:5-6`.
3. Reference it from `MIGRATIONS` with `{ version: N, module: async () => import("./0NNN__<desc>.js") }` — note the `.js` extension (ESM output), exactly like `migrations.ts:62-63`.
4. Add a `.spec.ts` (see the harness below).

The runner preloads JS modules (`prepareMigrations`, `migration.ts:91-99`) then runs everything inside **one** `sql.transactional` (`migration.ts:45`); a failure without `ignoreErrors` crashes the app so the user can stay on the old version.

## Spec harness — don't reinvent it

Two proven styles, both already in-tree:

- **Per-migration unit test** — fixture `test/fixtures/document.db`, insert rows, run the migration fn, assert post-state. Model: `migrations/0233__migrate_geo_map_to_collection.spec.ts`.
- **End-to-end** — `migration.migrateIfNecessary()` against `test/fixtures/document_v214.db`, assert a post-migration count. Model: `services/migration.spec.ts` (asserts `SELECT count(*) FROM blobs` is `118`).

Three harness traps, each load-bearing (copy [assets/migration-spec.template.ts](assets/migration-spec.template.ts)):

- Resolve `getSql()` **inside** `beforeEach`, not at describe-collection time — `describe` callbacks run before the suite's `initializeCore` `beforeAll`, so capturing it eagerly throws `"SQL not initialized"` (`0233__*.spec.ts:33-39` has the explanatory comment).
- `sql.rebuildFromBuffer(readFileSync(fixture))` **per test** to avoid cross-test leakage (`0233__*.spec.ts:43-44`).
- Call `becca_loader.load()` **after** raw `INSERT`s *and again after* running the migration, all inside `cls.getContext().init(...)`, so becca reflects the new DB state (`0233__*.spec.ts:112` and `:130`).

Run a single migration spec:
```
pnpm --filter server test packages/trilium-core/src/migrations/0233__migrate_geo_map_to_collection.spec.ts
```
For writing the assertions themselves, see the **writing-unit-tests** skill (real-DB vs mocked-becca, the `cls.init` pattern, single-file runner footguns) and **analyzing-coverage** for chasing the migration's uncovered branches.

## Reference map

| File | When to open |
|---|---|
| [references/column-add-checklist.md](references/column-add-checklist.md) | Adding a column/field to notes/attributes/branches — the exact 5-file chain + the `SELECT` ↔ `update([...])` positional diagram, with a full worked `attributes` example. |
| [references/sync-hash-hazard.md](references/sync-hash-hazard.md) | Touching `hashedProperties`, or deciding whether a new column should sync-hash. `generateHash()` → entity_changes → cross-instance content-hash break, with every entity's current `hashedProperties` list. |
| [assets/sql-migration.snippet.md](assets/sql-migration.snippet.md) | Copy-paste SQL `MIGRATIONS` entries (ALTER ADD COLUMN + generic DDL/data) and the paired `schema.sql` reminder. |
| [assets/0NNN__migration.template.ts](assets/0NNN__migration.template.ts) | JS/TS migration skeleton with the `getContext().init` wrapper + the `MIGRATIONS` entry snippet. |
| [assets/migration-spec.template.ts](assets/migration-spec.template.ts) | Vitest harness with all three traps pre-handled. |
