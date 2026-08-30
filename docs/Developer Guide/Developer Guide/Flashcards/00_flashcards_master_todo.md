# Flashcards / spaced retrieval implementation TODO

Status: release scope implemented on `feature/flashcards-fsrs`. Runtime FSRS optimization is explicitly out of scope for this release.

Goal: add Trilium-native flashcards with Anki-like review flow and FSRS scheduling, while preserving note editing, protection, cloning, sync, standalone, desktop, and mobile behavior.

## Implemented product shape

- [x] Release scope: basic note cards, cloze cards, note-scoped templates, filtered decks, Anki/JSON portability, leech management, manual scheduling, and external FSRS parameter import are implemented. Runtime FSRS optimization remains deferred.
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

## Post-MVP extensions and deferred work

- [x] Multiple cards per note via cloze deletions and note-scoped templates. Cloze uses `{{cN::text}}` syntax, index N → ordinal N-1, rich-text toolbar insertion, and sync reconciliation. Templates render one basic card per configured `{{title}}`, `{{content}}`, and `{{ordinal}}` template.
- [x] Filtered decks, manual scheduling, and drag-to-day scheduling. Saved-search notes with `#flashcardFilteredDeck` and `searchString` define dynamic deck membership.
- [x] Anki `.apkg` portability. Import supports legacy/current packages, templates, media, per-card deck placement, scheduling state, and bounded review history. Export writes Anki-compatible SQLite packages with referenced media, scheduling state, and review logs. Trilium JSON export/import covers scheduling state plus review history.
- [x] Leech dashboard plus one-time threshold auto-suspend and `#flashcardLeech` marker.
- [x] Note-info flashcard status indicator.
- [x] Command/global-menu specs, logical spacing, overflow-safe layouts, narrow-screen stacking, and reduced-motion overrides.
- [x] External FSRS parameter import. Settings accept an optimized 21-weight vector from external tooling and sync it through `flashcardSchedulerConfig`.
- [x] Runtime FSRS parameter optimization is out of release scope by decision. Users can import externally optimized 21-weight vectors instead; revisit only if a supported optimizer runtime covers server, standalone/browser, and Capacitor iOS.

## Architecture findings

- Backend business logic is shared by server, desktop, and standalone in `packages/trilium-core`.
- Shared API routes are registered in `packages/trilium-core/src/routes/index.ts` and exposed through the platform route adapters.
- Existing notes/attributes use Becca entities and sync through `entity_changes`; entity constructors are registered in `packages/trilium-core/src/becca/entity_constructor.ts`.
- Server API calls from the client use `apps/client/src/services/server.ts`; client-side data mirrors use Froca/FNote.
- Due retrieval stays request-driven; no recurring maintenance scheduler owns review state.

## Decision log

- FSRS implementation: maintained `ts-fsrs@5.4.1` (MIT) behind a Trilium adapter in core; no Anki AGPL code copied.
- Initial FSRS defaults: FSRS 6 defaults, desired retention 0.90, max interval 36,500 days, fuzz enabled, short-term scheduling enabled, configurable learning/relearning steps.
- Runtime parameter optimization is out of release scope; externally optimized 21-weight vectors can already be pasted in settings. Official optimizer runtimes currently split between Node-only and cross-origin-isolated browser/WASI paths that do not cover Capacitor iOS, so Trilium does not ship server-only behavior or a homegrown trainer.
- Account-wide scheduler settings sync via the `flashcardSchedulerConfig` option; display/session preferences remain device-local/future.

## Definition of done

- [x] User marks note as flashcard, chooses deck, and sees it in due queue.
- [x] Review presents front first, reveals back, and offers Again/Hard/Good/Easy with preview intervals.
- [x] Rating atomically updates card state and appends review log.
- [x] Refresh, second-device sync, standalone, protected note, clone identity, and concurrent-review cases are covered by specs; mobile/desktop routing reuses existing shared paths.
- [x] User can inspect due/new/learning/review counts, reviewed-today count, retention, rating counts, lapses, leeches, and an accessible proportional 7-day due forecast chart.
- [x] Existing databases migrate without changing existing notes or options (additive migrations 241–243+).
- [x] Documentation explains authoring, deck selection, FSRS settings, Anki/JSON data portability, and privacy. Developer guide, user guide, release notes, dependency notices, and developer TODO docs cover the release scope.

## Investigation references

- Trilium architecture inspected: `packages/trilium-core/src/becca/`, `packages/trilium-core/src/routes/`, `packages/trilium-core/src/services/sync.ts`, `packages/trilium-core/src/services/scheduler.ts`, `apps/client/src/services/server.ts`, and `apps/client/src/widgets/`.
- Anki scheduler structure: `rslib/src/scheduler/` in [ankitects/anki](https://github.com/ankitects/anki).
- FSRS TypeScript API: [open-spaced-repetition/ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), including `repeat()`, `next()`, retrievability, rollback, forget, and reschedule helpers.
- FSRS model concepts: stability, difficulty, retrievability, four ratings, and New/Learning/Review/Relearning states from [The FSRS algorithm](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm).
