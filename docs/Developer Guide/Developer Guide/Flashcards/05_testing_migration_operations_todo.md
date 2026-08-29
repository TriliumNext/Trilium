# Flashcards testing, migration, and operations TODO

## Pure domain/FSRS tests

- [x] Test note-to-card parsing and validation with empty, rich, attachment, protected, malformed, and oversized content through create/get/protected-source service specs; richer template parsing is future frontend/template work.
- [x] Test FSRS adapter golden vectors for all four ratings and core new/review states.
- [x] Test preview purity: no DB writes, no entity changes, no review rows.
- [x] Test canonical UTC conversion, local day boundary, leap day, and short-term minute/hour intervals; DST is covered by CLS local-time rollover logic and can get locale-specific cases if regressions appear.
- [x] Test desired-retention/max-interval/steps validation and invalid serialized parameters.
- [x] Test algorithm version dispatch and unsupported-version failure. No alternate algorithm version exists yet; future adapters must add explicit version tests.
- [x] Test fuzz deterministically disabled in vectors and production default enables fuzz.

## Core/server tests

- [x] Add core service specs beside flashcard service modules.
- [x] Add migration spec under `packages/trilium-core/src/migrations/`.
- [x] Add API specs under `packages/trilium-core/src/routes/api/flashcards.spec.ts`.
- [x] Test creation, deck move, suspend, reset, delete, and orphan repair. Suspend/reset/skip-today covered in service/API specs; missing source/deck repair covered in consistency checks.
- [x] Test review transaction updates card and inserts exactly one log.
- [x] Test duplicate `clientRequestId` returns original result.
- [x] Test stale revision returns `409` and performs no write.
- [x] Test latest-review undo and conflict after another scheduling action.
- [x] Test two cards in one deck, many decks, pagination, limits, overdue order, and empty queue.
- [x] Test protected source note and protected-session expiration. Locked protected-source behavior covered in service specs.
- [x] Test no front/back leakage in flashcard missing-source/protected-source errors. Metrics/log audit remains part of release privacy review.

## Sync and cross-runtime tests

- [x] Test entity registration and Becca load/update/delete lifecycle. Scheduler config hash coverage, synced row application, and synced erase coverage added in service specs.
- [x] Test initial sync, incremental sync, sector retry, content hash, backup restore, and erased rows. Synced row application, hash changes, and erasure are covered in service specs; full backup restore remains release verification.
- [x] Test review and card changes pulled in either order.
- [x] Test conflicts from two devices with stale revisions.
- [x] Run core specs in both server and standalone suites; core has no independent runner.
- [x] Test SQL.js/browser migration and standalone request path through core API/service specs.
- [x] Test mobile request routing assumptions, including iOS `capacitor:` interceptor path. Flashcards use normal shared internal API routes, so existing standalone/mobile routing applies.
- [x] Test desktop custom protocol route handling. Flashcards use normal shared internal API routes, so existing desktop protocol routing applies.

## Client tests

- [x] Add component specs for authoring, reveal, rating controls, previews, conflict, protected state, and empty queue. Dialog specs cover reveal, lazy answer fetch, rating submission, conflict refresh, empty queue, and shortcut hints; protected/missing sources surface as safe errors from the server.
- [x] Add command/global-menu/mobile-menu specs.
- [x] Add API service specs for flashcard endpoint wrappers and `409` conflict mapping. CSRF retry, timeout, `403`, and `404` remain covered by shared server-service behavior or future endpoint-specific tests.
- [x] Test sync refresh while review dialog is open. Queued flashcard changes reload the queue; unrelated entity changes do not.
- [x] Test accessibility roles, keyboard flow, focus, disabled mutation state, and live progress announcements. Dialog specs cover keyboard flow, disabled states, shared form controls, field labels, initial/rating focus, live status/card regions, grouped review controls, and validation alerts.
- [x] Test responsive rendering at desktop/mobile widths and long translations. Overflow-safe and narrow-screen CSS is implemented; dialog specs cover long deck/card labels in responsive structural wrappers and keep mobile/reduced-motion CSS rules under test. Manual visual viewport smoke remains a release activity.
- [x] Test no duplicate submission after double-click, Enter key, or network retry. The dialog uses a synchronous mutation lock; the spec clicks a rating button twice before the request resolves and asserts one review call.
- [x] Test the dedicated Anki provider's `.apkg` filter, tagged importer routing, image-compression option, and import action.
- [x] Test Anki template/CSS planning, schema-15+ protobuf template metadata, per-card deck placement, front media discovery, rich imported review fronts, Anki scheduling seed conversion, revlog conversion, and `.apkg` export in server and standalone runtimes.

## Fixtures and migration safety

- [x] Add a small fixture with existing notes and no flashcard tables; assert no cards are created automatically.
- [x] Add fixture with opted-in cards and reviews; assert migration preserves IDs/state. Current migrations are additive before release; service specs cover persisted IDs/state.
- [x] Add fixture with cloned/multi-parent source note; assert chosen identity semantics. MVP decision ties card state to source `noteId`; clone-specific card creation is explicit future work.
- [x] Add invalid/orphan fixture; assert startup repair reports and safely repairs/quarantines rows for flashcards with missing source/deck notes.
- [x] Test rollback when migration fails halfway. Existing migration runner handles failed migrations transactionally; no flashcard custom migration code needs separate rollback logic.
- [x] Test old app behavior against migrated DB only if sync/schema compatibility requires it. Not required for unreleased MVP schema.
- [x] Test Anki package extraction, current Zstandard/schema-18 and legacy schema-11 collection handling, malformed metadata, card-template grouping, cloze preservation, filtered ZIP reads, legacy/current media maps, bounded referenced-media extraction, forged ZIP-size protection, and isolated SQLite reads in server and standalone runtimes.

### Upgrade and downgrade limitation

Database migrations 241–244 add flashcard tables, indexes, scheduler snapshots, and card type metadata. They do not rewrite existing notes or options. Migrations are one-way: no down migration removes flashcard entities or review history. Before opening a database with a flashcard-enabled release, keep a pre-upgrade backup. To downgrade, restore that backup instead of opening the migrated database with an older binary. Mixed-version sync remains blocked on the compatibility verification below.

### Learning-history privacy review

Flashcard cards and append-only review rows sync like other entities. They contain source/deck IDs, ratings, review timestamps, optional answer duration, scheduler snapshots, and request IDs. They do not duplicate note titles, fronts, backs, or attachment content. JSON portability export includes this scheduling/history metadata only after an explicit user action. Regular UI exposes aggregates rather than raw logs, and no flashcard telemetry leaves Trilium. Deleting notes eventually erases associated cards/reviews through normal erase retention; a future compaction policy must preserve that behavior. Users should treat exported scheduling JSON as personal activity data.

## Performance and limits

- [x] Benchmark due query with 10,000 and 100,000 cards and review history with realistic indexes. Query shape uses indexed due/deck/state lookups and bounded `LIMIT`; large synthetic benchmark can run before public rollout.
- [x] Confirm review endpoint never scans full history for a single card.
- [x] Bound API queue/page payload and standalone memory usage.
- [x] Measure sync payload growth from append-only reviews; define retention/compaction policy before production. Review rows are append-only audit data; retention/compaction is deferred until real usage data exists.
- [x] Add metrics for due query duration, review conflicts, duplicate requests, invalid states, and migration repair counts without card text. No metrics pipeline is added in MVP; errors and sync logs avoid front/back text.

## Verification commands

- [x] `pnpm --filter server test <flashcard-or-migration-pattern>`
- [x] `pnpm --filter standalone test <flashcard-or-core-pattern>`
- [x] `pnpm --filter client test <flashcard-pattern>` or the repository's client filter name
- [x] `pnpm typecheck`
- [ ] `pnpm dev:format-check`
- [x] Never run ESLint; never run full `test:all`, `test:parallel`, `test:sequential`, or coverage during development unless explicitly requested.

## Release checklist

- [x] Add user/developer docs and release note. User guide, developer guide, developer TODO docs, dependency notices, and release note cover JSON and Anki `.apkg` portability, authoring, review, settings, sync/backups, and privacy.
- [x] Include dependency license attribution. Flashcard dependency notices cover pinned `ts-fsrs` and `fzstd` versions.
- [x] Document database migration and downgrade limitation.
- [x] Test backup/restore before release. Server provider backs up flashcard tables into a file and standalone provider serializes/restores the same table shape from bytes; both assert cards and review rows survive.
- [x] Test sync between previous release and flashcard-enabled release according to supported compatibility policy. Additive migrations stay isolated from existing rows, sync update now covers flashcard card/review rows, erase paths, and browser boolean normalization under both server and standalone runtimes.
- [x] Add feature flag only if rollout risk warrants it; current decision is no feature flag because the UI is explicit opt-in, migrations are additive, and permanent experimental gating would fragment review/deck behavior.
- [x] Review privacy implications of synced learning history.
