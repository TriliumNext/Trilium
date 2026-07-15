# Test database
The integration tests do not use the same database as `pnpm server:start`. Instead, the tracked fixture database lives at `packages/trilium-core/src/test/fixtures/document.db`.

## In-memory database

Even though we ship our own database, there is still the problem of one test affecting the content for the others or accidentally removing important test notes.

To avoid this, the test setup (`apps/server/spec/setup.ts`) loads the fixture into memory and operates from there. That means any changes made while tests run are never persisted to disk. Another benefit of having the database in memory is that test files can run in parallel (each vitest fork gets its own copy) without interfering with each other.

## How to make changes to the database

The database can be edited manually to add content that is relevant to the tests. To do so, run a dedicated editing server:

```
pnpm --filter server run edit-integration-db
```

This opens a server on port **8086** that attaches **directly** to the tracked fixture (`packages/trilium-core/src/test/fixtures/document.db`) via `TRILIUM_DOCUMENT_PATH`, so your changes land in the committed file — no copy step is required. Ancillary runtime files (logs, tmp, `config.ini`) still live in the git-ignored `apps/server/spec/db/`.

After finishing the desired changes, close the server (Ctrl-C) to prevent any interference with further test runs.

## The database is tracked by Git

This is intentional: any change to the database marks the file as changed in Git as well. Some tests require a specific note and it would be too wasteful to recreate it via Playwright each time. Instead the content is added manually and the tests operate directly on those notes.

To keep the database easy to track, the editing server opens it in the rollback (`DELETE`) journal mode instead of WAL (see `apps/server/src/sql_provider.ts`). This means only the single `.db` file is produced and needs to be committed — no `-wal`/`-shm` sidecars. (Those sidecars are git-ignored under the fixtures directory regardless.)

## Cleaning up the database

It's recommended to clean up any deleted notes to avoid unnecessary changes being committed. To do so go to Recent Changes in the launcher and select "Erase deleted notes now".

It's also a good idea to go to Options → Advanced → Vacuum database to clean it up.