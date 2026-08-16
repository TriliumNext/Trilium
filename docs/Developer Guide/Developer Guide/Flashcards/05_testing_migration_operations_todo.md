# Flashcards testing, migration, and operations TODO

## Pure domain/FSRS tests

- [ ] Test note-to-card parsing and validation with empty, rich, attachment, protected, malformed, and oversized content.
- [ ] Test FSRS adapter golden vectors for all four ratings and all card states.
- [ ] Test preview purity: no DB writes, no entity changes, no review rows.
- [ ] Test canonical UTC conversion, local day boundary, DST, leap day, and short-term minute/hour intervals.
- [ ] Test desired-retention/max-interval/steps validation and invalid serialized parameters.
- [ ] Test algorithm version dispatch and unsupported-version failure.
- [ ] Test fuzz deterministically disabled in vectors and enabled behavior bounded by expected interval range.

## Core/server tests

- [ ] Add core service specs beside flashcard service modules.
- [ ] Add migration spec under `packages/trilium-core/src/migrations/`.
- [ ] Add API specs under `packages/trilium-core/src/routes/api/flashcards.spec.ts`.
- [ ] Test creation, editing, deck move, suspend, reset, delete, and orphan repair.
- [ ] Test review transaction updates card and inserts exactly one log.
- [ ] Test duplicate `clientRequestId` returns original result.
- [ ] Test stale revision returns `409` and performs no write.
- [ ] Test two cards in one deck, many decks, pagination, limits, overdue order, and empty queue.
- [ ] Test protected source note and protected-session expiration.
- [ ] Test no front/back leakage in errors/logs/metrics.

## Sync and cross-runtime tests

- [ ] Test entity registration and Becca load/update/delete lifecycle.
- [ ] Test initial sync, incremental sync, sector retry, content hash, backup restore, and erased rows.
- [ ] Test review and card changes pulled in either order.
- [ ] Test conflicts from two devices with stale revisions.
- [ ] Run core specs in both server and standalone suites; core has no independent runner.
- [ ] Test SQL.js/browser migration and standalone worker request path.
- [ ] Test mobile request routing assumptions, including iOS `capacitor:` interceptor path.
- [ ] Test desktop custom protocol route handling.

## Client tests

- [ ] Add component specs for authoring, reveal, rating controls, previews, conflict, protected state, and empty queue.
- [ ] Add command/global-menu/mobile-menu specs.
- [ ] Add API service specs for all endpoints, CSRF retry, timeout, `409`, `403`, and `404`.
- [ ] Test sync refresh while review dialog is open.
- [ ] Test accessibility roles, keyboard flow, focus, disabled mutation state, and live progress announcements.
- [ ] Test responsive rendering at desktop/mobile widths and long translations.
- [ ] Test no duplicate submission after double-click, Enter key, or network retry.

## Fixtures and migration safety

- [ ] Add a small fixture with existing notes and no flashcard tables; assert no cards are created automatically.
- [ ] Add fixture with opted-in cards and reviews; assert migration preserves IDs/state.
- [ ] Add fixture with cloned/multi-parent source note; assert chosen identity semantics.
- [ ] Add invalid/orphan fixture; assert startup repair reports and safely repairs/quarantines rows.
- [ ] Test rollback when migration fails halfway.
- [ ] Test old app behavior against migrated DB only if sync/schema compatibility requires it.

## Performance and limits

- [ ] Benchmark due query with 10,000 and 100,000 cards and review history with realistic indexes.
- [ ] Confirm review endpoint never scans full history for a single card.
- [ ] Bound API queue/page payload and standalone memory usage.
- [ ] Measure sync payload growth from append-only reviews; define retention/compaction policy before production.
- [ ] Add metrics for due query duration, review conflicts, duplicate requests, invalid states, and migration repair counts without card text.

## Verification commands

- [ ] `pnpm --filter server test <flashcard-or-migration-pattern>`
- [ ] `pnpm --filter standalone test <flashcard-or-core-pattern>`
- [ ] `pnpm --filter client test <flashcard-pattern>` or the repository's client filter name
- [ ] `pnpm typecheck`
- [ ] `pnpm dev:format-check`
- [ ] Never run ESLint; never run full `test:all`, `test:parallel`, `test:sequential`, or coverage during development unless explicitly requested.

## Release checklist

- [ ] Add user/developer docs and release note.
- [ ] Include dependency license attribution.
- [ ] Document database migration and downgrade limitation.
- [ ] Test backup/restore before release.
- [ ] Test sync between previous release and flashcard-enabled release according to supported compatibility policy.
- [ ] Add feature flag only if rollout risk warrants it; do not hide core UI behind a permanent experimental flag.
- [ ] Review privacy implications of synced learning history.
