# Batch 01 — Issues #8766–#9353

## Easy-Fix Candidates

### [#9330 — Web clipper setup fails with trailing / in server setup](https://github.com/TriliumNext/Trilium/issues/9330)
- **Problem**: Entering `https://server/` (trailing slash) in the web clipper options form produces malformed requests (`//api/...`) because the URL isn't normalized.
- **Proposed solution**: In `apps/web-clipper/entrypoints/options/index.ts`, strip any trailing slash from `$triliumServerUrl.val()` before storing it (lines 32, 63). Also defensively trim it again when read in `apps/web-clipper/entrypoints/background/trilium_server_facade.ts` (line 121) before concatenating with the API path.
- **Effort**: trivial
- **Confidence**: high

### [#8882 — Desktop (macOS ARM64): window shows `{"message":"Not Found"}` on startup](https://github.com/TriliumNext/Trilium/issues/8882)
- **Problem**: In Electron, `res.sendFile(path.join(publicDir, "index.html"))` fails because `send`/streaming cannot read from inside the `app.asar` archive; reporter identified the root cause and the fix.
- **Proposed solution**: In `apps/server/src/routes/assets.ts` line 72 (non-dev branch), replace `res.sendFile(path.join(publicDir, "index.html"), STATIC_OPTIONS)` with a `readFile` + `res.send()` (Electron patches `fs.readFile` to work inside asar, but not `send`'s streaming pipeline). Set `Content-Type: text/html; charset=utf-8`.
- **Effort**: trivial
- **Confidence**: high

### [#8916 — Note Map view of `Hidden Notes` freezes Trilium](https://github.com/TriliumNext/Trilium/issues/8916)
- **Problem**: Invoking Note Map on the `_hidden` root attempts to render thousands of system nodes and hangs the renderer irrecoverably (edge case).
- **Proposed solution**: In the note-map widget (`apps/client/src/widgets/type_widgets/note_map.tsx` or similar — search `noteMap`), short-circuit the render when `note.noteId === "_hidden"` or when the aggregate number of descendants exceeds a threshold; show a warning instead of computing the graph. Alternatively hide the "Note map" entry from the `...` menu when the current note is `_hidden` (or any note ancestored by it) via a simple guard in the menu population code.
- **Effort**: small
- **Confidence**: medium — the guard is trivial to add, but the exact file path depends on where the note-map command is currently wired after the React port.

### [#8850 — Search does not work for `#clipType=note`](https://github.com/TriliumNext/Trilium/issues/8850)
- **Problem**: Searching `#clipType=note` returns all notes in 0.101.3 and throws an error in nightly. The literal value `note` likely collides with the search DSL keyword `note` (note title predicate).
- **Proposed solution**: In `apps/server/src/services/search/` token parsing, quote/escape attribute values when they match reserved keywords, or force attribute-expression RHS parsing to treat the RHS as a literal until whitespace. Simplest targeted fix: ensure the attribute-value tokenizer does not re-interpret `note` as a type keyword when it appears after `=`. Reporter-visible workaround is `#clipType="note"` (confirm this works before closing).
- **Effort**: small
- **Confidence**: low — the symptom points at the search tokenizer but the root cause needs a quick repro against current code.

### [#8900 — Uncaught TypeError thrown when switching notes with bottom-right attribute window open](https://github.com/TriliumNext/Trilium/issues/8900)
- **Problem**: Switching notes while the attribute detail popup is open throws a console TypeError (no visible break). Classic missing null-check on teardown.
- **Proposed solution**: Find the attribute detail widget (`apps/client/src/widgets/ribbon/attributes/*` or `widgets/attribute_widgets`) and guard the cleanup handler to check whether the widget/element still exists before calling into it. The user screenshot would pinpoint the exact line; a defensive `if (!$elem?.length) return;` at the top of the refresh/hide handler is typical.
- **Effort**: trivial
- **Confidence**: medium — confidence hinges on identifying the exact handler from the screenshot; the fix itself is one line.

### [#9174 — Right navigation (TOC) font doesn't match editor until you keep typing](https://github.com/TriliumNext/Trilium/issues/9174)
- **Problem**: When you change a heading's style in the editor, the TOC side panel doesn't re-render using the new style until more content is added.
- **Proposed solution**: The TOC widget subscribes to content changes but likely ignores "attribute-only" (style) changes. In the TOC widget (`apps/client/src/widgets/right_panel/*toc*` or `table_of_contents*.tsx`) ensure the listener refreshes on model changes that alter heading attributes too — typically replacing a content-only comparison with a re-render on every editor `change` event, or listening to CKEditor's `change:data` broadly.
- **Effort**: small
- **Confidence**: medium

## Likely Already Fixed

### [#9009 — Option to easily toggle the fuzzy search on/off](https://github.com/TriliumNext/Trilium/issues/9009)
- **Evidence**: Commit `f23a7b4842 feat(settings): also allow for fuzzy searching to just be disabled` (Mar 18 2026) adds a disable toggle in `apps/client/src/widgets/type_widgets/options/other.tsx`, wires it to `search_context.ts`, and updates `options_init.ts` + `options_interface.ts`. This lands after the issue was filed.
- **Verification needed**: A maintainer can confirm the new toggle exists in the Options UI (Other tab) in a current build and ask the reporter whether it satisfies their need; also verify the "quick jump" fuzzy concern mentioned in the issue is covered by the same toggle.

### [#8866 — Cursor jumps to note beginning periodically, tabs reset — LauncherContainer](https://github.com/TriliumNext/Trilium/issues/8866)
- **Evidence**: The error messages reference `LauncherContainer.js:545` (0.101.3). The current repo has `apps/client/src/widgets/launch_bar/LauncherContainer.tsx` — the widget was rewritten as a React component. Reported actions (`hideLeftPane`, `searchNotes`, `enterProtectedSession`) still exist but the rAF-in-launcher-container reflow storm described in the log looks gone after the rewrite.
- **Verification needed**: Maintainer should ask the reporter to retest on 0.102.2+ since the underlying file no longer exists in its 0.101.x form.

### [#8790 — Some assets not work in share notes when serving under a different path](https://github.com/TriliumNext/Trilium/issues/8790)
- **Evidence**: Issue references the path `assets/v0.99.3/src/share.js`. The share rendering pipeline has been completely replaced — share assets are now served from `packages/share-theme/` and `apps/server/src/share/content_renderer.ts` uses `basePath`-based asset URLs. The old `/assets/vX.X.X/src/share.js` path no longer exists.
- **Verification needed**: Maintainer should have the reporter retest with 0.102.x and the current reverse-proxy guide; the specific 404 URL from the bug cannot occur in the current codebase.

## Notable Non-Easy Issues

- [#9345 — Significant input lag and UI freezing during continuous drawing/writing](https://github.com/TriliumNext/Trilium/issues/9345) — Canvas PUTs every ~200ms saturating the request queue; needs debounced/coalesced saves in Excalidraw type widget.
- [#9259 — Notes no longer receive focus when navigating via the left tree](https://github.com/TriliumNext/Trilium/issues/9259) — Focus regression in 0.102.1 after the React port; requires bisecting the NoteDetail focus wiring.
- [#9247 — A large number of recovered notes appear after synchronization](https://github.com/TriliumNext/Trilium/issues/9247) — Sync conflict/"recovered" flood, needs log analysis.
- [#9238 — Formatting buttons overlap text at zoom factor >= 1](https://github.com/TriliumNext/Trilium/issues/9238) — CSS layout bug with the floating formatting toolbar; probably small once reproduced.
- [#9230 — Excalidraw updates slower after entering Zen mode](https://github.com/TriliumNext/Trilium/issues/9230) — Layout recalc or resize observer interaction with zen mode.
- [#9229 — Protected note contents get rendered whenever it has child notes](https://github.com/TriliumNext/Trilium/issues/9229) — Security-sensitive; `NoteDetailWrapper` in `apps/client/src/widgets/NoteDetail.tsx` keeps previously-rendered type widgets in the DOM when switching to `protectedSession` type, so real content stays visible. Needs a correct fix, not a hack.
- [#9150 — markdown code note does not highlight code block](https://github.com/TriliumNext/Trilium/issues/9150) — Code-mime highlight plumbing for markdown-typed code notes.
- [#9134 — Images opened in new tabs do not show up](https://github.com/TriliumNext/Trilium/issues/9134) — Type-widget caching/reuse interaction with the new tab lifecycle.
- [#9110 — Note crashed at multiple ctrl+z/paste operations](https://github.com/TriliumNext/Trilium/issues/9110) — CKEditor5 internal error `merge-operation-how-many-invalid`; upstream ckeditor issue.
- [#9096 — Share included content not working (reverse proxy)](https://github.com/TriliumNext/Trilium/issues/9096) — Share HTML/CSS inclusion requests hit `/api/` instead of `/share/` — rewriting needed in the share renderer.
- [#9083 — Alt+F4 closes all windows in multi-window mode](https://github.com/TriliumNext/Trilium/issues/9083) — Electron `before-quit`/`window-all-closed` behavior in `apps/desktop/src/main.ts` closes the whole app instead of per-window.
- [#9069 — PDF annotation changes not persisted, download button unresponsive](https://github.com/TriliumNext/Trilium/issues/9069) — pdfjs-viewer integration only saves on first annotation; needs re-entry of annotation save hook.
- [#8991 — Note jumps to the top during background sync](https://github.com/TriliumNext/Trilium/issues/8991) — Sync event triggers full re-render of all note detail instances, losing scroll state.
- [#8979 — PDF 403 Forbidden behind NGINX Proxy Manager](https://github.com/TriliumNext/Trilium/issues/8979) — Follow-up to closed #8877; CSRF / range request handling behind NPM.
- [#8973 — Chinese paths in `file://` URLs on Windows](https://github.com/TriliumNext/Trilium/issues/8973) — URL encoding / Electron `openExternal` handling.
- [#8962 — PDF Editing highlights inconsistently saved](https://github.com/TriliumNext/Trilium/issues/8962) — Same family as #9069.
- [#8953 — Share logo function broken in 0.102.0](https://github.com/TriliumNext/Trilium/issues/8953) — New share-theme fixes logo at `width="32"` (mobile.css max-width:32px); needs re-introducing the configurable logo width/height path in `packages/share-theme/src/templates/page.ejs`.
- [#8952 — Software suddenly crashed, lost notes (ckeditor contextualballoon error)](https://github.com/TriliumNext/Trilium/issues/8952) — CKEditor5 internal error, upstream.
- [#8942 — shareAlias links not clickable in shared notes](https://github.com/TriliumNext/Trilium/issues/8942) — Share content link rewriter doesn't resolve `[[alias]]` notation to the aliased href anymore.
- [#8913 — text 文本突然崩溃，且无法打开 (CKEditor `model-textproxy-wrong-length`)](https://github.com/TriliumNext/Trilium/issues/8913) — CKEditor5 internal, note is broken on open.
- [#8904 — WebClipper: Save whole page does nothing](https://github.com/TriliumNext/Trilium/issues/8904) — Service worker error in clipper; needs log triage.
- [#8893 — SOCKS5 support for web browsing / sync](https://github.com/TriliumNext/Trilium/issues/8893) — Requires Electron request interception, not trivial.
- [#8891 — LaTeX sum/prod math display error in new math UI](https://github.com/TriliumNext/Trilium/issues/8891) — ckeditor5-math rendering regression.
- [#8848 — IPv6 synchronization fails (ENETUNREACH)](https://github.com/TriliumNext/Trilium/issues/8848) — Sync client's URL parser likely mishandles `[ipv6]` literal.
- [#8791 — Copy share link not work when serving under a different path](https://github.com/TriliumNext/Trilium/issues/8791) — `useShareInfo` in `apps/client/src/widgets/shared_info.tsx` uses `location.pathname`, which is `/` when nginx strips the prefix; needs server-provided root path.
- [#9286 — Web Clipper authentication fails when TOTP is enabled](https://github.com/TriliumNext/Trilium/issues/9286) — Server already accepts `totpToken` in POST `/api/login/token`; web clipper options form just needs a TOTP field and to forward it. Small effort but cross-file UI work.

## Feature Requests

- [#9353 — Add way to zoom with a pen tablet to canvas notes](https://github.com/TriliumNext/Trilium/issues/9353)
- [#9337 — Renaming Bookmarks cascades to linked instances](https://github.com/TriliumNext/Trilium/issues/9337)
- [#9336 — Global Bookmarks](https://github.com/TriliumNext/Trilium/issues/9336)
- [#9311 — Official RISC-V (riscv64) Docker image support](https://github.com/TriliumNext/Trilium/issues/9311)
- [#9164 — PDF Export feature and font size configuration](https://github.com/TriliumNext/Trilium/issues/9164)
- [#9120 — Images as links](https://github.com/TriliumNext/Trilium/issues/9120)
- [#9059 — Link notes in PDF to internal notes](https://github.com/TriliumNext/Trilium/issues/9059)
- [#9032 — Horizontal scroll bar for the tab row](https://github.com/TriliumNext/Trilium/issues/9032)
- [#9029 — Integrated Web-Clipper in the web UI](https://github.com/TriliumNext/Trilium/issues/9029)
- [#9010 — ETAPI: No way to access protected (encrypted) notes](https://github.com/TriliumNext/Trilium/issues/9010)
- [#9006 — Switch Alt+Enter with Enter (line spacing default)](https://github.com/TriliumNext/Trilium/issues/9006)
- [#9003 — Drag-and-drop files/folders to insert clickable `file://` hyperlinks](https://github.com/TriliumNext/Trilium/issues/9003)
- [#8996 — Hide expand/collapse children button when all children are archived and hidden](https://github.com/TriliumNext/Trilium/issues/8996)
- [#8974 — TOC visibility toggle for mobile screens](https://github.com/TriliumNext/Trilium/issues/8974)
- [#8967 — PDF sharing: Download option](https://github.com/TriliumNext/Trilium/issues/8967)
- [#8963 — Bookmark while viewing PDF](https://github.com/TriliumNext/Trilium/issues/8963)
- [#8957 — Better separation between notes and system scripts](https://github.com/TriliumNext/Trilium/issues/8957)
- [#8955 — Simpler UI mode for new/casual users](https://github.com/TriliumNext/Trilium/issues/8955)
- [#8954 — Allow filtering by category for the custom icon packs](https://github.com/TriliumNext/Trilium/issues/8954)
- [#8941 — Ability to download backups from Settings](https://github.com/TriliumNext/Trilium/issues/8941)
- [#8927 — Add "Copy to Clipboard" button for code blocks in shared pages](https://github.com/TriliumNext/Trilium/issues/8927)
- [#8912 — macOS dynamic traffic light offset based on zoom factor](https://github.com/TriliumNext/Trilium/issues/8912)
- [#8766 — Checkbox tree for note tree](https://github.com/TriliumNext/Trilium/issues/8766)

## Skipped / Unclear

_None — every issue in the batch is categorized above._
