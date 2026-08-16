# Flashcards / spaced retrieval implementation TODO

Status: investigation complete; implementation not started.

Goal: add Trilium-native flashcards with Anki-like review flow and FSRS scheduling, while preserving note editing, protection, cloning, sync, standalone, desktop, and mobile behavior.

## Recommended product shape

- [ ] Confirm MVP scope: one question/answer card per source note first; defer cloze, sibling card templates, filtered decks, burying, leeches, importing, and FSRS parameter optimization until core review flow works.
- [ ] Use ordinary Trilium notes as card content and a first-class synchronized card-state entity for scheduling. Do not store review state in labels or `localStorage`.
- [ ] Use note hierarchy or an explicit deck relation to select decks. Keep card identity separate from branch identity so cloned notes and multi-parent notes have deliberate semantics.
- [ ] Require explicit opt-in (`#flashcard` or equivalent) so existing notes never become review items accidentally.
- [ ] Keep review history append-only and synced. A review must be idempotent or rejected when the client submits a stale card revision.
- [ ] Make review UI usable in server, desktop, standalone, and mobile layouts.

## Delivery order

1. [ ] Resolve product decisions in `01_product_and_data_model_todo.md`.
2. [ ] Add dependency/license decision and pure FSRS adapter in `02_fsrs_engine_todo.md`.
3. [ ] Add schema, Becca entity registration, sync handling, service, API, and migration in `03_backend_sync_api_todo.md`.
4. [ ] Add authoring, deck browser, review session, statistics, commands, and translations in `04_client_review_experience_todo.md`.
5. [ ] Add cross-runtime tests, migration tests, sync tests, accessibility checks, and operational safeguards in `05_testing_migration_operations_todo.md`.
6. [ ] Run narrow server + standalone tests, client tests, `pnpm typecheck`, and format check. Never run ESLint or full suites during development.

## Non-negotiable invariants

- [ ] Every state-changing write goes through a service/entity path that creates `entity_changes`; no direct untracked DB writes.
- [ ] Card state and review history must survive sync and database backup/restore.
- [ ] Protected source notes must not leak front/back content in APIs, search results, logs, notifications, or review history.
- [ ] FSRS calculations run from server-owned canonical time and validated persisted state; clients only request previews and submit ratings.
- [ ] Concurrent review submissions cannot silently overwrite another device's newer state.
- [ ] Timezone/DST behavior is explicit: due timestamps are UTC; “due today” is calculated using the user's configured/local day boundary.
- [ ] Algorithm version and parameter set are persisted or recoverable for every review, so future FSRS upgrades can migrate/replay safely.

## Architecture findings

- Backend business logic is shared by server, desktop, and standalone in `packages/trilium-core`.
- Shared API routes are registered in `packages/trilium-core/src/routes/index.ts` and exposed through the platform route adapters.
- Existing notes/attributes use Becca entities and sync through `entity_changes`; entity constructors are registered in `packages/trilium-core/src/becca/entity_constructor.ts`.
- Server API calls from the client use `apps/client/src/services/server.ts`; client-side data mirrors use Froca/FNote.
- `packages/trilium-core/src/services/scheduler.ts` already has hourly/daily script scheduling and maintenance intervals, but flashcard due retrieval should be request-driven first. Do not make a single server instance the only scheduler of user reviews.
- `SpacedUpdate` (`apps/client/src/services/spaced_update.ts`) is a save debounce helper, not spaced-repetition logic.
- No flashcard, FSRS, review-log, or deck implementation exists in the current source tree.

## Decision log

- Recommended FSRS implementation: use maintained `ts-fsrs` from `open-spaced-repetition` behind a small Trilium adapter; do not copy Anki's AGPL scheduler code into core.
- Recommended initial FSRS defaults: FSRS 6 defaults, desired retention 0.90, max interval 36,500 days, fuzz enabled, short-term scheduling enabled, configurable learning/relearning steps.
- Dependency must be tested in browser/standalone bundles before adoption. Pin exact version and record upstream license/attribution.
- Parameter optimization is not MVP. Add later only after review logs, export, minimum-data rules, progress reporting, and a server-safe optimizer path are specified.

## Definition of done

- [ ] User marks note as flashcard, chooses deck, and sees it in due queue.
- [ ] Review presents front first, reveals back, and offers Again/Hard/Good/Easy with preview intervals.
- [ ] Rating atomically updates card state and appends review log.
- [ ] Refresh, second device sync, standalone, mobile, backup/restore, protected note, clone, and concurrent-review cases are tested.
- [ ] User can inspect due/new/learning/review counts and basic retention history.
- [ ] Existing databases migrate without changing existing notes or options.
- [ ] Documentation explains authoring, deck selection, FSRS settings, data portability, and privacy.

## Investigation references

- Trilium architecture inspected: `packages/trilium-core/src/becca/`, `packages/trilium-core/src/routes/`, `packages/trilium-core/src/services/sync.ts`, `packages/trilium-core/src/services/scheduler.ts`, `apps/client/src/services/server.ts`, and `apps/client/src/widgets/`.
- Anki scheduler structure: `rslib/src/scheduler/` in [ankitects/anki](https://github.com/ankitects/anki).
- FSRS TypeScript API: [open-spaced-repetition/ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), including `repeat()`, `next()`, retrievability, rollback, forget, and reschedule helpers.
- FSRS model concepts: stability, difficulty, retrievability, four ratings, and New/Learning/Review/Relearning states from [The FSRS algorithm](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm).
