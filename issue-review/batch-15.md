# Batch 15 — Issues #21–#1123

## Easy-Fix Candidates

### [#762 — [UX] Print paths with colored '/' separators](https://github.com/TriliumNext/Trilium/issues/762)
- **Problem**: When a note title contains `/`, the note-path breadcrumbs become ambiguous; a visually distinct separator would disambiguate.
- **Proposed solution**: In the path-rendering code (search `apps/client/src/services/tree.ts` / `apps/client/src/widgets/note_tree.ts` for `getNotePath` / `/` concatenation, and `apps/client/src/widgets/note_path_list_widget.*`), wrap the separator in `<span class="note-path-separator">/</span>` and add a subtle color/bold rule in the corresponding CSS. Purely a rendering tweak.
- **Effort**: small
- **Confidence**: medium — straightforward once the exact render site is located.

### [#342 — Warn if user is trying to run the script in a wrong environment](https://github.com/TriliumNext/Trilium/issues/342)
- **Problem**: When a frontend script is invoked on the backend (or vice versa) it silently fails; the user gets no helpful message.
- **Proposed solution**: In `apps/server/src/services/script.ts` (backend execution) check `note.mime` / `note.getLabelValue("runOnBackend")` against the caller context and throw a descriptive error; mirror in `apps/client/src/services/script_context.ts` for frontend. Single `if` with a clear error message per side.
- **Effort**: small
- **Confidence**: medium — the two script runners exist, just need a type guard + thrown error.

### [#21 — Script execution should error out on usage of protected notes outside of protected session](https://github.com/TriliumNext/Trilium/issues/21)
- **Problem**: Scripts silently fail in unpredictable ways when they access protected notes without a protected session.
- **Proposed solution**: In `apps/server/src/services/script.ts` (and `script_context.ts`), before invoking the script check `note.isProtected && !protectedSessionService.isProtectedSessionAvailable()` and throw a clear error (e.g. "Cannot run protected script without a protected session"). No such guard currently exists per `grep` on the script services.
- **Effort**: small
- **Confidence**: high — isolated pre-check in one place.

## Likely Already Fixed

### [#1102 — Spellchecker is overly sensitive](https://github.com/TriliumNext/Trilium/issues/1102)
- **Evidence**: Items (1) and (2) were rejected upstream (Electron/Blink limitation). Item (3) (runtime toggle shortcut) is still not supported — `apps/server/src/services/window.ts` reads `spellCheckEnabled` only at window creation, and no `toggleSpellCheck` shortcut exists in `keyboard_actions.ts`. However the original items 1 & 2 are effectively closed as "won't fix".
- **Verification needed**: Close items 1-2 as won't-fix (Electron limitation); split out item 3 as a separate feature request if still wanted.

### [#1080 — Cell properties panel invisible when table cell content too large](https://github.com/TriliumNext/Trilium/issues/1080)
- **Evidence**: Filed against Trilium 0.42.6 with CKEditor from that era. CKEditor5 has been upgraded many major versions since; table cell properties panel positioning is handled by upstream CKEditor. No custom override exists in `packages/ckeditor5/`.
- **Verification needed**: Reproduce with current build — paste a huge text block into a table cell and try to open cell properties; if panel is visible, close.

### [#924 — Text following innerlink becomes part of the link after switching pages](https://github.com/TriliumNext/Trilium/issues/924)
- **Evidence**: Reported against 0.40.6 — a CKEditor link-range bug from that era. CKEditor has been upgraded many versions; no custom link-range fix exists in `packages/ckeditor5/`. No commits touching "innerlink" in `git log`.
- **Verification needed**: Reproduce: insert a Ctrl+L link, type text after it, switch notes and back; if the trailing text is no longer absorbed into the link, close.

### [#936 — unable to clip some pages](https://github.com/TriliumNext/Trilium/issues/936)
- **Evidence**: 0.40-era web clipper timeout on a large GitHub markdown page. Clipper and server code have been rewritten since (`apps/web-clipper/`, clipping endpoint in `apps/server/src/routes/api/clipper.ts`).
- **Verification needed**: Re-try clipping `https://github.com/learnbyexample/learn_gnuawk/blob/master/gnu_awk.md` with current clipper; if successful, close.

### [#75 — add standard attribute value autocomplete](https://github.com/TriliumNext/Trilium/issues/75)
- **Evidence**: `apps/client/src/services/attribute_autocomplete.ts` exports `initLabelValueAutocomplete`, which calls `attribute-values/<name>` server endpoint and populates autocomplete suggestions. Wired up in `attribute_detail.ts` and `PromotedAttributes.tsx`. Exactly what was asked for.
- **Verification needed**: None — can be closed as done.

### [#649 — Open/focus a note from command line / desktop URL handler (Trilium URL protocol)](https://github.com/TriliumNext/Trilium/issues/649)
- **Evidence**: PR #9248 ("Add URL protocol support for trilium://") is referenced as submitted for this IssueHunt. No `trilium://` handler or `setAsDefaultProtocolClient` currently in the codebase (so PR is still open).
- **Verification needed**: Track PR #9248 — once merged, close this issue.

## Notable Non-Easy Issues
- [#1123 — Read-only view for tree section or "edit/view mode" for entire app](https://github.com/TriliumNext/Trilium/issues/1123) — overlaps with ongoing read-only-instance work; needs UX design.
- [#1054 — Enhancement: Fetch link metadata](https://github.com/TriliumNext/Trilium/issues/1054) — requires backend metascraper service + CKEditor plugin + offline asset handling.
- [#1045 — [wish] personal/custom list of synonyms](https://github.com/TriliumNext/Trilium/issues/1045) — active design discussion about equivalence classes / note variants; non-trivial search pipeline change.
- [#1039 — enhance require](https://github.com/TriliumNext/Trilium/issues/1039) — body covers keyboard navigation + title-from-selection + link-map filtering; three separate UX changes.
- [#1021 — Link to Note Block](https://github.com/TriliumNext/Trilium/issues/1021) — sub-note paragraph anchoring needs new ID model + CKEditor support.
- [#1015 — Interwiki-style links to file-based files](https://github.com/TriliumNext/Trilium/issues/1015) — new link-resolver abstraction needed.
- [#989 — Link tagging w/ tree structure (cloning as tagging)](https://github.com/TriliumNext/Trilium/issues/989) — semantic/architectural discussion about cloning vs. attributes.
- [#952 — Searching Relation Attribute Values as Text](https://github.com/TriliumNext/Trilium/issues/952) — search parser change to resolve related-note title to ID; non-trivial syntax work.
- [#927 — Option to move selected text to child note](https://github.com/TriliumNext/Trilium/issues/927) — already partially supported ("Cut selection to sub-note"); needs UX refinement.
- [#868 — Global search: retain text + highlight results](https://github.com/TriliumNext/Trilium/issues/868) — search UX rework, needs in-note scroll/highlight integration.
- [#760 — tag system suggest](https://github.com/TriliumNext/Trilium/issues/760) — tag suggestion UI with co-occurrence ranking; substantial new feature.
- [#616 — Undo for Subtree Operations](https://github.com/TriliumNext/Trilium/issues/616) — requires operation log / undo stack; deep architectural change.
- [#527 — [Feature Request] Side Comments](https://github.com/TriliumNext/Trilium/issues/527) — non-exported meta text; needs new CKEditor plugin + export filter.
- [#518 — Sorting protected notes](https://github.com/TriliumNext/Trilium/issues/518) — `sortKey`/`sortIndex` attributes not yet implemented; affects tree sorting pipeline.
- [#507 — MtoN relation in relation map](https://github.com/TriliumNext/Trilium/issues/507) — relation map rendering change; needs bulk-relation UI.
- [#449 — api.addMenuItem](https://github.com/TriliumNext/Trilium/issues/449) — API surface extension for scripting; needs menu registration hook.
- [#393 — Upgrade option (preserve DB on update)](https://github.com/TriliumNext/Trilium/issues/393) — in-place updater; platform-specific installer work.
- [#228 — Visually differentiate links from relations in relation map](https://github.com/TriliumNext/Trilium/issues/228) — relation map rendering tweak, but needs distinct styling decisions.
- [#39 — Implement attribute autocomplete in search input](https://github.com/TriliumNext/Trilium/issues/39) — confirmed not wired into any search widget; needs search-input integration.

## Feature Requests
- [#1046 — [wish] Global shortcut](https://github.com/TriliumNext/Trilium/issues/1046)
- [#1026 — Show Trilium content related to my web searches](https://github.com/TriliumNext/Trilium/issues/1026)
- [#991 — Link to a blank note (pure backlink-only notes)](https://github.com/TriliumNext/Trilium/issues/991)
- [#986 — Community Code Library / Plugin System](https://github.com/TriliumNext/Trilium/issues/986)
- [#983 — Custom Local Save location and Hide Child Notes for Attachments](https://github.com/TriliumNext/Trilium/issues/983)
- [#970 — Use double click to get to the child note](https://github.com/TriliumNext/Trilium/issues/970)
- [#926 — Option to not expand parent note when note is made its child](https://github.com/TriliumNext/Trilium/issues/926)
- [#825 — Link preview](https://github.com/TriliumNext/Trilium/issues/825)
- [#814 — Ability to add a tag to a page when clipping](https://github.com/TriliumNext/Trilium/issues/814)
- [#802 — Clip url with description](https://github.com/TriliumNext/Trilium/issues/802)
- [#728 — FR: Export search results](https://github.com/TriliumNext/Trilium/issues/728)
- [#673 — [Feature Request] External Resource Notes](https://github.com/TriliumNext/Trilium/issues/673)
- [#672 — [Feature request] Error Tracking](https://github.com/TriliumNext/Trilium/issues/672)
- [#641 — npm install additional libraries](https://github.com/TriliumNext/Trilium/issues/641)
- [#409 — AppImage for Linux](https://github.com/TriliumNext/Trilium/issues/409)
- [#352 — Feature Request: Restore Demo Content](https://github.com/TriliumNext/Trilium/issues/352)
- [#242 — CalDAV Support](https://github.com/TriliumNext/Trilium/issues/242)
- [#212 — Tooltip for an attachment can display basic info (original name, mime) and download/open buttons](https://github.com/TriliumNext/Trilium/issues/212)
- [#139 — Label listing can be clickable and lead to search of given label](https://github.com/TriliumNext/Trilium/issues/139)

## Skipped / Unclear
_(none — all issues classified above)_
