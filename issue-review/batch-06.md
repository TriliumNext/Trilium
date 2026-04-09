# Batch 06 — Issues #5528–#5783

## Easy-Fix Candidates

### [#5712 — Tooltip z-index is too low?](https://github.com/TriliumNext/Trilium/issues/5712)
- **Problem**: Tooltips in context menus appear behind Bootstrap modals because tooltip z-index is `calc(var(--ck-z-panel) - 1)` (~998), while Bootstrap modal z-index is 1055.
- **Proposed solution**: In `apps/client/src/stylesheets/style.css` around line 733, raise `.tooltip` z-index above modal (e.g. `z-index: 1060 !important;` to match the Bootstrap default of 1080, or set it with `calc(var(--bs-modal-zindex, 1055) + 5)`). Confirmed the file at `apps/client/src/stylesheets/style.css:731-734` still has the old value and `bootstrap.rtl.css:5454` sets `--bs-modal-zindex: 1055`.
- **Effort**: trivial
- **Confidence**: high

### [#5617 — Clean up the code formatting](https://github.com/TriliumNext/Trilium/issues/5617)
- **Problem**: Maintenance task — enable format-on-save, apply formatting to repo, enable import sort/unused-import cleanup.
- **Proposed solution**: Flip `editor.formatOnSave` to `true` in `.vscode/settings.json` (currently line 2: `"editor.formatOnSave": false`), add import ordering ESLint rule, then run `pnpm prettier --write`/eslint autofix on the codebase. The repo already has `eslint-config-prettier` and `@stylistic` rules wired up.
- **Effort**: small (mechanical, but touches many files)
- **Confidence**: medium — task scope is clear but apply-all-fix is large enough to risk conflicts with open PRs (as the issue itself warns).

## Likely Already Fixed

### [#5669 — Add link dialog fails to link if you press enter twice too quickly](https://github.com/TriliumNext/Trilium/issues/5669)
- **Evidence**: `git log --grep "enter twice\|link.*enter"` finds commit `f6201d8581` "fix: add link dialog enter act correctly" (Mar 2026) which touches `apps/client/src/widgets/dialogs/add_link.tsx` (+76 lines) and adds a 160-line spec file. Directly addresses this bug.
- **Verification needed**: Run the reproduction steps from the issue in the latest main build and confirm it is no longer possible to trigger the "Choose note type" dialog by fast double-enter in the add-link flow.

### [#5606 — OpenID Connect support](https://github.com/TriliumNext/Trilium/issues/5606)
- **Evidence**: `apps/server/src/services/open_id.ts` exists; `express-openid-connect` is a direct dependency and has been continuously updated (git log shows `2.20.1`, `2.20.0`, `2.19.4`, etc.); OIDC docs have been improved (commit `963f4586f3`). The feature has clearly shipped.
- **Verification needed**: Confirm documentation covers configuration with Authelia/Keycloak/Authentik so the original reporter's use cases are answered, then close.

### [#5545 — Fancytree assertion failed: only init supported](https://github.com/TriliumNext/Trilium/issues/5545)
- **Evidence**: fancytree has since been updated to v2.38.5 (`5db8b59b51`) plus a "partial integrate jquery.fancytree" refactor (`23db7fe602`) and a "missing fancytree dependencies" fix (`901ab54e64`). The assertion error from an older version may no longer reproduce.
- **Verification needed**: Load the server build on a clean profile and check the browser console for the `only init supported` error on startup.

## Notable Non-Easy Issues
- [#5783 — Extend the `CodeMirror` class to preserve customizability with CodeMirror 6](https://github.com/TriliumNext/Trilium/issues/5783) — exposing CM6 internals (`@codemirror/view`, `@codemirror/state`) via the script API needs an API design decision.
- [#5775 — Strict SQLite tables](https://github.com/TriliumNext/Trilium/issues/5775) — requires migration plan and careful type audit of every column; non-trivial.
- [#5742 — External link balloon popup stays visible when switching tabs](https://github.com/TriliumNext/Trilium/issues/5742) — requires digging into CKEditor balloon lifecycle vs. Trilium tab switching.
- [#5729 — Firewall warning on corporate network](https://github.com/TriliumNext/Trilium/issues/5729) — `apps/server/src/services/host.ts` defaults to `0.0.0.0`; Electron could bind `127.0.0.1` instead, but needs care to not break remote-access scenarios.
- [#5713 — #launcher-container not scrollable on mobile with custom theme](https://github.com/TriliumNext/Trilium/issues/5713) — theme-next sets overflow, custom themes may not; needs base-style enforcement rather than theme-level CSS.
- [#5706 — Modals/dialogues too high/low on iPad Safari/Edge](https://github.com/TriliumNext/Trilium/issues/5706) — iOS viewport/keyboard interactions; tricky cross-device CSS work.
- [#5682 — Any markdown text containing `$` gets converted into math equations during import](https://github.com/TriliumNext/Trilium/issues/5682) — regex at `apps/server/src/services/import/markdown.ts:209` is greedy across `$`; needs smarter heuristics (digit/whitespace guards) and tests.
- [#5673 — Editor extremely slow with large-ish checkbox trees](https://github.com/TriliumNext/Trilium/issues/5673) — CKEditor performance with nested todo lists; upstream-ish.
- [#5670 — Default image alignment for pasted documents](https://github.com/TriliumNext/Trilium/issues/5670) — needs CKEditor paste pipeline work.
- [#5665 — PDF Viewer obstruction on iOS mobile client](https://github.com/TriliumNext/Trilium/issues/5665) — mobile PDF note layout shows metadata panel covering content; needs a mobile-specific layout fix.
- [#5659 — Playwright against Electron version](https://github.com/TriliumNext/Trilium/issues/5659) — CI/infra task, not trivial but scoped.
- [#5630 — Get rid of deprecated methods](https://github.com/TriliumNext/Trilium/issues/5630) — still six `@deprecated` markers in `bnote.ts`/`backend_script_api.ts`; removing them requires auditing every caller and also the script API surface.
- [#5611 — Mermaid bugs can crash the frontend](https://github.com/TriliumNext/Trilium/issues/5611) — needs a throttled sandbox/worker for live Mermaid rendering; upstream bugs.
- [#5603 — Code box in text cannot be copied from the end to the left (when highlighted)](https://github.com/TriliumNext/Trilium/issues/5603) — CKEditor selection quirk in highlighted code blocks.
- [#5565 — Writing does not work correctly (canvas + weight tracker)](https://github.com/TriliumNext/Trilium/issues/5565) — Excalidraw interaction bug intertwined with promoted attributes.
- [#5550 — Sync errors may hang the initial setup](https://github.com/TriliumNext/Trilium/issues/5550) — first-run sync error needs UI feedback instead of silent infinite wait.
- [#5546 — #readOnly should apply to title and labels too](https://github.com/TriliumNext/Trilium/issues/5546) — `apps/client/src/widgets/note_title.tsx` computes `isReadOnly` without checking the `#readOnly` label; also need to propagate to attribute widgets.
- [#5536 — Recent Changes not correct / undelete confusing](https://github.com/TriliumNext/Trilium/issues/5536) — UX + data correctness issue in the Recent Changes dialog.
- [#5535 — Refactor event system for maintainability/type safety](https://github.com/TriliumNext/Trilium/issues/5535) — architectural refactor.
- [#5528 — Editing note re-renders split attachments on every keystroke](https://github.com/TriliumNext/Trilium/issues/5528) — needs component-level should-update logic for attachment previews.
- [#5539 — Absurdly thick stroke width in Canvas note type](https://github.com/TriliumNext/Trilium/issues/5539) — Excalidraw minimum stroke width is baked into the library.
- [#5650 — TOTP security enhancement](https://github.com/TriliumNext/Trilium/issues/5650) — partially done (`178a3b4318` adds 160-bit secret) but SHA256/rate limiting remain; security-sensitive work.

## Feature Requests
- [#5756 — Support Note Map Type as Shared Page](https://github.com/TriliumNext/Trilium/issues/5756)
- [#5751 — Linking to subtitles](https://github.com/TriliumNext/Trilium/issues/5751)
- [#5728 — Copy link to note](https://github.com/TriliumNext/Trilium/issues/5728)
- [#5727 — Table borders (apply to cells too)](https://github.com/TriliumNext/Trilium/issues/5727)
- [#5725 — Add TriliumNext to TrueNAS apps](https://github.com/TriliumNext/Trilium/issues/5725)
- [#5707 — OneNote import tool](https://github.com/TriliumNext/Trilium/issues/5707)
- [#5701 — Configurable tab width in code blocks](https://github.com/TriliumNext/Trilium/issues/5701)
- [#5697 — Take photo from camera](https://github.com/TriliumNext/Trilium/issues/5697)
- [#5692 — codesandbox Sandpack note or plugin](https://github.com/TriliumNext/Trilium/issues/5692)
- [#5690 — Markdown editor](https://github.com/TriliumNext/Trilium/issues/5690)
- [#5686 — In-app Help links to public pages](https://github.com/TriliumNext/Trilium/issues/5686)
- [#5685 — Search within Help User Guide](https://github.com/TriliumNext/Trilium/issues/5685)
- [#5671 — Search entire database when a note is hoisted](https://github.com/TriliumNext/Trilium/issues/5671)
- [#5667 — Better search with search excerpts](https://github.com/TriliumNext/Trilium/issues/5667)
- [#5658 — Saved Search auto-run on note open](https://github.com/TriliumNext/Trilium/issues/5658)
- [#5656 — Show full note titles in Link Map view](https://github.com/TriliumNext/Trilium/issues/5656)
- [#5641 — Add showProtectedDialog() to frontend API](https://github.com/TriliumNext/Trilium/issues/5641)
- [#5640 — Support for importing ICS (iCalendar) file](https://github.com/TriliumNext/Trilium/issues/5640)
- [#5638 — Add Ctrl+D shortcut to select next matching occurrence](https://github.com/TriliumNext/Trilium/issues/5638)
- [#5626 — Include all available templates even in hoisted notes](https://github.com/TriliumNext/Trilium/issues/5626)
- [#5621 — Customize the format toolbar](https://github.com/TriliumNext/Trilium/issues/5621)
- [#5615 — Clicking below note should focus editor](https://github.com/TriliumNext/Trilium/issues/5615)
- [#5609 — "Open in new split" option in JumpTo menu](https://github.com/TriliumNext/Trilium/issues/5609)
- [#5598 — Multiple client instances / connect to multiple servers](https://github.com/TriliumNext/Trilium/issues/5598)
- [#5585 — Search prefix (dynamic prefix per result)](https://github.com/TriliumNext/Trilium/issues/5585)
- [#5583 — #rerunScriptsOnTemplateChange label](https://github.com/TriliumNext/Trilium/issues/5583)
- [#5579 — Allow Root note to be #shareRoot](https://github.com/TriliumNext/Trilium/issues/5579)
- [#5572 — API function to raise window](https://github.com/TriliumNext/Trilium/issues/5572)
- [#5562 — Pin tab](https://github.com/TriliumNext/Trilium/issues/5562)
- [#5561 — Task management (Kanban, progress bar, timeline)](https://github.com/TriliumNext/Trilium/issues/5561)
- [#5553 — Launcher: keyboard navigation for Calendar](https://github.com/TriliumNext/Trilium/issues/5553)

## Skipped / Unclear
- (none — every issue in the batch is placed above)
