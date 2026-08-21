# Flashcards product and data model TODO

## Product decisions

- [x] Decide card authoring format:
  - [x] MVP: `#flashcard` on ordinary text note; title is front and note content is back.
  - [x] Front/back are normal note title/content, not large label values.
  - [x] Empty answers render as an empty-answer state; HTML/math/attachments follow existing note rendering, and scripts are not a separate flashcard content channel.
- [x] Decide deck model:
  - [x] MVP: explicit `deckNoteId` on the flashcard row, with nearest strong parent fallback at creation time.
  - [x] Moved source notes keep card state; deleted source notes are repaired/hidden; protected notes never expose back content while locked; lost marker can be removed through controlled action.
- [x] Decide identity model:
  - [x] Stable `cardId`, separate from `noteId` and branch ID.
  - [x] One-card-per-note MVP via `ordinal = 0`; future templates/cloze can add more ordinals.
  - [x] Clone semantics: cloned note shares note content but card identity remains tied to the source `noteId`; independent cards require explicit creation on the clone.
- [x] Decide user settings:
  - [x] desired retention, maximum interval, fuzz, learning steps, relearning steps, and review order.
  - [x] daily new-card/review limits and day rollover.
  - [x] Define synced-vs-device-local settings for FSRS scheduling: learning policy syncs via `flashcardSchedulerConfig`; display/session preferences remain future/local.
- [x] Decide review behavior:
  - [x] Four ratings: Again, Hard, Good, Easy.
  - [x] Preview all four outcomes before answer, matching Anki/FSRS terminology.
  - [x] Rating before reveal is not offered by the review dialog.
  - [x] Session queue size is capped by request limit; review cards precede learning/relearning, then new cards.
  - [x] Suspend, unsuspend, bury, reset, move deck, and latest-review undo boundaries are implemented with optimistic concurrency.
- [x] Decide privacy behavior for protected notes and protected sessions.
- [x] Decide export/import format and whether Anki `.apkg` compatibility is a goal. Decision: no `.apkg` compatibility promise in MVP; future data portability should use a Trilium JSON format for scheduling state plus ordinary note export for content.

## Recommended relational model

Use dedicated synchronized entities rather than labels for mutable scheduler state. Keep note content in normal Trilium notes so normal editing, revisions, protection, backup, and note sync remain authoritative.

### `flashcards`

- [x] Add migration table with fields equivalent to:
  - `cardId TEXT PRIMARY KEY`
  - `noteId TEXT NOT NULL`
  - `deckNoteId TEXT NOT NULL`
  - `ordinal INTEGER NOT NULL DEFAULT 0`
  - `state INTEGER NOT NULL` (`new`, `learning`, `review`, `relearning` as FSRS numeric states)
  - `due TEXT NOT NULL` (UTC instant)
  - `stability REAL NOT NULL DEFAULT 0`
  - `difficulty REAL NOT NULL DEFAULT 0`
  - `elapsedDays INTEGER NOT NULL DEFAULT 0`
  - `scheduledDays INTEGER NOT NULL DEFAULT 0`
  - `learningSteps INTEGER NOT NULL DEFAULT 0`
  - `reps INTEGER NOT NULL DEFAULT 0`
  - `lapses INTEGER NOT NULL DEFAULT 0`
  - `lastReview TEXT NULL`
  - `suspended INTEGER NOT NULL DEFAULT 0`
  - `algorithm TEXT NOT NULL DEFAULT 'fsrs-6'`
  - `algorithmVersion TEXT NOT NULL`
  - `schedulerConfig TEXT NOT NULL`
  - `utcDateCreated TEXT NOT NULL`
  - `utcDateModified TEXT NOT NULL`
  - `schedulingRevision INTEGER NOT NULL DEFAULT 0`
  - `isDeleted INTEGER NOT NULL DEFAULT 0`
  - `deleteId TEXT NULL`
- [x] Add indexes for `(deckNoteId, suspended, due)`, `(noteId, ordinal)`, and due retrieval across active decks.
- [x] Decide whether `due` stores an instant or day number: store UTC instant and derive local study-day windows from CLS local time plus rollover hour.
- [x] Define uniqueness for `(noteId, ordinal)` and deck reassignment behavior.

### `flashcard_reviews`

- [x] Add append-only review log with:
  - `reviewId TEXT PRIMARY KEY`
  - `cardId TEXT NOT NULL`
  - `rating INTEGER NOT NULL` (Again=1, Hard=2, Good=3, Easy=4)
  - `state INTEGER NOT NULL` before review
  - `dueBefore TEXT NOT NULL`
  - `dueAfter TEXT NOT NULL`
  - pre/post stability, difficulty, elapsed days, scheduled days, learning steps
  - previous reps/lapses/last review/scheduling revision snapshot for undo
  - `reviewedAt TEXT NOT NULL`
  - `durationMs INTEGER NULL`
  - `algorithm TEXT NOT NULL`
  - `algorithmVersion TEXT NOT NULL`
  - `schedulerConfig TEXT NOT NULL`
  - `clientRequestId TEXT UNIQUE` for retry idempotency
- [x] Add indexes for `(cardId, reviewedAt)` and `(reviewedAt)`.
- [x] Decide whether to retain post-review state in log too: store enough pre-review and post-review data to audit without rerunning old algorithms.
- [x] Add retention/privacy policy for review logs; never log front/back text. Normal undo/reset preserves review rows; erase/delete-id paths can remove them.

### Note-to-card materialization

- [x] Define `createCard(noteId)`/existing-card materialization service operation.
- [x] Create card only after explicit opt-in, not by scanning every note on every request.
- [x] Use controlled create/remove actions and startup consistency repair instead of scanning note/attribute changes on every request.
- [x] Keep state when front/back content changes; provide “reset scheduling” as an explicit action.
- [x] Validate that protected notes are readable in current protected session before materializing or reviewing.

## Becca and sync integration checklist

- [x] Add shared row/type interfaces in `packages/commons/src/lib/`.
- [x] Add `BFlashcard` and `BFlashcardReview` entities.
- [x] Register entity constructors in `packages/trilium-core/src/becca/entity_constructor.ts`.
- [x] Add entity loading/update/delete handling in `packages/trilium-core/src/becca/becca_loader.ts` and related Becca interfaces.
- [x] Include entities in database validation, bootstrap loading, `fillAllEntityChanges`, backup, erase, and consistency checks.
- [x] Ensure review inserts generate synchronized entity changes; review rows are append-only except sync erase/delete-id paths.
- [x] Add client/Froca handling only if UI needs live entity events. API response snapshots are enough for MVP, while sync converges through entity changes.
- [x] Test pull/push ordering when a review row and card row arrive in separate batches.

## Alternative evaluated before coding

- [x] Prototype storing all flashcard state inside a note JSON blob and compare against dedicated entities conceptually.
- [x] Reject note JSON because it causes large review writes, poor due queries, unmergeable multi-device updates, and difficult history retention.
- [x] Reject labels for scheduler state because labels are user metadata, inheritance can alter meaning, values are not typed, and repeated reviews create excessive note/attribute churn.
