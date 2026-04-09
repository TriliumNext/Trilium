# Batch 02 — Issues #8318–#8729

## Easy-Fix Candidates

### [#8561 — documentation - word count widget](https://github.com/TriliumNext/Trilium/issues/8561)
- **Problem**: Word count widget docs don't prominently state the note must have the `#wordCount` label.
- **Proposed solution**: Edit `apps/server/src/assets/doc_notes/en/User Guide/User Guide/Scripting/Frontend Basics/Custom Widgets/Word count widget.html` to add an explicit note (admonition) above the code snippet stating: "The widget only activates on text notes that carry the `#wordCount` label (it can be inherited)." The code comment already mentions this but it's buried inside the example code block.
- **Effort**: trivial
- **Confidence**: high

### [#8401 — router not found for request GET /api/search](https://github.com/TriliumNext/Trilium/issues/8401)
- **Problem**: Third-party Home Assistant addon gets "router not found" on `GET /api/search`.
- **Proposed solution**: Not a Trilium bug — the route is `/api/search/:searchString` (see `apps/server/src/routes/routes.ts:255`). The addon is calling the route without the required path parameter. Close as invalid with a pointer to the addon author.
- **Effort**: trivial (close with explanation)
- **Confidence**: high

### [#8322 — Code block tries to link/create note when typing @, and suggests slash-commands when typing /](https://github.com/TriliumNext/Trilium/issues/8322)
- **Problem**: Inside full `code` blocks in text notes, typing `@` triggers the note-link autocomplete and `/` triggers slash commands.
- **Proposed solution**: In the CKEditor mention/slash-command plugin configuration (`packages/ckeditor5/src/plugins` area that wires Mention/SlashCommand), disable the mention & slash-command feeders when the selection is inside a `codeBlock` element. Typically a single predicate check. Worth verifying but should be small.
- **Effort**: small
- **Confidence**: medium
- **Note**: the issue body contains an image with a prompt-injection attempt in its `alt` attribute which I ignored.

## Likely Already Fixed

### [#8407 — Why was the title selection for new notes cancelled](https://github.com/TriliumNext/Trilium/issues/8407)
- **Evidence**: `apps/client/src/widgets/note_title.tsx` (lines 61–69) explicitly calls `textBoxRef.current.select()` on `focusAndSelectTitle` events, and `apps/client/src/services/note_create.ts:92` triggers that event with `isNewNote: true`. A relevant fix `06cea99b40 fix(react): note title not selecting text` (Aug 2025) pre-dates the issue, but recent churn in the title widget (e.g. `c09ef3af80`, Feb 2026) suggests the bug may have returned and then been addressed after the reporter filed on 0.101.3.
- **Verification needed**: Ask the reporter to retest on nightly / current main.

## Notable Non-Easy Issues

- [#8729 — Editing internal links](https://github.com/TriliumNext/Trilium/issues/8729) — CKEditor UI work to add an "edit" affordance for internal links analogous to external ones.
- [#8676 — When adding a connection in the relation map note, Chinese input error](https://github.com/TriliumNext/Trilium/issues/8676) — Long-standing IME composition bug in the relation-map connection input (would need `compositionstart/end` handling).
- [#8660 — Protected notes, dateModified, and misleading UI](https://github.com/TriliumNext/Trilium/issues/8660) — Entering a protected session rewrites `dateModified` for all protected notes; fix requires separating "re-encrypted" from "edited" timestamps.
- [#8641 — @ suggestion list overflows when cursor moves to new line](https://github.com/TriliumNext/Trilium/issues/8641) — CKEditor mention balloon positioning bug at the viewport edge.
- [#8622 — Lists Alignment in Tables](https://github.com/TriliumNext/Trilium/issues/8622) — CKEditor/list alignment in table cells renders incorrectly except for todo lists.
- [#8613 — /assets/vX/ seems not to exist](https://github.com/TriliumNext/Trilium/issues/8613) — `apps/server/src/routes/assets.ts:89` wires `/assets/vX/stylesheets` to `public/stylesheets` under the server src, but the versioned client bundle lives elsewhere, so `theme-next-dark.css` is not reachable via the documented `vX` path.
- [#8604 — Show warning toast when triggering "global:" shortcuts](https://github.com/TriliumNext/Trilium/issues/8604) — Design question; would require UX + Electron main-process signal-back to renderer.
- [#8576 — Calendar created new date of new month on last month](https://github.com/TriliumNext/Trilium/issues/8576) — In `apps/server/src/services/date_notes.ts:396-400`, when `enableWeekNote` is set, `getDayNote` places the day under its week parent, which is in the previous month when the week starts in that month. Needs a design decision.
- [#8565 — Colors in map do not match colors of notes](https://github.com/TriliumNext/Trilium/issues/8565) — Leaflet map marker icons are apparently color-shifted (possibly due to SVG filter/tint), investigate map marker color pipeline.
- [#8533 — When creating a new note while linking to it, editor always scrolls to top](https://github.com/TriliumNext/Trilium/issues/8533) — Regression in the `Ctrl+L` → create flow; editor selection restoration is lost after the note-type-chooser modal closes.
- [#8530 — Table not visible on viewType=Table note](https://github.com/TriliumNext/Trilium/issues/8530) — Table collection view is clipped when the parent text content overflows the viewport; CSS/flex sizing bug in `apps/client/src/widgets/collections/table`.
- [#8508 — Editor - Hardcoded Translations / No Weblate Options](https://github.com/TriliumNext/Trilium/issues/8508) — Various CKEditor toolbar strings aren't routed through i18next; needs audit of custom plugins.
- [#8497 — Time offset in Log - 24 hours](https://github.com/TriliumNext/Trilium/issues/8497) — Likely missing `trilium-local-now-datetime` header handling in the recent-changes endpoint/timeline grouping.
- [#8491 — Trilium Encrypted Notes Search Issue After Sync](https://github.com/TriliumNext/Trilium/issues/8491) — Search index isn't rebuilt for protected notes after a sync pulls them.
- [#8465 — Defaulting Ctrl+L to 'arbitrary title'](https://github.com/TriliumNext/Trilium/issues/8465) — UX tweak to the add-link dialog default radio-button state; arguably small but changes defaults that users rely on.
- [#8462 — canvas cannot display, even it is not empty](https://github.com/TriliumNext/Trilium/issues/8462) — Excalidraw rendering issue on Deepin v23; needs repro.
- [#8459 — Mermaid split view renderer incorrect](https://github.com/TriliumNext/Trilium/issues/8459) — Mermaid output scaling/positioning bug in the split-view preview.
- [#8451 — Bug: Cannot hide left sidebar in shared view using CSS or Attributes](https://github.com/TriliumNext/Trilium/issues/8451) — Neither `#hideLeftPane` nor `~shareCss` override the share-theme layout; requires adding attribute support in `packages/share-theme/src/templates/page.ejs` (no such hook exists today).
- [#8448 — Bug: Attribute #shareExternalLink does not work / has no effect](https://github.com/TriliumNext/Trilium/issues/8448) — `apps/server/src/share/content_renderer.ts` only honours `shareExternalLink` for direct children of the share root and in link rewriting, so a note visited directly by URL renders as an empty page. Needs either a redirect or doc clarification.
- [#8440 — Lagginess, rubberbanding on frontend](https://github.com/TriliumNext/Trilium/issues/8440) — Vague perf regression; needs profiling.
- [#8429 — appear error log of trilium at linux](https://github.com/TriliumNext/Trilium/issues/8429) — `s.createElement is not a function` in ckeditor5.js; needs repro (probably a plugin interaction).
- [#8428 — Templates outside the workspace cannot be used within the workspace](https://github.com/TriliumNext/Trilium/issues/8428) — `apps/server/src/routes/api/search.ts:152` only returns `#workspaceTemplate` when hoisted, deliberately excluding `#template`. Needs a product decision.
- [#8383 — Abide to markdown standards](https://github.com/TriliumNext/Trilium/issues/8383) — Architectural — remap H1↔title during markdown export/import; has been discussed in other issues.
- [#8360 — Disable fuzzy search in copy/clone](https://github.com/TriliumNext/Trilium/issues/8360) — `/api/autocomplete` doesn't honour an "exact match" flag; search context defaults to fuzzy. Needs a new flag or exact-mode toggle plumbed through to the autocomplete route.
- [#8356 — Allow Enter-key to confirm selection in 'Choose Note Type' dialog](https://github.com/TriliumNext/Trilium/issues/8356) — `apps/client/src/widgets/react/FormList.tsx` only wires click, not keyboard. Requires adding `onKeyDown`/focus management to `FormListItem`.
- [#8331 — table of contents and search do not work properly in closed-then-reopened tabs](https://github.com/TriliumNext/Trilium/issues/8331) — Tab-reopen doesn't rebind TOC/search scroll handlers for the reconstructed note view.
- [#8330 — Unable to confirm inline note creation via keyboard](https://github.com/TriliumNext/Trilium/issues/8330) — Same root cause as #8356 (FormList has no keyboard confirm).
- [#8323 — Enabling showLoginInShareTheme does not enable login from base domain](https://github.com/TriliumNext/Trilium/issues/8323) — `apps/server/src/share/content_renderer.ts:185` passes `showLoginInShareTheme` to the EJS template, but no template under `packages/share-theme/src/templates/` actually renders a login link. The feature is un-implemented in the default theme.
- [#8318 — Share page same title toc jump bug](https://github.com/TriliumNext/Trilium/issues/8318) — TOC anchor generation in the share renderer doesn't disambiguate duplicate headings; needs unique-ID generation.
- [#8598 — Enable globalGroup for KaTeX (or make the global macros configurable)](https://github.com/TriliumNext/Trilium/issues/8598) — Adding `globalGroup: true` to `renderMathInElement` calls (`apps/client/src/services/content_renderer_text.ts:28` and CKEditor math plugin) is mechanically small but has semantic implications that need review.

## Feature Requests

- [#8720 — Inline Code "copy button" missing in UI](https://github.com/TriliumNext/Trilium/issues/8720)
- [#8700 — Add G-code formatting](https://github.com/TriliumNext/Trilium/issues/8700)
- [#8699 — Backup enhancements](https://github.com/TriliumNext/Trilium/issues/8699)
- [#8664 — List view in shared collection notes](https://github.com/TriliumNext/Trilium/issues/8664)
- [#8663 — Web Clipper for ChatGPT](https://github.com/TriliumNext/Trilium/issues/8663)
- [#8658 — OIDC groups claims for access control](https://github.com/TriliumNext/Trilium/issues/8658)
- [#8635 — Allow internal links to open PDF notes at a specific page](https://github.com/TriliumNext/Trilium/issues/8635)
- [#8606 — Implement Authorization on OpenID](https://github.com/TriliumNext/Trilium/issues/8606)
- [#8600 — Add Microsoft Word Style Formatting Commands](https://github.com/TriliumNext/Trilium/issues/8600)
- [#8590 — Custom Font Selection with System Font Support](https://github.com/TriliumNext/Trilium/issues/8590)
- [#8588 — Import .ics Calendar Support (Local File & URL)](https://github.com/TriliumNext/Trilium/issues/8588)
- [#8534 — Regarding Password Reset](https://github.com/TriliumNext/Trilium/issues/8534)
- [#8526 — Make Ctrl + Click select multiple notes in the note tree by default](https://github.com/TriliumNext/Trilium/issues/8526)
- [#8481 — Add filtering in Table view](https://github.com/TriliumNext/Trilium/issues/8481)
- [#8477 — Folders, folders, folders](https://github.com/TriliumNext/Trilium/issues/8477)
- [#8466 — Naming and locking some note revisions](https://github.com/TriliumNext/Trilium/issues/8466)
- [#8452 — Export note attributes as Markdown metadata](https://github.com/TriliumNext/Trilium/issues/8452)
- [#8389 — Make it possible to add preact to Dialogs](https://github.com/TriliumNext/Trilium/issues/8389)
- [#8382 — Feature: Inline tabs in pages](https://github.com/TriliumNext/Trilium/issues/8382)
- [#8372 — [Feature Request] Support "share_target" in PWA to share files into Trilium notes](https://github.com/TriliumNext/Trilium/issues/8372)
- [#8333 — Feature Request: Quick access UI for frequently used text background colors](https://github.com/TriliumNext/Trilium/issues/8333)
- [#8332 — Feature Request: Allow defining a global custom color palette for text background](https://github.com/TriliumNext/Trilium/issues/8332)
- [#8319 — [Feature Request] Improved Note-Maps](https://github.com/TriliumNext/Trilium/issues/8319)

## Skipped / Unclear

- [#8514 — Unclear documentation about backing up](https://github.com/TriliumNext/Trilium/issues/8514) — Documentation complaint about an old wiki page (`github.com/TriliumNext/Trilium/wiki/Data-directory`) that is no longer the canonical source; kept as a feature request above but could also be resolved by pointing to the new docs site. Needs maintainer triage of which doc to update.
