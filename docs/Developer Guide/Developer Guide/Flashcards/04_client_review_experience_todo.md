# Flashcards client and review experience TODO

## Authoring

- [ ] Add explicit “Make flashcard” / “Remove flashcard” action to existing note actions, mobile detail menu, and suitable context menus.
- [ ] Add front/back editor using existing Preact form components and per-component CSS. Do not hand-roll repeated input/button styles.
- [ ] Show card/deck status near note title or note info without replacing normal note editing.
- [ ] Support protected notes with clear locked-state UI; never render stale cached answer after protection expires.
- [ ] Preserve normal CKEditor note content and attachments. Define whether front/back uses note title/content, structured blocks, or a dedicated card editor.
- [ ] Add clone/move/delete lifecycle prompts where card identity/state is affected.

## Review surface

- [ ] Add review command reachable from global menu, keyboard action, launcher, and note action.
- [ ] Add responsive review page/dialog usable in desktop, mobile, and standalone.
- [ ] Render front first; reveal back with explicit action and keyboard shortcut.
- [ ] Render Again/Hard/Good/Easy buttons only after reveal unless product decision says otherwise.
- [ ] Show next intervals before submission, using API preview and server canonical time.
- [ ] Show current deck/session progress and remaining due/new counts.
- [ ] Keep review content isolated from normal note pane so switching notes cannot submit a rating for wrong card.
- [ ] Support keyboard shortcuts and screen-reader labels for reveal and ratings.
- [ ] Disable buttons during mutation; handle retry without duplicate review through `clientRequestId`.
- [ ] Handle `409` stale state by refetching card and asking user whether to continue, never silently replacing state.
- [ ] Add undo with clear scope and timeout.
- [ ] Add suspend/reset only after core review flow is stable.

## Deck browser and statistics

- [ ] Add due/new/learning/review deck list with counts.
- [ ] Add “study now” action and empty state using shared `NoItems`.
- [ ] Add basic stats: reviewed today, retention, reviews by rating, due forecast, lapses.
- [ ] Use shared `Table`, `Badge`, `ActionButton`, `Dropdown`, `FormSelect`, and `FormTextBox` where applicable.
- [ ] Avoid inline styles; add matching CSS files and scoped root classes.
- [ ] Virtualize large due lists or fetch one card at a time; never load every answer into DOM unnecessarily.
- [ ] Do not expose raw review-log internals in regular UI; provide a developer/export view later.

## Navigation and commands

- [ ] Add command names/types in `apps/client/src/components/app_context.ts` or the current command registry.
- [ ] Add default keyboard actions through existing keyboard action definitions.
- [ ] Add global menu item in `apps/client/src/widgets/buttons/global_menu.tsx`.
- [ ] Add note-level action in `apps/client/src/widgets/ribbon/NoteActions*` and mobile equivalent.
- [ ] Add command tests for desktop and mobile layouts.
- [ ] Ensure commands work when no note is active, when active note is protected, and when in a popup.

## Client data and events

- [ ] Add a typed `flashcards_api.ts` client service wrapping `services/server.ts`.
- [ ] Keep server as scheduling authority; client may cache queue/preview briefly but must invalidate after review/sync.
- [ ] Subscribe to entity/review events or refetch on `entitiesReloadedEvent` as appropriate.
- [ ] Handle sync changes while review is open; stale card revision must surface as conflict.
- [ ] Support standalone request bridge and mobile iOS interceptor path without adding Node/browser-only APIs.
- [ ] Do not use `localStorage` for deck settings, scheduling state, or review progress.

## Internationalization and accessibility

- [ ] Add new client strings only to `apps/client/src/translations/en/translation.json`.
- [ ] Reuse `common` labels where existing; create dedicated `flashcards.*` namespace for new strings.
- [ ] Translate rating names, states, intervals, due counts, errors, conflict messages, and protected-state text.
- [ ] Use `Trans` if translated text embeds note/deck links or reordered components.
- [ ] Ensure focus moves to answer/reveal/rating controls predictably.
- [ ] Use semantic headings, `aria-live` for result/progress updates, and visible focus states.
- [ ] Verify RTL, long translations, high zoom, reduced motion, and mobile narrow widths.

## Optional future UI

- [ ] Card template editor and multiple cards per note.
- [ ] Cloze editor.
- [ ] Filtered/custom study decks.
- [ ] Manual due-date picker and drag scheduling.
- [ ] Leech dashboard.
- [ ] FSRS optimizer progress/results UI.
- [ ] Anki import/export wizard.
