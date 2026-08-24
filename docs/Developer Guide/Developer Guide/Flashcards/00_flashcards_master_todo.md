# Flashcards / spaced retrieval implementation TODO

Status: MVP implemented on `feature/flashcards-fsrs`. Remaining work is tracked as explicit deferred items below and in `01`–`05`.

Goal: add Trilium-native flashcards with Anki-like review flow and FSRS scheduling, while preserving note editing, protection, cloning, sync, standalone, desktop, and mobile behavior.

## Implemented product shape

- [x] MVP scope: one question/answer card per source note (`#flashcard` label); cloze, sibling templates, filtered decks, import, and FSRS parameter optimization are deferred.
- [x] Ordinary Trilium notes carry card content; dedicated synchronized entities (`flashcards`, `flashcard_reviews`) hold scheduling state. No review state in labels or `localStorage`.
- [x] Explicit `deckNoteId` per card selects decks; card identity is separate from branch identity. Missing/deleted decks repair to `root`; missing/deleted sources are deleted by consistency checks.
- [x] Explicit opt-in via `#flashcard` so existing notes never become review items accidentally.
- [x] Review history is append-only and synced. Reviews are idempotent per `clientRequestId` and rejected with `409` on stale `schedulingRevision`.
- [x] Review UI runs through the shared client dialog used by server, desktop, standalone, and mobile layouts.

## Delivery order

1. [x] Product decisions resolved in `01_product_and_data_model_todo.md`.
2. [x] Dependency/license decision and pure FSRS adapter in `02_fsrs_engine_todo.md`.
3. [x] Schema, Becca entity registration, sync handling, service, API, and migration in `03_backend_sync_api_todo.md`.
4. [x] Authoring, deck browser, review session, statistics, commands, and translations in `04_client_review_experience_todo.md`.
5. [x] Cross-runtime tests, migration tests, sync tests, accessibility checks, and operational safeguards in `05_testing_migration_operations_todo.md`.
6. [x] Narrow server + standalone tests, client tests, and `pnpm typecheck` run per slice. ESLint and full suites left to CI.

## Non-negotiable invariants

- [x] Every state-changing write goes through a service/entity path that creates `entity_changes`; no direct untracked DB writes.
- [x] Card state and review history survive sync; synced erasure covered by tests.
- [x] Protected source notes do not leak front/back content in APIs, errors, logs, or review history; locked sources return safe 403/404 responses.
- [x] FSRS calculations run from server-owned canonical time and validated persisted state; clients only request previews and submit ratings.
- [x] Concurrent review submissions cannot silently overwrite another device's newer state (optimistic `schedulingRevision`).
- [x] Timezone/DST behavior is explicit: due timestamps are UTC; study-day windows derive from local time plus configured rollover hour.
- [x] Algorithm version and scheduler config snapshot are persisted on every card and review for future migration/replay.

## Deferred until after MVP

- Cloze editor and multiple cards/templates per note.
- Filtered/custom study decks, manual due-date picker, drag scheduling.
- Anki `.apkg` import/export wizard (Trilium JSON export for scheduling state decided as direction).
- Leech dashboard beyond auto-suspend plus `#flashcardLeech` marker.
- FSRS parameter optimization with optimizer runtime review.
- Note-info flashcard status indicator near the note title.
- Command/global-menu automated specs, RTL/responsive verification passes.

## Architecture findings

- Backend business logic is shared by server, desktop, and standalone in `packages/trilium-core`.
- Shared API routes are registered in `packages/trilium-core/src/routes/index.ts` and exposed through the platform route adapters.
- Existing notes/attributes use Becca entities and sync through `entity_changes`; entity constructors are registered in `packages/trilium-core/src/becca/entity_constructor.ts`.
- Server API calls from the client use `apps/client/src/services/server.ts`; client-side data mirrors use Froca/FNote.
- Due retrieval stays request-driven; no recurring maintenance scheduler owns review state.

## Decision log

- FSRS implementation: maintained `ts-fsrs@5.4.1` (MIT) behind a Trilium adapter in core; no Anki AGPL code copied.
- Initial FSRS defaults: FSRS 6 defaults, desired retention 0.90, max interval 36,500 days, fuzz enabled, short-term scheduling enabled, configurable learning/relearning steps.
- Parameter optimization is post-MVP; requires review logs (present), export format, minimum-data rules, progress reporting, and a server-safe optimizer path.
- Account-wide scheduler settings sync via the `flashcardSchedulerConfig` option; display/session preferences remain device-local/future.

## Definition of done

- [x] User marks note as flashcard, chooses deck, and sees it in due queue.
- [x] Review presents front first, reveals back, and offers Again/Hard/Good/Easy with preview intervals.
- [x] Rating atomically updates card state and appends review log.
- [x] Refresh, second-device sync, standalone, protected note, clone identity, and concurrent-review cases are covered by specs; mobile/desktop routing reuses existing shared paths.
- [x] User can inspect due/new/learning/review counts, reviewed-today count, retention, rating counts, lapses, leeches, and 7-day due forecast.
- [x] Existing databases migrate without changing existing notes or options (additive migrations 241–243+).
- [ ] Documentation explains authoring, deck selection, FSRS settings, data portability, and privacy. Developer TODO docs cover decisions; user-facing guide entry still to write before release.

## Investigation references

- Trilium architecture inspected: `packages/trilium-core/src/becca/`, `packages/trilium-core/src/routes/`, `packages/trilium-core/src/services/sync.ts`, `packages/trilium-core/src/services/scheduler.ts`, `apps/client/src/services/server.ts`, and `apps/client/src/widgets/`.
- Anki scheduler structure: `rslib/src/scheduler/` in [ankitects/anki](https://github.com/ankitects/anki).
- FSRS TypeScript API: [open-spaced-repetition/ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), including `repeat()`, `next()`, retrievability, rollback, forget, and reschedule helpers.
- FSRS model concepts: stability, difficulty, retrievability, four ratings, and New/Learning/Review/Relearning states from [The FSRS algorithm](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm).
