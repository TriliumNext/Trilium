# Flashcards client and review experience TODO

## Authoring

- [x] Add explicit “Make flashcard” / “Remove flashcard” action to existing note actions, mobile detail menu, and suitable context menus.
- [x] Add front/back editor using existing Preact form components and per-component CSS. Decision: MVP front is the note title and back is the note content; no dedicated card editor.
- [x] Show card/deck status in the note info tab without replacing normal note editing.
- [x] Support protected notes with clear locked-state UI; the server refuses locked/missing sources without leaking content, and the dialog surfaces safe errors instead of stale answers.
- [x] Preserve normal CKEditor note content and attachments. Decision: front/back use the note title/content directly; no separate card storage.
- [x] Add clone/move/delete lifecycle prompts where card identity/state is affected. Removing flashcards asks for confirmation; deletion/move repair is server-side via consistency checks.

## Review surface

- [x] Add review command reachable from global menu, keyboard action, launcher, and note action.
- [x] Add responsive review page/dialog usable in desktop, mobile, and standalone.
- [x] Render front first; reveal back with explicit action and keyboard shortcut.
- [x] Render Again/Hard/Good/Easy buttons only after reveal unless product decision says otherwise.
- [x] Show next intervals before submission, using API preview and server canonical time.
- [x] Show current deck/session progress and remaining due/new counts.
- [x] Keep review content isolated from normal note pane so switching notes cannot submit a rating for wrong card. The review dialog owns its queue, guards duplicate submissions with a synchronous mutation lock, and refreshes on synced flashcard changes.
- [x] Support keyboard shortcuts and screen-reader labels for reveal and ratings.
- [x] Disable buttons during mutation; handle retry without duplicate review through `clientRequestId`.
- [x] Handle `409` stale state by refetching card and asking user whether to continue, never silently replacing state.
- [x] Add undo for the latest review with clear conflict handling. Timeout polish remains future work.
- [x] Add suspend/reset/skip-today only after core review flow is stable.

## Deck browser and statistics

- [x] Add due/new/learning/review deck list with counts.
- [x] Add “study now” action and empty state using shared `NoItems`.
- [x] Add basic stats: reviewed today, retention, reviews by rating, lapses, leeches, and an accessible proportional seven-day due forecast chart.
- [ ] Use shared `Table`, `Badge`, `ActionButton`, `Dropdown`, `FormSelect`, and `FormTextBox` where applicable. Deck cards use `Badge`, deck move uses `FormSelect`, and filtered-deck/manual-date fields use `FormTextBox`; fuller stats/browser UI still needs component pass.
- [x] Avoid inline styles; add matching CSS files and scoped root classes.
- [x] Virtualize large due lists or fetch one card at a time; never load every answer into DOM unnecessarily. Due queue is capped to review batches, omits answers until reveal, and refills after the batch drains.
- [ ] Do not expose raw review-log internals in regular UI; provide a developer/export view later.

## Navigation and commands

- [x] Add command names/types in `apps/client/src/components/app_context.ts` or the current command registry.
- [x] Add default keyboard actions through existing keyboard action definitions.
- [x] Add global menu item in `apps/client/src/widgets/buttons/global_menu.tsx`.
- [x] Add note-level action in `apps/client/src/widgets/ribbon/NoteActions*` and mobile equivalent.
- [x] Add command/global-menu/mobile-menu tests for shared and layout-specific entry points.
- [x] Ensure commands work when no note is active, when active note is protected, and when in a popup. The global command opens the due queue without note context; locked note actions are disabled; scoped load failures render a safe alert; and note actions dispatch the app-global command from quick-edit popups.

## Client data and events

- [x] Add a typed flashcards client service wrapping `services/server.ts`.
- [x] Keep server as scheduling authority; client may cache queue/preview briefly but must invalidate after review/sync. The dialog refetches stats/queue after every review, conflict, and synced flashcard change.
- [x] Subscribe to entity/review events or refetch on `entitiesReloadedEvent` as appropriate.
- [x] Handle sync changes while review is open; stale card revision must surface as conflict. Covered by dialog specs for queue refresh and conflict handling.
- [x] Support standalone request bridge and mobile iOS interceptor path without adding Node/browser-only APIs. The client service uses plain fetch through shared internals.
- [x] Add flashcard settings page for account-wide FSRS scheduling options.
- [x] Do not use `localStorage` for deck settings, scheduling state, or review progress.

## Internationalization and accessibility

- [x] Add new client strings only to `apps/client/src/translations/en/translation.json`.
- [x] Reuse `common` labels where existing; create dedicated `flashcards.*` namespace for new strings.
- [x] Translate rating names, states, intervals, due counts, errors, conflict messages, and protected-state text.
- [ ] Use `Trans` if translated text embeds note/deck links or reordered components. No embedded links yet; revisit when deck titles become links.
- [x] Ensure focus moves to answer/reveal/rating controls predictably.
- [x] Use semantic headings, `aria-live` for result/progress updates, and visible focus states. Stats and card pane announce via `aria-live="polite"`; footer buttons receive focus per phase.
- [x] Harden RTL, long translations, high zoom, reduced motion, and mobile narrow widths: use logical spacing, overflow-safe grids/text, stacked narrow-screen controls, scoped CSS, and reduced-motion overrides. Final visual smoke testing remains in the release checklist.

## Optional future UI

- [ ] Card template editor and multiple cards per note.
- [x] Cloze review rendering (server-rendered elisions, cloze number in card meta, background sync on note-scoped open).
- [x] Cloze editor toolbar integration: wraps selected rich text, inserts a selected `text` placeholder at a collapsed caret, and increments the highest canonical `cN` index.
- [x] Filtered/custom study decks backed by saved-search notes and current query membership.
- [x] Manual and drag due-date scheduling: Reschedule opens a date field, and the current card can be dragged onto a seven-day forecast target. Both use `PUT /api/flashcards/cards/:cardId/due` with optimistic revision conflict protection; the manual field remains the keyboard-accessible path.
- [x] Leech dashboard with on-demand loading, unsuspend, and note-scoped review actions.
- [ ] FSRS optimizer progress/results UI.
- [x] Trilium JSON export/import of scheduling state and review history (settings page). Anki `.apkg` wizard remains future work.
- [ ] Anki `.apkg` import/export wizard. Generic file import now accepts legacy schema-11 and current Zstandard/schema-18 packages, recreates nested deck/card content, preserves tags and cloze markup, and starts imported cards with current FSRS defaults. Import filters media before extraction, bounds collection size/note count, and cleans partial trees after failure. Referenced back/cloze images, files, and `[sound:]` resources become bounded Trilium attachments. Template-only/front-rich media and CSS, multiple Anki templates, per-card deck placement, scheduling history, export, and a dedicated option wizard remain.
