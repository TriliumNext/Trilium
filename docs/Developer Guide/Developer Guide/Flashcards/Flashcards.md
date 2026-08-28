# Flashcards

Flashcards add Anki-like spaced retrieval to normal Trilium notes. The source note remains the editable content object, while synchronized flashcard rows store scheduling state and append-only review history.

## User-facing model

- A note becomes a flashcard only when the user explicitly adds it through the note action or menu command.
- Basic cards use the note title as the front and the note content as the back.
- Cloze cards use `{{cN::text}}` markers in the note content. Each canonical cloze index produces one card with ordinal `N - 1`.
- Decks are ordinary notes. Each card stores a `deckNoteId`; moving notes in the tree does not silently move card history.
- Filtered decks are saved-search notes carrying `#flashcardFilteredDeck` and `searchString`. Membership is query-derived, so direct per-card assignment is rejected.
- Manual and drag scheduling update the due timestamp with the same optimistic revision checks as reviews.

## Scheduling architecture

Scheduling is server-authoritative and implemented in `packages/trilium-core/src/services/flashcards/`.

- `flashcards` stores one row per card with FSRS state, due time, deck, source note, scheduler config snapshot, and scheduling revision.
- `flashcard_reviews` stores append-only history with before/after scheduling snapshots.
- Clients submit ratings with `expectedSchedulingRevision` and `clientRequestId`.
- Stale submissions return `409`; duplicate request IDs return the original review result.
- FSRS math uses `ts-fsrs@5.4.1` through the adapter in `fsrs_scheduler.ts`.
- Scheduler defaults and validation live in the synced `flashcardSchedulerConfig` option.

Do not write either table directly. Use `flashcard_service.ts` so entity changes are produced for sync and consistency checks can repair missing source/deck notes.

## Review UI

The shared Preact dialog in `apps/client/src/widgets/dialogs/flashcards.tsx` drives review sessions for server, desktop, standalone, and mobile.

Important UI rules:

- Queue payloads omit answers until reveal where possible.
- Protected or missing source notes must surface safe errors without note content.
- Rating buttons appear after reveal and are disabled while mutations are running.
- Sync changes while the dialog is open refresh the queue.
- Current front/back rendering uses the sanitizer and `RawHtml`; imported Anki fronts are stored in `flashcardFrontHtml`.

## Portability

### Trilium JSON

`GET /api/flashcards/export` exports card scheduling state and review history. `POST /api/flashcards/import` imports it with merge semantics. It does not duplicate note content.

### Anki `.apkg` import

Anki import is routed through the dedicated import provider and `packages/trilium-core/src/services/import/anki.ts`.

Supported data:

- legacy `collection.anki2` and current `collection.anki21` / Zstandard `collection.anki21b` packages;
- legacy JSON and schema-15+ protobuf note/card templates;
- rendered fronts, backs, cloze text, per-card deck placement, tags, and referenced media;
- current Anki scheduling state as initial Trilium card state;
- bounded Anki `revlog` rows as Trilium review history.

Future reviews continue with Trilium FSRS. Imported CSS is preserved as visible escaped metadata rather than applied globally.

### Anki `.apkg` export

`GET /api/flashcards/export/anki` writes an Anki-compatible package through `anki_export.ts`:

- `collection.anki2` SQLite database built in an isolated writable database;
- default basic and cloze note types;
- decks, notes, cards, scheduling state, and review log rows;
- referenced Trilium attachments rewritten into Anki media entries.

Both server and standalone use the same core exporter. Providers expose isolated database creation and serialization so the live Trilium database is never swapped or mutated.

## Privacy and operations

Flashcard rows sync like other entities. They contain source/deck IDs, ratings, timestamps, optional answer duration, scheduler snapshots, and request IDs. They do not copy note titles, fronts, backs, or attachment bytes into review history.

Migration is additive and one-way. Users must keep a pre-upgrade backup before opening a database with a flashcard-enabled release if downgrade might be needed.

Release verification still needs backup/restore and supported mixed-version sync policy checks before public rollout.

## Test scope

Core specs must run in both runtimes because `packages/trilium-core` is shared by server, desktop, and standalone:

```bash
pnpm --filter server test flashcards.spec
pnpm --filter standalone test flashcards.spec
pnpm --filter client test flashcards.spec
pnpm typecheck
```

Do not run full suites or ESLint during routine development; CI covers those.

## Third-party notices

Flashcards depend on MIT-licensed `ts-fsrs` and `fzstd`. See `06_third_party_notices.md` for reproduced notices and pinned source links.
