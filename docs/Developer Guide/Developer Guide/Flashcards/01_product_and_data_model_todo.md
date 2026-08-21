# Flashcards product and data model TODO

## Product decisions

- [ ] Decide card authoring format:
  - [ ] MVP recommendation: `#flashcard` on ordinary text note; title/content provide question/answer through an explicit editor panel or structured JSON content.
  - [ ] Define exact representation for front/back without abusing large label values.
  - [ ] Define whether empty front/back, HTML, attachments, math, included notes, and scripts are allowed.
- [ ] Decide deck model:
  - [ ] Recommendation: explicit `flashcardDeck` relation to a deck note, with nearest ancestor fallback only if product wants hierarchy-based decks.
  - [ ] Define behavior when source note is moved, cloned, deleted, archived, protected, or loses its flashcard marker.
- [ ] Decide identity model:
  - [ ] Recommendation: stable `cardId`, separate from `noteId` and branch ID.
  - [ ] Define one-card-per-note MVP and future `ordinal`/template support.
  - [ ] Define clone semantics: shared card state, independent card, or explicit conversion.
- [ ] Decide user settings:
  - [x] desired retention, maximum interval, fuzz, learning steps, relearning steps, and review order.
  - [x] daily new-card/review limits and day rollover.
  - [x] Define synced-vs-device-local settings for FSRS scheduling: learning policy syncs via `flashcardSchedulerConfig`; display/session preferences remain future/local.
- [ ] Decide review behavior:
  - [ ] Four ratings: Again, Hard, Good, Easy.
  - [ ] Preview all four outcomes before answer, matching Anki/FSRS terminology.
  - [ ] Define whether rating before reveal is allowed.
  - [ ] Define session queue size and whether new cards interleave with reviews.
  - [ ] Define manual reschedule, suspend, unsuspend, reset, and undo boundaries.
- [ ] Decide privacy behavior for protected notes and protected sessions.
- [ ] Decide export/import format and whether Anki `.apkg` compatibility is a goal. Do not promise compatibility in MVP.

## Recommended relational model

Use dedicated synchronized entities rather than labels for mutable scheduler state. Keep note content in normal Trilium notes so normal editing, revisions, protection, backup, and note sync remain authoritative.

### `flashcards`

- [ ] Add migration table with fields equivalent to:
  - `cardId TEXT PRIMARY KEY`
  - `noteId TEXT NOT NULL`
  - `deckNoteId TEXT NOT NULL`
  - `ordinal INTEGER NOT NULL DEFAULT 0`
  - `state TEXT NOT NULL` (`new`, `learning`, `review`, `relearning`)
  - `due TEXT/INTEGER NOT NULL` (UTC instant)
  - `stability REAL NOT NULL DEFAULT 0`
  - `difficulty REAL NOT NULL DEFAULT 0`
  - `elapsedDays INTEGER NOT NULL DEFAULT 0`
  - `scheduledDays INTEGER NOT NULL DEFAULT 0`
  - `learningSteps INTEGER NOT NULL DEFAULT 0`
  - `reps INTEGER NOT NULL DEFAULT 0`
  - `lapses INTEGER NOT NULL DEFAULT 0`
  - `lastReview TEXT/INTEGER NULL`
  - `suspended INTEGER NOT NULL DEFAULT 0`
  - `algorithm TEXT NOT NULL DEFAULT 'fsrs-6'`
  - `algorithmVersion TEXT NOT NULL`
  - `utcDateCreated TEXT NOT NULL`
  - `utcDateModified TEXT NOT NULL`
  - optional optimistic-concurrency `revision INTEGER NOT NULL DEFAULT 0`
- [ ] Add indexes for `(deckNoteId, suspended, due)`, `(noteId, ordinal)`, and due retrieval across active decks.
- [ ] Decide whether `due` stores an instant or day number. Recommendation: store UTC instant plus derive local “today” at query time; retain exact FSRS due output for short-term learning.
- [ ] Define uniqueness for `(noteId, ordinal)` and deck reassignment behavior.

### `flashcard_reviews`

- [ ] Add append-only review log with:
  - `reviewId TEXT PRIMARY KEY`
  - `cardId TEXT NOT NULL`
  - `rating INTEGER NOT NULL` (Again=1, Hard=2, Good=3, Easy=4)
  - `state TEXT NOT NULL` before review
  - `dueBefore INTEGER/TEXT NOT NULL`
  - `stability REAL NOT NULL`
  - `difficulty REAL NOT NULL`
  - `elapsedDays INTEGER NOT NULL`
  - `scheduledDays INTEGER NOT NULL`
  - `learningSteps INTEGER NOT NULL`
  - `reviewedAt TEXT NOT NULL`
  - `durationMs INTEGER NULL`
  - `algorithm TEXT NOT NULL`
  - `algorithmVersion TEXT NOT NULL`
  - optional `clientRequestId TEXT UNIQUE` for retry idempotency
- [ ] Add indexes for `(cardId, reviewedAt)` and `(reviewedAt)`.
- [ ] Decide whether to retain post-review state in log too. Recommendation: store enough pre-review data and the exact output to reproduce audit/statistics without rerunning old algorithms.
- [ ] Add retention/privacy policy for review logs; never log front/back text.

### Note-to-card materialization

- [ ] Define `ensureCardForNote(noteId)` and `syncCardDefinitionFromNote(noteId)` service operations.
- [ ] Create card only after explicit opt-in, not by scanning every note on every request.
- [ ] Subscribe to note/attribute changes or use a controlled command to update card definitions and remove stale cards.
- [ ] Keep state when front/back content changes; provide “reset scheduling” as an explicit action.
- [ ] Validate that protected notes are readable in current protected session before materializing or reviewing.

## Becca and sync integration checklist

- [ ] Add shared row/type interfaces in `packages/commons/src/lib/`.
- [ ] Add `BFlashcard` and `BFlashcardReview` entities or a deliberately documented alternative service-layer sync mechanism.
- [ ] Register entity constructors in `packages/trilium-core/src/becca/entity_constructor.ts`.
- [ ] Add entity loading/update/delete handling in `packages/trilium-core/src/becca/becca_loader.ts` and related Becca interfaces.
- [ ] Include entities in database validation, bootstrap loading, `fillAllEntityChanges`, backup, erase, and consistency checks.
- [ ] Ensure review inserts generate synchronized entity changes. Append-only logs may use a non-deletable entity convention; document erase behavior.
- [ ] Add client/Froca handling only if UI needs live entity events. API response snapshots are acceptable for MVP, but sync still must converge.
- [ ] Test pull/push ordering when a review row and card row arrive in separate batches.

## Alternative to evaluate before coding

- [ ] Prototype storing all flashcard state inside a note JSON blob and compare against dedicated entities.
- [ ] Reject note JSON if it causes large review writes, poor due queries, unmergeable multi-device updates, or difficult history retention.
- [ ] Reject labels for scheduler state because labels are user metadata, inheritance can alter meaning, values are not typed, and repeated reviews create excessive note/attribute churn.
