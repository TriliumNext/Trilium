# FSRS engine and scheduling TODO

## Dependency and boundary

- [ ] Add `ts-fsrs` to the package that owns scheduling (`packages/trilium-core` recommended) only after browser/standalone compatibility is verified.
- [ ] Pin exact version; record upstream MIT license and copyright in dependency notices if required by project policy.
- [ ] Do not copy Anki's AGPL scheduler implementation. Use the maintained TypeScript FSRS package or implement an independent, documented adapter.
- [ ] Confirm package does not import Node-only modules at runtime; run standalone build and tests.
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
- [ ] Implement `undo` through a transaction that restores prior card state and marks/removes the associated review according to the chosen audit policy.
- [ ] Implement reset/forget with explicit user confirmation and preserve audit history unless policy says otherwise.
- [ ] Add deterministic test clock and disable fuzz in algorithm unit tests; separately test fuzz-enabled production configuration.

## Configuration

- [ ] Start with FSRS 6 defaults and document them:
  - [ ] desired retention default `0.90`
  - [ ] maximum interval default `36500` days
  - [ ] fuzz enabled
  - [ ] short-term scheduling enabled
  - [ ] explicit learning/relearning step defaults
- [x] Define validation ranges and error messages for retention, max interval, steps, and parameters.
- [x] Persist user-editable serialized parameters in synced `flashcardSchedulerConfig` option.
- [x] Expose algorithm settings through server validation, not arbitrary client JSON.
- [ ] Decide whether per-deck overrides are supported. MVP recommendation: one account-wide configuration, with deck overrides deferred.
- [ ] Add “ignore reviews before” only when migration/import needs it.

## Scheduling policy outside FSRS

- [ ] Define local-day calculation and rollover hour using existing Trilium locale/time utilities; do not use browser-only local state as authority.
- [x] Define queue ordering: review cards, learning/relearning short-term cards, then new cards, each with due/card ID tie-breakers.
- [ ] Define daily limits and counters. Prevent duplicate cards in one session.
- [ ] Define maximum response size and pagination for large decks.
- [ ] Define suspended cards and cards whose source note is unavailable.
- [ ] Define overdue behavior and whether API returns exact overdue days.
- [x] Define leech detection threshold and action: cards with 8+ lapses are marked `#flashcardLeech` and auto-suspended after review.
- [ ] Keep scheduling policy separate from FSRS math so future algorithms can coexist.

## Optional optimization phase

- [ ] Do not add parameter optimization to MVP.
- [ ] Research `@open-spaced-repetition/binding` runtime support and licensing separately; it may not be suitable for standalone/mobile.
- [ ] Add minimum review-count/data-quality checks before exposing optimization.
- [ ] Run optimization server-side with `TaskContext` progress and cancellation.
- [ ] Store old parameters, new parameters, training range, and optimizer version.
- [ ] Provide reschedule preview before changing existing due dates.
- [ ] Add rollback and health checks; never silently rewrite all cards.

## Algorithm compatibility tests

- [ ] Build golden vectors from `ts-fsrs` for new, learning, review, relearning, lapse, overdue, and each rating.
- [ ] Test exact dates around midnight, DST changes, leap days, and short-term minute/hour steps.
- [ ] Test old persisted algorithm versions through explicit migration/adapters.
- [x] Test malformed persisted state and corrupted parameter JSON.
- [ ] Test no-op preview does not write DB rows or entity changes.
- [ ] Test applying same `clientRequestId` twice returns same result without a second review.
- [ ] Test stale revision returns conflict and leaves card unchanged.
