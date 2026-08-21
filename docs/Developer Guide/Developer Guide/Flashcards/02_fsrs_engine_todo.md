# FSRS engine and scheduling TODO

## Dependency and boundary

- [x] Add `ts-fsrs` to the package that owns scheduling (`packages/trilium-core`) after browser/standalone compatibility was verified by standalone core specs.
- [x] Pin exact version (`ts-fsrs@5.4.1`); upstream package is MIT licensed.
- [x] Do not copy Anki's AGPL scheduler implementation. Use the maintained TypeScript FSRS package behind Trilium's adapter.
- [x] Confirm package does not import Node-only modules at runtime; standalone tests exercise the adapter under SQL.js/browser runtime.
- [x] Wrap library API in `packages/trilium-core/src/services/flashcards/fsrs_scheduler.ts`; no route, widget, or entity should call `ts-fsrs` directly.
- [x] Store algorithm name/version and serialized parameter set with user configuration/card output. Never assume future library defaults equal historical defaults.

## Adapter contract

- [x] Define pure types for `FlashcardState`, `ReviewRating`, `ReviewPreview`, `ReviewResult`, and `FSRSConfig` in commons or core as appropriate.
- [x] Convert persisted UTC timestamps to `Date` only at adapter boundary and convert results back to canonical UTC values.
- [x] Validate persisted state before scheduling: finite stability/difficulty, valid enum, non-negative counters, valid due/last-review, bounded parameter values.
- [x] Normalize rating input to `Again=1`, `Hard=2`, `Good=3`, `Easy=4`; reject `Manual` and out-of-range values from review endpoints.
- [x] Implement `preview(card, now)` using `repeat()` and return all four outcomes with interval, due time, state, and human-readable label data.
- [x] Implement `applyRating(card, now, rating)` using `next()` and return new card plus exact review log.
- [x] Implement retrievability display through `get_retrievability()` without changing stored state.
- [x] Implement `undo` through a transaction that restores prior card state and preserves the associated review as audit history.
- [x] Implement reset/forget with explicit user confirmation and preserve audit history unless policy says otherwise.
- [x] Add deterministic test clock and disable fuzz in algorithm unit tests; production default keeps fuzz enabled.

## Configuration

- [x] Start with FSRS 6 defaults and document them:
  - [x] desired retention default `0.90`
  - [x] maximum interval default `36500` days
  - [x] fuzz enabled
  - [x] short-term scheduling enabled
  - [x] explicit learning/relearning step defaults
- [x] Define validation ranges and error messages for retention, max interval, steps, and parameters.
- [x] Persist user-editable serialized parameters in synced `flashcardSchedulerConfig` option.
- [x] Expose algorithm settings through server validation, not arbitrary client JSON.
- [x] Decide whether per-deck overrides are supported. Decision: one account-wide configuration for MVP; deck overrides deferred.
- [x] Add “ignore reviews before” only when migration/import needs it. Decision: not needed until import/optimizer work starts.

## Scheduling policy outside FSRS

- [x] Define local-day calculation and rollover hour using existing Trilium locale/time utilities; do not use browser-only local state as authority.
- [x] Define queue ordering: review cards, learning/relearning short-term cards, then new cards, each with due/card ID tie-breakers.
- [x] Define daily limits and counters. Due queue enforces account-wide new/review daily limits with learning/relearning still prioritized separately; SQL card IDs keep queue entries unique.
- [x] Define maximum response size and pagination for large decks.
- [x] Define suspended cards and cards whose source note is unavailable.
- [x] Define overdue behavior and whether API returns exact overdue days. Overdue cards are ordered by due timestamp; exact overdue-day display can be derived client-side from UTC due.
- [x] Define leech detection threshold and action: cards with 8+ lapses are marked `#flashcardLeech` and auto-suspended after review.
- [x] Keep scheduling policy separate from FSRS math so future algorithms can coexist.

## Optional optimization phase

- [x] Do not add parameter optimization to MVP.
- [x] Research `@open-spaced-repetition/binding` runtime support and licensing separately if optimization returns to scope; deferred because optimization is not MVP.
- [x] Add minimum review-count/data-quality checks before exposing optimization; deferred with optimization.
- [x] Run optimization server-side with `TaskContext` progress and cancellation; deferred with optimization.
- [x] Store old parameters, new parameters, training range, and optimizer version; deferred with optimization.
- [x] Provide reschedule preview before changing existing due dates; deferred with optimization.
- [x] Add rollback and health checks; never silently rewrite all cards; deferred with optimization.

## Algorithm compatibility tests

- [x] Build golden vectors from `ts-fsrs` for deterministic new/review scheduling and each rating; broader old-algorithm vectors can be added when another algorithm version exists.
- [x] Test exact dates around midnight, leap days, and short-term minute/hour steps through UTC boundary coverage.
- [x] Test old persisted algorithm versions through explicit migration/adapters. No old algorithm version exists yet; adapters must add tests when introduced.
- [x] Test malformed persisted state and corrupted parameter JSON.
- [x] Test no-op preview does not write DB rows or entity changes.
- [x] Test applying same `clientRequestId` twice returns same result without a second review.
- [x] Test stale revision returns conflict and leaves card unchanged.
