# Flashcards backend, sync, and API TODO

## Database and migration

- [x] Add next migration after current `240` in `packages/trilium-core/src/migrations/migrations.ts`.
- [x] Add `flashcards` and `flashcard_reviews` tables, indexes, constraints, and comments.
- [ ] Decide whether review logs are soft-deleted or immutable; make erase/backup behavior explicit.
- [ ] Add migration test from an old database fixture and fresh-database test.
- [ ] Keep schema definitions and migration SQL aligned with repository conventions.
- [x] Add startup repair/validation for orphaned cards and missing/deleted source or deck notes. Duplicate idempotency key repair remains future work.

## Core service

- [x] Create `packages/trilium-core/src/services/flashcards/` with:
  - [x] `flashcard_service.ts` — materialization, authoring, deck assignment, lifecycle.
  - [x] due queue, limits, ordering, and day boundary implemented in `flashcard_service.ts`; split to `flashcard_scheduler_service.ts` only if the module grows further.
  - [ ] `flashcard_review_service.ts` — transaction, idempotency, optimistic concurrency, audit log.
  - [x] input/state/config validation implemented in `flashcard_service.ts` and `fsrs_scheduler.ts`; split to `flashcard_validation.ts` only if reuse grows.
  - [x] `fsrs_scheduler.ts` — isolated adapter from `02_fsrs_engine_todo.md`.
- [x] Keep all writes inside existing SQL transaction/CLS conventions.
- [x] Use Becca/cache access for notes and attributes; do not bypass cache for normal note data.
- [x] Never read protected content without `note.isContentAvailable()`.
- [ ] Add events for card created/changed/reviewed/suspended if client live refresh needs them.
- [ ] Avoid a process-local only queue. Due-card discovery must work after restart and on any synced device.

## Entity and sync wiring

- [x] Add shared row interfaces and API DTOs in `packages/commons/src/lib/`.
- [x] Add Becca entities and registration if dedicated tables are selected.
- [x] Update Becca loader for initial load, entity change sync, deletion, and post-processing.
- [x] Update `entity_changes` fill/repair paths so old databases can reconstruct flashcard changes.
- [ ] Update content hash and sector handling for new entity names.
- [ ] Verify server sync endpoint accepts, serializes, applies, and hashes new entities.
- [ ] Verify standalone SQL.js schema/migrations and sync behavior.
- [ ] Ensure review history remains bounded per response and does not create oversized sync pages.
- [ ] Test simultaneous reviews on two devices; choose conflict rule (recommended: reject stale mutation, then refetch/retry).

## Shared API routes

Add routes in `packages/trilium-core/src/routes/api/flashcards.ts`, then register in `packages/trilium-core/src/routes/index.ts` with existing auth/CSRF wrappers.

- [x] `GET /api/flashcards/decks` — list decks/counts, never expose protected content unless authorized.
- [x] `POST /api/flashcards/cards` — opt note into flashcards/materialize card.
- [x] `GET /api/flashcards/due` — paginated due queue with safe note metadata and front content.
- [x] `GET /api/flashcards/:cardId` — card state, source note references, and legal previews.
- [x] `DELETE /api/flashcards/notes/:noteId/cards` — remove note-owned flashcards and marker label.
- [x] `GET /api/flashcards/:cardId/preview` — four FSRS outcomes, read-only.
- [x] `POST /api/flashcards/:cardId/reviews` — rating, optional duration, `clientRequestId`, expected revision.
- [x] `POST /api/flashcards/reviews/undo` — undo most recent eligible review.
- [x] `PUT /api/flashcards/:cardId/suspended` — suspend/unsuspend.
- [x] `POST /api/flashcards/:cardId/reset` — reset scheduling, preserve history by policy.
- [x] `PUT /api/flashcards/:cardId/deck` — move card/deck.
- [x] `GET /api/flashcards/stats` — aggregate counts/retention without front/back text.
- [x] `GET/PUT /api/flashcards/settings` — validated account-wide FSRS settings stored in synced option.
- [x] Add request/response interfaces in commons; do not duplicate anonymous shapes in client/server.
- [x] Return `409` for stale card revision and document recovery response.
- [x] Return safe `404/403` for deleted/protected/unavailable source notes without leaking front/back content.
- [ ] Add Swagger/OpenAPI annotations if this API is externally documented.

## Server jobs and maintenance

- [ ] Do not schedule every user's review from `services/scheduler.ts`; due status is derived on read.
- [ ] Add low-frequency maintenance only for cleanup/repair/statistics materialization, guarded by CLS and safe-mode rules.
- [ ] Add optional notification hook later; no OS tray/mobile notification in MVP.
- [ ] Add task progress for expensive migration, rebuild, export, or optimization operations.
- [ ] Define behavior when two server instances share sync data and both run maintenance.

## External API and scripts

- [ ] Decide whether ETAPI exposes flashcards in first release. If yes, add versioned DTOs and compatibility tests.
- [ ] Decide whether backend/frontend scripting APIs can create cards or submit reviews. If yes, validate permissions and prevent scripts from bypassing review concurrency.
- [ ] Add commands/events that scripts can invoke without exposing internal FSRS objects.

## Security and privacy

- [x] Authorize every card by source note visibility/protection.
- [ ] Do not include front/back in server logs, errors, entity hashes, metrics labels, or analytics payloads.
- [ ] Sanitize/render HTML using existing note renderer rules; avoid introducing a second unsafe HTML path.
- [ ] Rate-limit review mutations enough to prevent accidental loops, but do not block normal rapid short-term reviews.
- [x] Validate all IDs as Trilium IDs and all pagination/limit values.
- [x] Ensure deleted source notes cannot leave review endpoints exposing cached text.
