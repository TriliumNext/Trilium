# Database compare tool

> [!IMPORTANT]
> The original implementation was signficantly out of date. While we have made the effort of updating dependencies and getting it to run, currently it only compares the old database structure (v214).

To build and run manually:

```sh
pnpm build db-compare
node ./apps/db-compare/dist/compare.js
```

To serve development build with arguments:

```sh
pnpm dev --args "apps/server/spec/db/document_v214.db" --args "apps/server/spec/db/document_v214_migrated.db"
```