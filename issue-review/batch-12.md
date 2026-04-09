# Batch 12 — Issues #2488–#3184

## Easy-Fix Candidates

### [#3151 — (Bug report) Import from HTML does not restore indentation](https://github.com/TriliumNext/Trilium/issues/3151)
- **Problem**: Exported HTML has `style="margin-left:40px"` on `<p>` but importing strips that style, losing indentation.
- **Proposed solution**: In `/home/elian/Projects/Trilium/apps/server/src/services/html_sanitizer.ts` (line ~49 `allowedStyles`), add `margin-left` (and likely `padding-left`, `text-align`) to the allowed styles for `p` (or `*`). Currently only `color`/`background-color` are globally allowed; the entire `style` attribute is preserved but sanitize-html strips unknown properties.
- **Effort**: small
- **Confidence**: high

### [#2817 — open internal link in OSX apps](https://github.com/TriliumNext/Trilium/issues/2817)
- **Problem**: `bookends:` URLs don't open externally from notes because the protocol isn't in the allow-list.
- **Proposed solution**: Add `bookends` (and any other commonly requested scheme) to `ALLOWED_PROTOCOLS` in `/home/elian/Projects/Trilium/packages/commons/src/lib/shared_constants.ts`. The CKEditor/link handler already calls `electron.shell.openExternal` for allowed protocols (see `apps/client/src/services/link.ts:338`).
- **Effort**: trivial
- **Confidence**: medium (fix is trivial; user may also need CKEditor to permit `bookends:` hrefs in the schema)

## Likely Already Fixed

### [#3177 — (Bug report) ERR_SOCKET_BAD_PORT - port set to NaN on server start](https://github.com/TriliumNext/Trilium/issues/3177)
- **Evidence**: `/home/elian/Projects/Trilium/apps/server/src/services/port.ts` now uses `parseAndValidate()` that explicitly checks `isNaN` and exits with a clear FATAL message; v0.55 parser issue appears rewritten.
- **Verification needed**: Ask reporter to retry with current release and provide `config.ini` if still failing.

### [#3045 — Docker : Can't run by using user 1000:1000](https://github.com/TriliumNext/Trilium/issues/3045)
- **Evidence**: `/home/elian/Projects/Trilium/apps/server/Dockerfile.rootless` now exists — runs as non-root user with configurable UID/GID via build args and does not rely on `su-exec`/`setgroups`. Multiple rootless-related fixes present in git log.
- **Verification needed**: Confirm with reporter that the rootless image solves their scenario.

### [#2957 — (Bug report) JavaScript error when attempting to run when an instance is already running](https://github.com/TriliumNext/Trilium/issues/2957)
- **Evidence**: `/home/elian/Projects/Trilium/apps/desktop/src/main.ts:87` uses `app.requestSingleInstanceLock()` and exits gracefully (`process.exit(0)`) with a translated info message instead of throwing an unhandled error. There's also a `second-instance` handler that focuses the existing window.
- **Verification needed**: Run two instances on Windows to confirm no more JS error.

### [#2722 — (Feature request) Make interface auth timeout configurable](https://github.com/TriliumNext/Trilium/issues/2722)
- **Evidence**: `Session.cookieMaxAge` is configurable in `apps/server/src/assets/config-sample.ini` (line 39) and documented in `apps/server/src/assets/doc_notes/en/User Guide/.../Authentication.html`. Used by `apps/server/src/routes/session_parser.ts:110`.
- **Verification needed**: Close as implemented, link to Authentication docs.

### [#2784 — (Feature request) Add an example documentation for self-signed certs in TLS configuration wiki page](https://github.com/TriliumNext/Trilium/issues/2784)
- **Evidence**: `docs/User Guide/User Guide/Installation & Setup/Server Installation/HTTPS (TLS).md` contains 3 matches for `self-signed`/`self sign`, so self-signed guidance is now present.
- **Verification needed**: Maintainer confirms current doc covers the scenario the reporter wanted.

### [#2909 — webclipper show not correct](https://github.com/TriliumNext/Trilium/issues/2909)
- **Evidence**: Web-clipper was completely rewritten — new implementation lives in `apps/web-clipper/` (WXT-based). The reporter's 0.52.2-era bug with the old zadam web-clipper is no longer reproducible against the new codebase.
- **Verification needed**: Ask reporter to retry with the current web-clipper.

### [#2621 — (Bug report) Inconsistency import pictures with Trilium Web Clipper Addon](https://github.com/TriliumNext/Trilium/issues/2621)
- **Evidence**: Same as #2909 — web-clipper rewritten under `apps/web-clipper/`; old image-import inconsistency from v0.50 won't reproduce.
- **Verification needed**: Ask reporter to retry "Save whole page" against modern web-clipper.

### [#2596 — (Bug report) Failed Start Up (Gnome Arc Menu extension)](https://github.com/TriliumNext/Trilium/issues/2596)
- **Evidence**: Likely dead — Electron stack, Gnome shell extensions, and everything else has been updated many times since v0.49.5 (Jan 2022). No code in Trilium controls this; it's a third-party shell extension conflict.
- **Verification needed**: Ask reporter to retry current release with Arc Menu; close as stale if not reproducible.

## Notable Non-Easy Issues

- [#3121 — (Bug report) write math inline, the text panel will delete things that i wrote before](https://github.com/TriliumNext/Trilium/issues/3121) — CKEditor `model-nodelist-offset-out-of-bounds` with math; CKEditor upgraded to v48 (from v29 era) so may be resolved but needs repro.
- [#3015 — (Bug report) Template collision for Code note](https://github.com/TriliumNext/Trilium/issues/3015) — Journal day-note template incorrectly applied to non-text child creation; needs investigation in `apps/server/src/services/notes.ts` template resolution logic.
- [#3123 — Moving notes in the tree - default encryption state](https://github.com/TriliumNext/Trilium/issues/3123) — Needs UX design for encryption prompt on move into/out of protected subtree.
- [#2841 — (Bug report) When an unordered list has a sublist, click on the right side...](https://github.com/TriliumNext/Trilium/issues/2841) — CKEditor cursor-placement bug; likely upstream.
- [#2833 — (Bug report) Cannot select relation note to edit on mobile](https://github.com/TriliumNext/Trilium/issues/2833) — Mobile UX bug in relation map; mobile code has been rewritten, needs retest.
- [#2823 — (Bug report) Note link got removed when close tab with middle button](https://github.com/TriliumNext/Trilium/issues/2823) — CKEditor interaction with middle-click; may be CKE upgrade related.
- [#2818 — copy/paste pictures across software](https://github.com/TriliumNext/Trilium/issues/2818) — Cross-process image clipboard sharing in portable mode; complex.
- [#2816 — (Bug report) The picture reference in shared notes is not normal](https://github.com/TriliumNext/Trilium/issues/2816) — MD export image path uses relative `api/images/...` URLs that break when note is rendered outside `/share/` context.
- [#2804 — Sometimes tree fails to switch focus to a code note branch in split mode](https://github.com/TriliumNext/Trilium/issues/2804) — Focus/event propagation race in split-view; hard to repro.
- [#2703 — (Bug report) @ link item dropdown persists between tabs](https://github.com/TriliumNext/Trilium/issues/2703) — CKEditor mention UI lifecycle; likely upstream.
- [#2874 — (Bug report) select over two notes could not export](https://github.com/TriliumNext/Trilium/issues/2874) — Export menu item is gated on `noSelectedNotes` in `apps/client/src/menus/tree_context_menu.ts:276`; intentional-ish but still surprising UX — needs multi-select export support.
- [#2651 — (Bug report) Deleting Several Items creates GET error](https://github.com/TriliumNext/Trilium/issues/2651) — Transient error during bulk delete; race condition hard to pin down.
- [#2604 — (Bug report) After inserting 2 links into checkbox list item, can't add more text after second link](https://github.com/TriliumNext/Trilium/issues/2604) — CKEditor list+link bug; possibly fixed in v48 upgrade but needs repro.
- [#2549 — Random notes lose their content, old revs still available](https://github.com/TriliumNext/Trilium/issues/2549) — Serious data-loss report tied to old 0.47/0.49 sync migration path; unlikely actionable now but should stay open as reference.

## Feature Requests

- [#3184 — Auto-setup links when creating a template](https://github.com/TriliumNext/Trilium/issues/3184)
- [#3148 — Detect database failure and offer to temporarily load database](https://github.com/TriliumNext/Trilium/issues/3148)
- [#3138 — Template organization via template groups with drop-down menus](https://github.com/TriliumNext/Trilium/issues/3138)
- [#3130 — Latex in titles](https://github.com/TriliumNext/Trilium/issues/3130)
- [#3112 — Ability to annotate/insert comments on note contents](https://github.com/TriliumNext/Trilium/issues/3112)
- [#3098 — Focus on the searched word](https://github.com/TriliumNext/Trilium/issues/3098)
- [#3082 — Option to open notes in new tab by default](https://github.com/TriliumNext/Trilium/issues/3082)
- [#3053 — Restore previous windows and tabs open on startup](https://github.com/TriliumNext/Trilium/issues/3053)
- [#3037 — Upgrade the Relation Map](https://github.com/TriliumNext/Trilium/issues/3037)
- [#2989 — Can make "Find and Replace" allow Regular Expression?](https://github.com/TriliumNext/Trilium/issues/2989)
- [#2972 — Make lines of Relation map straight](https://github.com/TriliumNext/Trilium/issues/2972)
- [#2960 — Internal links in Canvas](https://github.com/TriliumNext/Trilium/issues/2960)
- [#2923 — Adding 'Ignore' spellcheck function into context menu](https://github.com/TriliumNext/Trilium/issues/2923)
- [#2870 — Hope add import folder and generates notetree](https://github.com/TriliumNext/Trilium/issues/2870)
- [#2869 — Allow bypass/whitelist authentication for specific IP or subnet](https://github.com/TriliumNext/Trilium/issues/2869)
- [#2802 — Shared SQL between SQL code notes](https://github.com/TriliumNext/Trilium/issues/2802)
- [#2797 — A quicker way to create a bunch of new pages from a template](https://github.com/TriliumNext/Trilium/issues/2797)
- [#2741 — Publish checksum of published assets](https://github.com/TriliumNext/Trilium/issues/2741)
- [#2726 — Block References in Trilium Like in (Obsidian and Logseq)](https://github.com/TriliumNext/Trilium/issues/2726)
- [#2710 — Open new tabs next to the current one](https://github.com/TriliumNext/Trilium/issues/2710)
- [#2683 — Trigger asking whether to delete empty note more aggressively](https://github.com/TriliumNext/Trilium/issues/2683)
- [#2664 — Allow unsharing of notes in a shared subtree](https://github.com/TriliumNext/Trilium/issues/2664)
- [#2654 — Server to Server Sync](https://github.com/TriliumNext/Trilium/issues/2654)
- [#2637 — Allow Styling of mini date selector](https://github.com/TriliumNext/Trilium/issues/2637)
- [#2636 — Tabbing off field with dropdown selected should select](https://github.com/TriliumNext/Trilium/issues/2636)
- [#2631 — Add service worker for caching large assets](https://github.com/TriliumNext/Trilium/issues/2631)
- [#2622 — Disable sync for certain notes](https://github.com/TriliumNext/Trilium/issues/2622)
- [#2620 — Add expiration date & max requests for shared notes](https://github.com/TriliumNext/Trilium/issues/2620)
- [#2547 — automatically import the page title from url](https://github.com/TriliumNext/Trilium/issues/2547)
- [#2544 — Forms/Fields in a template?](https://github.com/TriliumNext/Trilium/issues/2544)
- [#2526 — simple recurring todo](https://github.com/TriliumNext/Trilium/issues/2526)
- [#2524 — Ability to add custom shortcuts to the note toolbar](https://github.com/TriliumNext/Trilium/issues/2524)
- [#2491 — Add improvements to internal links](https://github.com/TriliumNext/Trilium/issues/2491)
- [#2488 — Show attributes on shared notes](https://github.com/TriliumNext/Trilium/issues/2488)

## Skipped / Unclear

(None — all batch issues are classified above.)
