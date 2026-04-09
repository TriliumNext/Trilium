# Feature Request Fit Analysis — Trilium

Every one of the **423 open feature requests** in TriliumNext/Trilium was individually classified by a subagent against Trilium's product identity. The question asked for each issue was: **"Can this reasonably be integrated into Trilium, or is it too specific / out of scope?"**

## Headline numbers

| Category | Count | % | Recommendation |
|---|---:|---:|---|
| **Strong fit** | 108 | 25.5% | Clear alignment with core subsystems — accept and prioritize |
| **Reasonable fit** | 181 | 42.8% | QoL improvements to existing subsystems — accept contributions |
| **Niche / scripting territory** | 77 | 18.2% | Better as user scripts or custom note types — redirect |
| **Out of scope** | 55 | 13.0% | Doesn't fit Trilium's identity — close with rationale |
| **Unclear** | 2 | 0.5% | Needs clarification from reporter |
| **Total** | 423 | 100% | |

**Net read:** about **68%** of feature requests (Strong + Reasonable) align with Trilium's direction and could be accepted if someone writes the code. About **18%** would be better served by user scripts or custom note types than core changes. Roughly **13%** don't fit and could be closed with a clear rationale.

## Interpretation guide

- **Strong fit** = the feature maps directly onto an existing subsystem (search, sync, share, templates, attributes, tree, etc.) and would obviously be welcome. The only thing missing is an implementation.
- **Reasonable fit** = nice-to-have polish or extension, fits the subsystem, would be accepted if someone contributed it. Not an architectural stretch.
- **Niche / scripting territory** = probably serves a small audience or very specific workflow. Trilium already has a scripting API and custom note types — these requests could live there instead of core. The rationale includes a suggested alternative (script, template, plugin, backend API call).
- **Out of scope** = would fundamentally change what Trilium is. Common rejection reasons: real-time collaboration, multi-tenant/CMS publishing, IDE features, block-level transclusion beyond the note model, replacing the sync/crypto protocol, hosting provider lock-in, vendor promos, full-blown kanban/calendar-first alternatives to the note tree.
- **Unclear** = the issue body didn't give the reviewer enough to judge. Not a rejection — the reporter should clarify.

## Per-batch counts

| Batch | Strong | Reasonable | Niche | Out-of-scope | Unclear | Total |
|---:|---:|---:|---:|---:|---:|---:|
| [01](_features/batch-01-fit.md) | 5 | 13 | 5 | 0 | 0 | 23 |
| [02](_features/batch-02-fit.md) | 4 | 12 | 5 | 2 | 0 | 23 |
| [03](_features/batch-03-fit.md) | 6 | 11 | 5 | 1 | 1 | 24 |
| [04](_features/batch-04-fit.md) | 6 | 12 | 5 | 1 | 0 | 24 |
| [05](_features/batch-05-fit.md) | 4 | 11 | 6 | 3 | 0 | 24 |
| [06](_features/batch-06-fit.md) | 12 | 13 | 2 | 4 | 0 | 31 |
| [07](_features/batch-07-fit.md) | 6 | 9 | 4 | 2 | 0 | 21 |
| [08](_features/batch-08-fit.md) | 6 | 12 | 2 | 4 | 1 | 25 |
| [09](_features/batch-09-fit.md) | 7 | 14 | 8 | 5 | 0 | 34 |
| [10](_features/batch-10-fit.md) | 9 | 15 | 6 | 5 | 0 | 35 |
| [11](_features/batch-11-fit.md) | 11 | 14 | 5 | 4 | 0 | 34 |
| [12](_features/batch-12-fit.md) | 11 | 14 | 4 | 5 | 0 | 34 |
| [13](_features/batch-13-fit.md) | 8 | 12 | 9 | 8 | 0 | 37 |
| [14](_features/batch-14-fit.md) | 8 | 11 | 7 | 9 | 0 | 35 |
| [15](_features/batch-15-fit.md) | 5 | 8 | 4 | 2 | 0 | 19 |

---

## Strong Fit (108)

These features plug directly into existing Trilium subsystems and would be obviously welcome additions. Use this list as an "accept if PR comes in" queue.

### From Batch 15

- [#1046 — Global shortcut](https://github.com/TriliumNext/Trilium/issues/1046) — A global hotkey for quick note capture/search is a standard feature for desktop PKM apps and fits the Electron desktop layer.
- [#139 — Label listing can be clickable and lead to search of given label](https://github.com/TriliumNext/Trilium/issues/139) — Clickable labels that trigger a search are a natural extension of the existing attribute and search subsystems.
- [#728 — FR: Export search results](https://github.com/TriliumNext/Trilium/issues/728) — Export already exists for subtrees, and extending it to search results is a clean power-user improvement that reuses existing export infrastructure.
- [#814 — Ability to add a tag to a page when clipping](https://github.com/TriliumNext/Trilium/issues/814) — Adding user-specified tags at clip time fits squarely with the web clipper and Trilium's attribute-driven organization model.
- [#926 — Option to not to expand parent note when note is made it's child](https://github.com/TriliumNext/Trilium/issues/926) — A small tree-view UX fix directly targeting the core note tree widget.
### From Batch 14

- [#1170 — How to disable note editing in mobile front end?](https://github.com/TriliumNext/Trilium/issues/1170) — A global read-only default for mobile is a sensible UX toggle for the existing mobile web client.
- [#1181 — Make tabs keep the scroll on the tree left panel](https://github.com/TriliumNext/Trilium/issues/1181) — Preserving tree scroll state per tab is a core navigation fix for the existing tab/tree subsystem.
- [#1193 — Sort results in Jump to note by frequency of use?](https://github.com/TriliumNext/Trilium/issues/1193) — Ranking Jump-to-note by recency/frequency is a direct and commonly expected improvement to an existing core widget.
- [#1266 — Suggestion for Recent Changes](https://github.com/TriliumNext/Trilium/issues/1266) — Splitting Recent Changes into modified vs deleted sections is a minor, concrete improvement to an existing dialog.
- [#1267 — Is it possible to make INSERT NOTE optional?](https://github.com/TriliumNext/Trilium/issues/1267) — Per-parent default child note type aligns with Trilium's attribute-driven configuration model.
- [#1426 — request: unlinked references](https://github.com/TriliumNext/Trilium/issues/1426) — Unlinked references (title mentions not yet linked) is a standard PKM feature that fits naturally with Trilium's backlinks system.
- [#1668 — Search autocompletion for labels](https://github.com/TriliumNext/Trilium/issues/1668) — Reusing the existing attribute autocomplete in quick/saved search is a clear UX parity improvement.
- [#1715 — Page up/down in note selection dialogs](https://github.com/TriliumNext/Trilium/issues/1715) — Trivial accessibility/keyboard improvement to existing dialogs.
### From Batch 13

- [#1763 — custom title for saved search results](https://github.com/TriliumNext/Trilium/issues/1763) — Showing note path/context in search results is a core usability improvement for a hierarchical note tree where duplicate titles are common.
- [#1921 — UI improvement for dangling links](https://github.com/TriliumNext/Trilium/issues/1921) — Distinguishing links to missing/empty notes is a standard wiki-style PKM feature that fits Trilium's linking model.
- [#1967 — Manually save note revision and add comment](https://github.com/TriliumNext/Trilium/issues/1967) — Named/annotated manual revisions are a natural extension of the existing BRevision system and requested by power users.
- [#2053 — Search for dates in different formats](https://github.com/TriliumNext/Trilium/issues/2053) — Flexible date parsing in search directly improves the existing date-note/search subsystem.
- [#2203 — Option to not expand subtree when opening subnote](https://github.com/TriliumNext/Trilium/issues/2203) — Legitimate tree navigation option fitting the existing expansion/archived visibility controls.
- [#2281 — Switch to existing tab if note already open](https://github.com/TriliumNext/Trilium/issues/2281) — Sensible tab-management behavior aligned with how the multi-tab UI already works.
- [#2473 — Show branch prefix in quick search](https://github.com/TriliumNext/Trilium/issues/2473) — Small bug-adjacent fix to make quick search respect the existing branch-prefix feature.
- [#2477 — Automatically delete/unhide unsaved search notes](https://github.com/TriliumNext/Trilium/issues/2477) — Cleanup of ephemeral hidden-subtree search notes is a clear hygiene improvement for existing infrastructure.
### From Batch 12

- [#2488 — Show attributes on shared notes](https://github.com/TriliumNext/Trilium/issues/2488) — Shared notes subsystem already surfaces note metadata and exposing attributes (e.g., source URL from web clipper) is a natural extension.
- [#2491 — Add improvements to internal links](https://github.com/TriliumNext/Trilium/issues/2491) — Disambiguating same-titled notes in the internal link autocomplete is a clear UX gap in an existing core feature.
- [#2547 — Automatically import the page title from url](https://github.com/TriliumNext/Trilium/issues/2547) — Fetching link titles fits the existing rich text editor and web clipper infrastructure and is a common expectation.
- [#2664 — Allow unsharing of notes in a shared subtree](https://github.com/TriliumNext/Trilium/issues/2664) — Granular share control is a fundamental capability gap in the existing sharing subsystem.
- [#2710 — Open new tabs next to the current one](https://github.com/TriliumNext/Trilium/issues/2710) — Standard tab behavior expected from any tabbed app with an existing tab manager.
- [#2989 — Find and Replace allow Regular Expression](https://github.com/TriliumNext/Trilium/issues/2989) — Regex in find/replace is a basic power-user expectation and fits the existing editor.
- [#3053 — Restore previous windows and tabs open on startup](https://github.com/TriliumNext/Trilium/issues/3053) — Multi-window session restore is a core expectation for a desktop app with existing tab/window state management.
- [#3082 — Option to open notes in new tab by default](https://github.com/TriliumNext/Trilium/issues/3082) — Simple preference toggle over existing tab/navigation behavior.
- [#3112 — Annotate/insert comments on note contents](https://github.com/TriliumNext/Trilium/issues/3112) — Inline annotations/comments fit a rich text PKM tool and CKEditor supports comment/annotation plugins.
- [#3130 — Latex in titles](https://github.com/TriliumNext/Trilium/issues/3130) — KaTeX is already a dependency and rendering math in titles is consistent with the text note subsystem.
- [#3148 — Detect database failure and offer to load backup](https://github.com/TriliumNext/Trilium/issues/3148) — Automated recovery from the existing backup system is a high-value robustness improvement.
### From Batch 11

- [#3266 — Automatic layout on relation maps](https://github.com/TriliumNext/Trilium/issues/3266) — Auto-layout is a standard, long-expected feature for the existing relation map subsystem.
- [#3267 — Multiple note drag-and-drop into relation map](https://github.com/TriliumNext/Trilium/issues/3267) — Obvious UX improvement to an existing feature that already supports single-note drag.
- [#3268 — Accept drag-and-dropping note links into relation map](https://github.com/TriliumNext/Trilium/issues/3268) — Consistent drag source handling fits the relation map/split view subsystems.
- [#3358 — Table of contents on the left side](https://github.com/TriliumNext/Trilium/issues/3358) — Trilium already has a TOC widget; allowing left-panel placement is a natural extension.
- [#3385 — Searching through note revisions](https://github.com/TriliumNext/Trilium/issues/3385) — Revisions are a core subsystem and searching them is a natural extension of the search engine.
- [#3400 — Setting to disable smart/typographic quotes](https://github.com/TriliumNext/Trilium/issues/3400) — CKEditor autoformat toggle is a common editor setting and directly addresses a code-in-text pain point.
- [#3426 — Search and replace](https://github.com/TriliumNext/Trilium/issues/3426) — Core editor/search feature users routinely expect in a note-taking app.
- [#3430 — Basic fulltext search on share](https://github.com/TriliumNext/Trilium/issues/3430) — Shaca/share subsystem would meaningfully benefit from basic fulltext lookup.
- [#3494 — Value replace in bulk action](https://github.com/TriliumNext/Trilium/issues/3494) — Clear gap in the existing bulk actions subsystem for attribute maintenance.
- [#3540 — Temporary unhoist shortcut / cross-workspace jump-to-note](https://github.com/TriliumNext/Trilium/issues/3540) — Hoisting is core workflow and this is a concrete, well-scoped UX fix.
- [#3556 — Auto-set code note language from filename extension](https://github.com/TriliumNext/Trilium/issues/3556) — Lightweight QoL tying the existing code-note type to title parsing.
### From Batch 10

- [#3720 — Clone to today](https://github.com/TriliumNext/Trilium/issues/3720) — Cloning to the day note is a natural interaction on top of the existing calendar/day-note and clone subsystems.
- [#3721 — ETAPI: Append to existing note content](https://github.com/TriliumNext/Trilium/issues/3721) — Appending is a common ETAPI use case (logging, clippers) and a minor extension to the existing content endpoint.
- [#3761 — Template mixins: grouped inherited promoted attributes](https://github.com/TriliumNext/Trilium/issues/3761) — Directly improves the promoted-attribute/template subsystem that power users rely on for structured notes.
- [#3885 — Fully adhere to XDG Base Directory Specification](https://github.com/TriliumNext/Trilium/issues/3885) — Proper cache/config separation is a legitimate Linux desktop hygiene improvement for the Electron build.
- [#3958 — Allow hiding/blocking inherited attributes on template users](https://github.com/TriliumNext/Trilium/issues/3958) — Fills a real gap in the template/inheritance model that affects how `#archived` and similar labels propagate.
- [#4005 — ETAPI interface to get note content hash](https://github.com/TriliumNext/Trilium/issues/4005) — The hash is already computed internally; exposing it via ETAPI is a small change that enables efficient external sync tooling.
- [#4080 — Workspace-specific launchers](https://github.com/TriliumNext/Trilium/issues/4080) — Fits naturally with the existing workspace concept and launcher bar, reducing clutter for multi-context users.
- [#4124 — Labels with predefined lists](https://github.com/TriliumNext/Trilium/issues/4124) — A natural enhancement to promoted attributes, consistent with how structured PKM tools handle controlled vocabularies.
- [#4134 — Add 'Expandable' option to Include Note](https://github.com/TriliumNext/Trilium/issues/4134) — Small, coherent addition to the existing include-note modes that mirrors the book/list view behavior.
### From Batch 09

- [#4199 — Modify note creation and modification time through api](https://github.com/TriliumNext/Trilium/issues/4199) — Essential for note import tooling; ETAPI already exposes note fields and preserving original timestamps is a standard import requirement.
- [#4242 — Subscript & Superscript Shortcuts](https://github.com/TriliumNext/Trilium/issues/4242) — Trivial CKEditor keybinding addition that aligns with existing rich text shortcut infrastructure.
- [#4299 — Expose protectedSessionService to frontend script api](https://github.com/TriliumNext/Trilium/issues/4299) — Clear gap in the frontend script API that fits the existing scripting surface.
- [#4305 — Encrypted / Protected attributes](https://github.com/TriliumNext/Trilium/issues/4305) — Natural extension of the protected-notes subsystem to attributes, a core Trilium entity.
- [#4606 — Full-Text Search Using SQLite FTS](https://github.com/TriliumNext/Trilium/issues/4606) — Search is a core subsystem and BM25 relevance ranking is a well-understood improvement for a SQLite-backed app.
- [#4612 — Authorization for synchronization endpoint](https://github.com/TriliumNext/Trilium/issues/4612) — Reasonable self-hosting security improvement for the sync subsystem behind reverse proxies.
- [#4691 — Context-Menu Option: Add backlink to](https://github.com/TriliumNext/Trilium/issues/4691) — Fits existing relation/backlink infrastructure and tree context menu, a clean UX improvement.
### From Batch 08

- [#4989 — (Keyboard) shortcuts for more actions](https://github.com/TriliumNext/Trilium/issues/4989) — Expanding keyboard shortcut coverage is core power-user PKM functionality and fits the existing shortcut subsystem.
- [#5044 — Calendar overview of Note activity](https://github.com/TriliumNext/Trilium/issues/5044) — An activity calendar complements the existing calendar/journal note types and revision system for PKM.
- [#5089 — template-Typed Attributes/Relationships](https://github.com/TriliumNext/Trilium/issues/5089) — Constraining promoted relations by template fits directly into the attributes/templates subsystem power users rely on.
- [#5183 — Inline reference to labels](https://github.com/TriliumNext/Trilium/issues/5183) — Inline label/relation references extend Trilium's attribute system and fit the existing include-note/reference mechanics.
- [#5195 — internal links to notes in Mermaid Diagrams](https://github.com/TriliumNext/Trilium/issues/5195) — Linking mermaid nodes to notes is a natural extension of the mermaid note type and internal link system.
- [#5199 — Export of HTML with [missing note] could have retained names](https://github.com/TriliumNext/Trilium/issues/5199) — A clear export fidelity improvement for the existing import/export subsystem.
### From Batch 07

- [#5332 — Improve search result highlighting](https://github.com/TriliumNext/Trilium/issues/5332) — Search is a core subsystem and highlighting matches for advanced queries is a straightforward consistency improvement.
- [#5344 — Importing html images as attached instead of external reference](https://github.com/TriliumNext/Trilium/issues/5344) — Fits directly into the existing HTML import pipeline and aligns with how interactive note creation already handles images.
- [#5362 — Unify/hide duplicate find dialogs/widgets](https://github.com/TriliumNext/Trilium/issues/5362) — Consolidating the find/find-and-replace widgets is a clear UX cleanup of existing functionality.
- [#5401 — Confusing behaviour when the application is minimized in system tray](https://github.com/TriliumNext/Trilium/issues/5401) — Standard Electron single-instance behavior that belongs in the desktop app.
- [#5475 — Add keyboard shortcuts for managing splits](https://github.com/TriliumNext/Trilium/issues/5475) — Splits exist as a first-class feature and keyboard bindings fit Trilium's power-user identity.
- [#5497 — Undo, permanent delete: add as action for note tree](https://github.com/TriliumNext/Trilium/issues/5497) — Tree-level undo and permanent-delete shortcuts directly extend existing tree actions.
### From Batch 06

- [#5553 — Launcher: add keyboard navigation for Calendar](https://github.com/TriliumNext/Trilium/issues/5553) — Basic accessibility/keyboard navigation for an existing first-party widget; clearly within scope.
- [#5609 — Add "open in new split" option to JumpTo menu](https://github.com/TriliumNext/Trilium/issues/5609) — JumpTo and splits are both core navigation features, and this is a natural power-user integration between them.
- [#5615 — Clicking below note should focus editor](https://github.com/TriliumNext/Trilium/issues/5615) — Fundamental editor UX expectation matching every other word processor; clear bug-like QoL fix.
- [#5626 — Include all available templates, even in hoisted notes](https://github.com/TriliumNext/Trilium/issues/5626) — Removes a real limitation in the existing template + hoisting subsystems.
- [#5656 — Show full note titles in Link Map view](https://github.com/TriliumNext/Trilium/issues/5656) — Straightforward display improvement to a first-party visualization.
- [#5658 — Saved Search Auto Search on Note Open](https://github.com/TriliumNext/Trilium/issues/5658) — Matches user expectations for saved searches and aligns with existing behavior in the sidebar.
- [#5667 — Better search with search excerpts](https://github.com/TriliumNext/Trilium/issues/5667) — Search result excerpts are table-stakes for a knowledge management app and directly improve a core subsystem.
- [#5671 — Option to search entire database when a note is hoisted](https://github.com/TriliumNext/Trilium/issues/5671) — Small, explicit toggle for an existing search + hoisting constraint.
- [#5685 — Search within Help User Guide](https://github.com/TriliumNext/Trilium/issues/5685) — In-app help discoverability is a clear UX gap and leverages existing search infrastructure.
- [#5697 — Take photo from camera](https://github.com/TriliumNext/Trilium/issues/5697) — Important capture mechanism for a PKM tool, especially on mobile web; uses standard HTML capture.
- [#5728 — Copy link to note](https://github.com/TriliumNext/Trilium/issues/5728) — Core PKM interaction (copying a shareable link); desktop currently lags behind web.
- [#5751 — Linking to subtitles](https://github.com/TriliumNext/Trilium/issues/5751) — Heading anchors / intra-note links are standard in any serious notes/wiki tool.
### From Batch 05

- [#6225 — Settings for displaying search results](https://github.com/TriliumNext/Trilium/issues/6225) — Direct, small UX improvement to the core search results widget (show totals, configurable page size).
- [#6226 — Adding "Clone to" to search bulk actions](https://github.com/TriliumNext/Trilium/issues/6226) — Clone is a first-class Trilium concept and already exists as a tree action; exposing it in search bulk actions is a natural gap to close.
- [#6421 — [wip] Attributes V2](https://github.com/TriliumNext/Trilium/issues/6421) — Attributes are Trilium's defining power-user feature; typed attributes, validation, and conflict resolution are clearly core roadmap material.
- [#6829 — Allow sorting notes by multiple attributes](https://github.com/TriliumNext/Trilium/issues/6829) — Extends the existing `#sorted` / `#sortDirection` attribute semantics in a clean, backwards-compatible way.
### From Batch 04

- [#6962 — Prioritize Running Sync When Coming Back Online (Like laptop wakeup)](https://github.com/TriliumNext/Trilium/issues/6962) — Sync reliability is core to Trilium's identity; detecting wake/network-regain and retrying with backoff is a clear improvement to an existing subsystem.
- [#6991 — Search: Add Search Ranking Customizability](https://github.com/TriliumNext/Trilium/issues/6991) — Search is a first-class feature and moving to BM25/weighted scoring directly improves a known pain point in large knowledge bases.
- [#7001 — Logout Feature in the Desktop Version of Trilium Next](https://github.com/TriliumNext/Trilium/issues/7001) — Desktop parity for a basic auth/session action that already exists on the server side is an obvious gap to close.
- [#7127 — OpenID auto redirect](https://github.com/TriliumNext/Trilium/issues/7127) — Small config flag on an existing OpenID flow; trivial addition to an already-supported auth subsystem.
- [#7313 — Option to remove demo data when creating new instance](https://github.com/TriliumNext/Trilium/issues/7313) — Clean-install option is a common onboarding request and maps cleanly onto the existing initial-setup flow.
- [#7447 — Milestone: Official mobile application](https://github.com/TriliumNext/Trilium/issues/7447) — Already an accepted roadmap milestone authored by the maintainer and addresses the single largest gap in platform coverage.
### From Batch 03

- [#7895 — (feat) Image Gallery/Collection](https://github.com/TriliumNext/Trilium/issues/7895) — Fits the existing Collections subsystem (geomap precedent) and fills an obvious gap for visual note browsing.
- [#7927 — Kanban: (Option to) Display the first ~line of note content for each item](https://github.com/TriliumNext/Trilium/issues/7927) — Directly improves the Kanban collection view, a core note-type feature, with a low-scope attribute-driven option.
- [#7931 — Inline Mermaid Diagram Display](https://github.com/TriliumNext/Trilium/issues/7931) — Persisting the view mode of the built-in Mermaid widget is a clear UX bug/polish for an existing note type.
- [#8098 — Make clicking a month name in Year view open that month's view](https://github.com/TriliumNext/Trilium/issues/8098) — Trivial navigation improvement to the existing calendar collection view.
- [#8187 — Search for new relation in promoted attributes does not suggest to create it](https://github.com/TriliumNext/Trilium/issues/8187) — Regression in a core attribute/note-creation path; clearly in scope.
- [#8260 — Improve Note Drag & Drop Functionality](https://github.com/TriliumNext/Trilium/issues/8260) — Tree and Kanban DnD are core UX surfaces and deserve the polish.
### From Batch 02

- [#8452 — Export note attributes as Markdown metadata](https://github.com/TriliumNext/Trilium/issues/8452) — Markdown export is a core interop feature and YAML front-matter for attributes is the standard lossless way to round-trip metadata, addressing real lock-in concerns.
- [#8481 — Add filtering in Table view](https://github.com/TriliumNext/Trilium/issues/8481) — Filtering is a basic expectation of any table/collection view and is already explicitly called out as a limitation in the docs.
- [#8635 — Allow internal links to open PDF notes at a specific page](https://github.com/TriliumNext/Trilium/issues/8635) — Trilium already ships a customized PDF.js viewer that supports these fragment parameters; wiring them through internal link resolution is a small, high-value fix.
- [#8664 — List view in shared collection notes](https://github.com/TriliumNext/Trilium/issues/8664) — Shared/published notes are a first-class subsystem (Shaca) and parity of collection views between app and share is expected behavior.
### From Batch 01

- [#8927 — Add "Copy to Clipboard" Button for Code Blocks in Shared Pages](https://github.com/TriliumNext/Trilium/issues/8927) — Shared notes are a core Trilium subsystem and copy buttons on code blocks are table-stakes for documentation sharing.
- [#8967 — PDF Sharing - Download Option](https://github.com/TriliumNext/Trilium/issues/8967) — Restores a regression from the native PDF viewer change in a core subsystem (shared notes), clear bugfix-adjacent request.
- [#8974 — Table of Content visibility toggle for smartphone/mobile screens](https://github.com/TriliumNext/Trilium/issues/8974) — TOC is an existing first-class widget and the mobile client is a supported target that currently has no way to access it.
- [#8996 — Hide expand/collapse button when all children are hidden archived notes](https://github.com/TriliumNext/Trilium/issues/8996) — Straightforward polish fix to the existing "hide archived notes" behavior in the tree widget.
- [#9010 — ETAPI: No way to access protected (encrypted) notes](https://github.com/TriliumNext/Trilium/issues/9010) — Protected notes and ETAPI are both core subsystems and the gap forces external clients into insecure workarounds.

## Reasonable Fit (181)

Useful quality-of-life improvements that fit the product but are not essential. Would be accepted if someone contributed them. Good second-tier queue for contributors.

### From Batch 15

- [#212 — Tooltip for an attachment can display basic info and download/open buttons](https://github.com/TriliumNext/Trilium/issues/212) — A quality-of-life improvement to the existing attachment UI subsystem.
- [#352 — Restore Demo Content](https://github.com/TriliumNext/Trilium/issues/352) — Re-importing the bundled demo into an existing database is a small onboarding improvement that fits existing import mechanisms.
- [#409 — AppImage for Linux](https://github.com/TriliumNext/Trilium/issues/409) — A reasonable packaging option for the Electron desktop build, complementing existing Linux distributions.
- [#672 — Error Tracking for scripts](https://github.com/TriliumNext/Trilium/issues/672) — Better error visibility for the scripting subsystem is a reasonable power-user improvement given how central scripting is.
- [#802 — Clip url with description](https://github.com/TriliumNext/Trilium/issues/802) — A modest enhancement to the web clipper's existing clip modes.
- [#970 — Use double click to get to the child note](https://github.com/TriliumNext/Trilium/issues/970) — A minor navigation UX tweak in the book/note-list widget.
- [#983 — Custom Local Save location and Hide Child Notes for Attachments](https://github.com/TriliumNext/Trilium/issues/983) — Both parts (DB location config and hiding attachment child notes) touch existing subsystems and are reasonable polish items.
- [#991 — Link to a blank note](https://github.com/TriliumNext/Trilium/issues/991) — Creating an empty note inline from an `@` link is a small authoring-flow improvement that fits the text editor and autocomplete subsystems.
### From Batch 14

- [#1144 — Option to auto expand book nodes](https://github.com/TriliumNext/Trilium/issues/1144) — An attribute or setting to auto-expand book children fits existing book note configuration patterns.
- [#1148 — include relation maps content in search results](https://github.com/TriliumNext/Trilium/issues/1148) — Indexing relation-map note membership into search would deepen an existing subsystem, though implementation is non-trivial.
- [#1206 — Feature request: jump back to last edit](https://github.com/TriliumNext/Trilium/issues/1206) — A "jump to last edit" shortcut is a useful editor navigation feature that can build on existing history tracking.
- [#1269 — Customize note title shown in tree](https://github.com/TriliumNext/Trilium/issues/1269) — Attribute-driven tree title templating is a natural extension of Trilium's label/template system.
- [#1514 — Get the link to the note from the desktop apps](https://github.com/TriliumNext/Trilium/issues/1514) — Exposing a "copy server URL" action in desktop is a small, self-contained improvement.
- [#1526 — Shortcut to open the link in a new window](https://github.com/TriliumNext/Trilium/issues/1526) — Modifier-click to open a note in a new window fits the existing multi-window Electron support.
- [#1554 — image alt text in markdown export](https://github.com/TriliumNext/Trilium/issues/1554) — Fixing markdown export to emit alt text properly is a small but valuable correctness improvement.
- [#1585 — Default import options for drag and drop](https://github.com/TriliumNext/Trilium/issues/1585) — Persisting import option defaults (e.g. shrink images) is a minor configuration enhancement to the importer.
- [#1623 — Remember default box size for included notes](https://github.com/TriliumNext/Trilium/issues/1623) — Remembering last-used size for included notes is a trivial UX polish.
- [#1652 — saved search preview with number of results](https://github.com/TriliumNext/Trilium/issues/1652) — Showing result counts next to saved search links is a useful, bounded dashboard-style feature.
- [#1693 — Copy/Paste Table As/From CSV](https://github.com/TriliumNext/Trilium/issues/1693) — CSV paste/copy for tables is a pragmatic way to unblock many table feature requests with modest scope.
### From Batch 13

- [#1772 — Disable CKEditor automatic text transformations](https://github.com/TriliumNext/Trilium/issues/1772) — Exposing a CKEditor option, especially suppressing transforms in inline code, is a reasonable editor config improvement.
- [#1826 — insertDateTimeToText shortcut for labels](https://github.com/TriliumNext/Trilium/issues/1826) — Extending an existing shortcut to also work in label inputs is a small consistency fix.
- [#1946 — Show attributes (relations) on link map](https://github.com/TriliumNext/Trilium/issues/1946) — Labeling edges by relation name on the link/note map is a reasonable visualization enhancement.
- [#1991 — Relation constraints](https://github.com/TriliumNext/Trilium/issues/1991) — Type constraints on relation targets fit the promoted-attribute/template system as a power-user feature.
- [#2051 — Embedding YouTube/Vimeo videos](https://github.com/TriliumNext/Trilium/issues/2051) — Media embed support in the rich text editor is a common expectation for a note app.
- [#2064 — Improve default link map layout](https://github.com/TriliumNext/Trilium/issues/2064) — Better graph layout algorithm is a reasonable polish task for the existing note/link map.
- [#2181 — Different icon for folder note with content vs without](https://github.com/TriliumNext/Trilium/issues/2181) — Small visual tweak to clarify the existing folder-note concept in the tree.
- [#2185 — Alt+T should link day portion to day note](https://github.com/TriliumNext/Trilium/issues/2185) — Natural enhancement of the existing Alt+T shortcut given Trilium's day-note subsystem.
- [#2293 — Include note section by markdown header](https://github.com/TriliumNext/Trilium/issues/2293) — Header-based section inclusion is a reasonable upgrade to the existing Include Note feature.
- [#2303 — Note map live update](https://github.com/TriliumNext/Trilium/issues/2303) — Live refresh of the note map when links change is a reasonable QoL over the current static view.
- [#2363 — Better linking from Mermaid diagrams](https://github.com/TriliumNext/Trilium/issues/2363) — A UI helper for inserting note links into Mermaid fits the existing Mermaid note type.
- [#2420 — Link date-valued labels to day notes](https://github.com/TriliumNext/Trilium/issues/2420) — Surfacing date-label backlinks on day notes naturally extends date-note and attribute subsystems.
### From Batch 12

- [#2524 — Custom shortcuts on the note toolbar](https://github.com/TriliumNext/Trilium/issues/2524) — Extending the scripting API's `addButtonToToolbar()` to target note-level tabs is a modest API addition.
- [#2622 — Disable sync for certain notes](https://github.com/TriliumNext/Trilium/issues/2622) — Device-local notes via a label is a useful power-user knob that fits the existing sync/attribute systems.
- [#2631 — Add service worker for caching large assets](https://github.com/TriliumNext/Trilium/issues/2631) — Performance improvement aligned with the web client architecture, though not core identity.
- [#2636 — Tabbing off dropdown field should select](https://github.com/TriliumNext/Trilium/issues/2636) — Clear UX polish bug in the attribute editor.
- [#2683 — Trigger asking whether to delete empty note more aggressively](https://github.com/TriliumNext/Trilium/issues/2683) — Small QoL refinement of existing delete-empty-note behavior.
- [#2741 — Publish checksum of published assets](https://github.com/TriliumNext/Trilium/issues/2741) — Standard release hygiene improvement for the build/release pipeline.
- [#2797 — Quicker way to create notes from a template](https://github.com/TriliumNext/Trilium/issues/2797) — Workflow improvement for the existing template subsystem that's central to power-user PKM.
- [#2870 — Import folder and generate note tree](https://github.com/TriliumNext/Trilium/issues/2870) — Folder import already partly exists; making it create a matching tree is a reasonable importer enhancement.
- [#2923 — Ignore spellcheck in context menu](https://github.com/TriliumNext/Trilium/issues/2923) — Small editor context menu addition aligned with existing spellcheck integration.
- [#2960 — Internal links in Canvas](https://github.com/TriliumNext/Trilium/issues/2960) — Cross-note-type linking would improve Canvas integration with the PKM core.
- [#2972 — Make Relation Map lines straight](https://github.com/TriliumNext/Trilium/issues/2972) — Minor rendering option in an existing note type.
- [#3098 — Focus on the searched word](https://github.com/TriliumNext/Trilium/issues/3098) — Auto-scrolling search results to match position is a natural search UX improvement.
- [#3138 — Template organization via template groups with drop-down menus](https://github.com/TriliumNext/Trilium/issues/3138) — Nested template menus are a reasonable QoL for the existing template system.
- [#3184 — Auto-setup links when creating a template](https://github.com/TriliumNext/Trilium/issues/3184) — A `templateClone` relation is a sensible extension to the existing template/clone mechanics.
### From Batch 11

- [#3244 — Prompt before exit option](https://github.com/TriliumNext/Trilium/issues/3244) — Simple preference in the existing settings system; reasonable safety QoL.
- [#3304 — Shortcut to format selection as inline code](https://github.com/TriliumNext/Trilium/issues/3304) — Fits the existing keyboard shortcut/CKEditor integration, with real value for CJK input users.
- [#3335 — Mouse wheel scroll instead of zoom in Mermaid notes](https://github.com/TriliumNext/Trilium/issues/3335) — Reasonable behavior tweak for the Mermaid note type.
- [#3353 — Support NODE_EXTRA_CA_CERTS in Electron](https://github.com/TriliumNext/Trilium/issues/3353) — Legitimate self-hosting concern with a concrete Electron-level fix.
- [#3356 — Collapsed child-note link toggles expansion on first click](https://github.com/TriliumNext/Trilium/issues/3356) — Small UX polish to the included note/child navigation behavior.
- [#3389 — Preserve mobile image upload order](https://github.com/TriliumNext/Trilium/issues/3389) — Straightforward mobile upload bug/QoL fix.
- [#3433 — Ship demo charts in hidden subtree](https://github.com/TriliumNext/Trilium/issues/3433) — Fits the hidden subtree templating system and keeps samples upgradable.
- [#3458 — Show special characters (nbsp etc.) in editor](https://github.com/TriliumNext/Trilium/issues/3458) — Reasonable editor option for power users working with code.
- [#3462 — Named color palette for highlight/font color](https://github.com/TriliumNext/Trilium/issues/3462) — Enables dark-mode-friendly colors via CKEditor's supported inline color definitions.
- [#3484 — Slash/shortcut menu for format selection](https://github.com/TriliumNext/Trilium/issues/3484) — Common CKEditor-style command palette that fits the rich-text subsystem.
- [#3541 — Configurable font color set](https://github.com/TriliumNext/Trilium/issues/3541) — Related editor-palette config concern, reasonable as an option.
- [#3563 — Left panel fixed width, toggle shortcut, focus handling](https://github.com/TriliumNext/Trilium/issues/3563) — Concrete layout/keyboard QoL improvements to existing panel behavior.
- [#3566 — Copy/clone as a search bulk action](https://github.com/TriliumNext/Trilium/issues/3566) — Fills an obvious gap alongside the existing move bulk action.
- [#3593 — Disable auto-jump when dropping an image as child note](https://github.com/TriliumNext/Trilium/issues/3593) — Small behavior toggle that addresses a clear workflow annoyance.
### From Batch 10

- [#3724 — Paste picture default settings (inline)](https://github.com/TriliumNext/Trilium/issues/3724) — Configurable default alignment for pasted images is a sensible editor preference.
- [#3729 — Keep sidebar width more consistent](https://github.com/TriliumNext/Trilium/issues/3729) — UX polish for window-resize behavior, fits the existing layout system.
- [#3743 — Minimize/close to tray icon](https://github.com/TriliumNext/Trilium/issues/3743) — Standard Electron desktop behavior that complements the existing tray integration.
- [#3767 — Turn off Autoformat completely](https://github.com/TriliumNext/Trilium/issues/3767) — Adding an editor toggle to disable markdown autoformat is a reasonable CKEditor configuration option.
- [#3785 — Standard label for opening default note](https://github.com/TriliumNext/Trilium/issues/3785) — A built-in "open on startup" note is a common PKM convenience, already approximated via fragile scripts.
- [#3794 — Tiling images without resorting to tables](https://github.com/TriliumNext/Trilium/issues/3794) — Native side-by-side image layout is a reasonable rich-text editor improvement.
- [#3878 — Sort Lines](https://github.com/TriliumNext/Trilium/issues/3878) — Standard code-editor action that fits the CodeMirror note type.
- [#3899 — Preserve selected delete/import dialog options](https://github.com/TriliumNext/Trilium/issues/3899) — Small UX improvement to make dialogs remember recent choices.
- [#3913 — Allow no timeout for protected notes](https://github.com/TriliumNext/Trilium/issues/3913) — Fixing the blank-field exception and allowing an explicit "never timeout" option is a legitimate settings fix.
- [#3964 — API method to get all notes](https://github.com/TriliumNext/Trilium/issues/3964) — Exposing a bulk list/iterator endpoint (or documenting one) fits the ETAPI surface.
- [#3983 — API function to refresh search note](https://github.com/TriliumNext/Trilium/issues/3983) — A small, well-scoped addition that improves scripting and external integration with search notes.
- [#4002 — Internal link inside mermaid diagram](https://github.com/TriliumNext/Trilium/issues/4002) — Supporting internal note references in mermaid click handlers is consistent with Trilium's cross-note linking story.
- [#4023 — Allow launchers to pass arguments to script notes](https://github.com/TriliumNext/Trilium/issues/4023) — Modest scripting-API extension that makes the launcher system dramatically more reusable.
- [#4026 — Time attribute field](https://github.com/TriliumNext/Trilium/issues/4026) — Adding a time/duration type to promoted attributes rounds out the existing date/decimal/currency types.
- [#4179 — Identify the current outline location](https://github.com/TriliumNext/Trilium/issues/4179) — Highlighting the current heading in the outline widget is a reasonable navigation improvement.
### From Batch 09

- [#4296 — Remember position in file](https://github.com/TriliumNext/Trilium/issues/4296) — Useful QoL for long notes; scroll position persistence fits existing note context state.
- [#4353 — Prevent correcting characters to symbols](https://github.com/TriliumNext/Trilium/issues/4353) — Reasonable toggle for CKEditor's autoformat/typography plugin.
- [#4366 — Static log file name for trilium server](https://github.com/TriliumNext/Trilium/issues/4366) — Legitimate ops request to support standard logrotate workflows on self-hosted servers.
- [#4375 — Data location - allow user to select](https://github.com/TriliumNext/Trilium/issues/4375) — Custom data directory is a standard desktop app feature; env var exists but a GUI/config option is reasonable.
- [#4395 — Autocomplete dialog support via scripting API](https://github.com/TriliumNext/Trilium/issues/4395) — Exposing the existing noteAutocomplete service to scripts is a small, well-scoped API addition.
- [#4396 — Ordering of templates](https://github.com/TriliumNext/Trilium/issues/4396) — Minor UX tweak to the "Add Child Note" menu that benefits template-heavy users.
- [#4405 — Vim keybindings - yank/paste to system clipboard](https://github.com/TriliumNext/Trilium/issues/4405) — Standard CodeMirror vim-mode configuration that fits the existing code note editor.
- [#4439 — In-app update mechanism](https://github.com/TriliumNext/Trilium/issues/4439) — Auto-update via electron-updater is a well-understood and expected desktop app feature.
- [#4468 — Toggle button for promoted attribute on mobile](https://github.com/TriliumNext/Trilium/issues/4468) — Reasonable mobile UX improvement within existing promoted attributes widget.
- [#4498 — Bulk convert to attachment](https://github.com/TriliumNext/Trilium/issues/4498) — Sensible migration helper for the existing image-to-attachment conversion flow.
- [#4669 — Printed font size configuration](https://github.com/TriliumNext/Trilium/issues/4669) — Modest print CSS configuration improvement for the existing print feature.
- [#4732 — Flathub Verification](https://github.com/TriliumNext/Trilium/issues/4732) — Simple distribution/packaging task that improves discoverability of the official Flatpak.
- [#4813 — Horizontal scroll bar visible when not at bottom of Note](https://github.com/TriliumNext/Trilium/issues/4813) — Reasonable fix/UX improvement for large tables in the text editor viewport.
- [#4818 — Set options for api import](https://github.com/TriliumNext/Trilium/issues/4818) — Small ETAPI gap; exposing existing import options as API parameters fits the external API.
### From Batch 08

- [#4854 — Add a visual diff to split window](https://github.com/TriliumNext/Trilium/issues/4854) — A diff view between notes or revisions is a natural QoL extension of revisions and split view.
- [#4870 — Synchronized Devices Dashboard](https://github.com/TriliumNext/Trilium/issues/4870) — Managing sync clients is a reasonable admin feature for the existing sync subsystem.
- [#4885 — reload read position after "go back" from attachment view](https://github.com/TriliumNext/Trilium/issues/4885) — Simple navigation UX fix for the attachment viewer.
- [#5049 — Appearance Settings Optional Sync](https://github.com/TriliumNext/Trilium/issues/5049) — Per-device appearance overrides is a legitimate options/sync QoL improvement for multi-device users.
- [#5086 — Investigate Windows additional package managers](https://github.com/TriliumNext/Trilium/issues/5086) — Broader Windows package distribution is a reasonable release/distribution improvement.
- [#5108 — Deploy to Flathub](https://github.com/TriliumNext/Trilium/issues/5108) — Expanding Linux packaging reach is a reasonable distribution improvement.
- [#5122 — (Try to) sync app on shutdown](https://github.com/TriliumNext/Trilium/issues/5122) — A shutdown sync hook is a sensible reliability improvement for the sync subsystem.
- [#5126 — AVIF image compression support](https://github.com/TriliumNext/Trilium/issues/5126) — Adding a modern image format option fits the existing image handling pipeline.
- [#5190 — Drag and drop note icon to insert link in note](https://github.com/TriliumNext/Trilium/issues/5190) — Minor drag-and-drop UX enhancement that fits existing link-drag interactions.
- [#5205 — Image zoom / gallery view for shared notes](https://github.com/TriliumNext/Trilium/issues/5205) — A useful viewer enhancement for the share subsystem.
- [#5228 — SOCKS Proxy Support in Desktop App](https://github.com/TriliumNext/Trilium/issues/5228) — Reasonable networking option for self-hosted users behind restricted networks.
- [#5281 — Change `clone` terminology](https://github.com/TriliumNext/Trilium/issues/5281) — Terminology cleanup that touches UI/i18n but is a legitimate usability consideration.
### From Batch 07

- [#5303 — Creating human-readable URL aliases without sharing](https://github.com/TriliumNext/Trilium/issues/5303) — Extending the existing alias mechanism to internal navigation is a plausible quality-of-life improvement, though it touches routing in non-trivial ways.
- [#5305 — Confirmation dialogue when dragging and dropping to move note](https://github.com/TriliumNext/Trilium/issues/5305) — An optional drag safeguard or toast undo is a reasonable enhancement to the tree widget.
- [#5337 — Code blocks: sort mime type by most used](https://github.com/TriliumNext/Trilium/issues/5337) — Frequency-based sorting or type-ahead in the mime picker is a minor, sensible UX refinement.
- [#5350 — Web-clipper prompt to add meta note](https://github.com/TriliumNext/Trilium/issues/5350) — A small, optional capture-time field fits naturally in the web-clipper flow.
- [#5357 — Mind Map: Ability to add images as node](https://github.com/TriliumNext/Trilium/issues/5357) — Reasonable enhancement to the mind-map note type, depending on the upstream library's support.
- [#5361 — UX: image options clarification](https://github.com/TriliumNext/Trilium/issues/5361) — Clarifying the compression settings and PNG handling is a straightforward settings/docs fix.
- [#5363 — Option to open HTML attachment in browser instead of download](https://github.com/TriliumNext/Trilium/issues/5363) — Rendering HTML attachments inline is a reasonable extension to the attachments viewer with some security considerations.
- [#5411 — Auto-hide the tab bar and toolbar in full-screen mode](https://github.com/TriliumNext/Trilium/issues/5411) — A focus/zen-mode refinement that fits existing layout controls.
- [#5509 — Dynamic themes](https://github.com/TriliumNext/Trilium/issues/5509) — Allowing the desktop app to load a theme CSS from a local file or URL is a reasonable theming extension.
### From Batch 06

- [#5562 — Pin tab](https://github.com/TriliumNext/Trilium/issues/5562) — Common tabbed-UI convenience that fits the existing tab system, though not mission-critical.
- [#5579 — Allow Root note to be #shareRoot](https://github.com/TriliumNext/Trilium/issues/5579) — Reasonable sharing improvement; at minimum a clearer warning is a clean QoL fix to the share subsystem.
- [#5583 — #rerunScriptsOnTemplateChange label](https://github.com/TriliumNext/Trilium/issues/5583) — Targeted enhancement to template/script lifecycle that fills a clear gap for power users.
- [#5621 — Customize the format toolbar](https://github.com/TriliumNext/Trilium/issues/5621) — Editor customization is a common request and CKEditor5 supports configurable toolbars.
- [#5638 — Ctrl+D Select Next Matching Occurrence](https://github.com/TriliumNext/Trilium/issues/5638) — Easy to do for code notes via CodeMirror's existing multi-cursor; text-note version is more speculative but the request is reasonable.
- [#5640 — Support for importing ICS (iCalendar) file](https://github.com/TriliumNext/Trilium/issues/5640) — Natural companion to the new calendar view and fits the import/export subsystem.
- [#5641 — Add showProtectedDialog() to frontend API](https://github.com/TriliumNext/Trilium/issues/5641) — Small, well-scoped addition to the frontend script API that unblocks protected-note workflows.
- [#5686 — In-app Help links to public pages](https://github.com/TriliumNext/Trilium/issues/5686) — Small UX improvement with low implementation cost given docs are already mirrored.
- [#5701 — Configurable tab width in code blocks](https://github.com/TriliumNext/Trilium/issues/5701) — CodeMirror supports this natively; straightforward configuration exposure.
- [#5707 — OneNote import tool](https://github.com/TriliumNext/Trilium/issues/5707) — Import from major competing apps fits Trilium's migration story, though OneNote specifically is complex.
- [#5725 — Add TriliumNext to TrueNAS apps](https://github.com/TriliumNext/Trilium/issues/5725) — Packaging/distribution task that expands self-hosted reach at low engineering cost.
- [#5727 — Table borders](https://github.com/TriliumNext/Trilium/issues/5727) — Legitimate editor bug/QoL issue in the CKEditor5 table plugin.
- [#5756 — Support Note Map Type as Shared Page](https://github.com/TriliumNext/Trilium/issues/5756) — Extending Shaca to render an existing note type is consistent with prior share improvements.
### From Batch 05

- [#5795 — Drop image attachments without shrinking](https://github.com/TriliumNext/Trilium/issues/5795) — Sensible modifier-key / prompt enhancement to existing image drop handling in CKEditor.
- [#5827 — Replace word/symbol with user-defined term](https://github.com/TriliumNext/Trilium/issues/5827) — Standard autocorrect/autoreplace in a rich text editor; fits CKEditor customization.
- [#6144 — Custom styles for CKEditor](https://github.com/TriliumNext/Trilium/issues/6144) — Trilium already ships custom CKEditor plugins (admonitions, footnotes); exposing CKEditor5 Style feature is an incremental extension.
- [#6162 — Global Tag View](https://github.com/TriliumNext/Trilium/issues/6162) — Labels are central and discoverability is a known gap; a browse-all-labels view fits the attribute subsystem.
- [#6203 — Suppress messages on Frontend API scripts](https://github.com/TriliumNext/Trilium/issues/6203) — Small, well-scoped scripting API improvement (optional silent flag on `protectSubTree` and friends).
- [#6259 — Geo-map undo on pin move](https://github.com/TriliumNext/Trilium/issues/6259) — Basic data-safety QoL for the geo-map type widget.
- [#6296 — Auto hide sidebar](https://github.com/TriliumNext/Trilium/issues/6296) — A common layout preference that fits the existing layout/panel subsystem.
- [#6410 — Display note count in folders](https://github.com/TriliumNext/Trilium/issues/6410) — Minor tree widget enhancement; aligns with existing child-counting logic.
- [#6805 — Adaptive tray icon](https://github.com/TriliumNext/Trilium/issues/6805) — Standard Electron desktop polish for KDE/GNOME tray theming.
- [#6836 — Handle HTTP redirects in sync configuration](https://github.com/TriliumNext/Trilium/issues/6836) — Small correctness fix in the sync HTTP client; supports realistic self-host reverse-proxy setups.
- [#6841 — Drag note into split view](https://github.com/TriliumNext/Trilium/issues/6841) — Natural extension of the existing split view and drag-and-drop tab handling.
### From Batch 04

- [#7113 — Use dateTime attribute for calendar child notes](https://github.com/TriliumNext/Trilium/issues/7113) — Consolidating date+time into a single datetime attribute simplifies sorting and fits the existing attribute/collection subsystem.
- [#7198 — Code Editor Indent wrapping](https://github.com/TriliumNext/Trilium/issues/7198) — CodeMirror supports this natively; exposing the option in code/text notes is a small quality-of-life win.
- [#7217 — Allow opening note directly instead of quick edit in collections](https://github.com/TriliumNext/Trilium/issues/7217) — Reasonable user-preference toggle for collection click behavior; minor change to existing view code.
- [#7224 — Quick Notes from Everywhere using a Creation Window (Inbox-first approach)](https://github.com/TriliumNext/Trilium/issues/7224) — Inbox-first capture is a core PKM workflow and fits alongside the existing global shortcut and web clipper.
- [#7279 — Implement Sticky tree view headers as a native feature](https://github.com/TriliumNext/Trilium/issues/7279) — Small tree UX improvement already prototyped by the community; natural fit for the note tree widget.
- [#7403 — Option to disable fancy font ligatures](https://github.com/TriliumNext/Trilium/issues/7403) — Simple settings toggle affecting code/inline-code rendering; legitimate accessibility/readability preference.
- [#7410 — Feature request: ability to reorder sections in the Table of Contents](https://github.com/TriliumNext/Trilium/issues/7410) — TOC already exists as a right-panel widget; adding drag-to-reorder sections fits the CKEditor-backed text note workflow.
- [#7541 — Merging TOC and Highlights List](https://github.com/TriliumNext/Trilium/issues/7541) — Unifying two existing right-panel widgets is a reasonable UI consolidation.
- [#7607 — Add API support to check and switch to an already opened note tab](https://github.com/TriliumNext/Trilium/issues/7607) — Small, well-scoped additions to the frontend script API that close a real gap for tab-aware scripts.
- [#7636 — documents about scripting may need an update](https://github.com/TriliumNext/Trilium/issues/7636) — Scripting docs are core developer-facing material and keeping them current is legitimately needed maintenance work.
- [#7646 — Add a setting to switch to 24-hours clock](https://github.com/TriliumNext/Trilium/issues/7646) — Basic localization/preference that belongs in settings; trivial but correct to add.
- [#7666 — Allow adjustable widths for the Content and TOC (Bookmarks) panes in the Share view](https://github.com/TriliumNext/Trilium/issues/7666) — Share view is a supported subsystem and configurable pane widths are a reasonable layout improvement.
### From Batch 03

- [#7827 — Increase donation visibility by adding a "Donate" entry in the Options page](https://github.com/TriliumNext/Trilium/issues/7827) — Simple Options page addition; fits an OSS project's sustainability goals without touching product scope.
- [#7876 — Implement site search with type ahead (OpenSearch)](https://github.com/TriliumNext/Trilium/issues/7876) — A small server-side OpenSearch description endpoint naturally complements the existing search URL and web interface.
- [#7885 — [quick-edit] new controls for quick-edit window management](https://github.com/TriliumNext/Trilium/issues/7885) — Concrete UI polish for an existing quick-edit widget with a clear mock-up.
- [#7886 — Allow inserting video previews in notes](https://github.com/TriliumNext/Trilium/issues/7886) — Inline video playback for mp4/webm attachments is a natural extension of the existing CKEditor media handling.
- [#7940 — Input Box Optimization: Add a Clear Button](https://github.com/TriliumNext/Trilium/issues/7940) — Minor form-control UX improvement that can be applied globally to attribute inputs.
- [#8121 — Checking for dead links](https://github.com/TriliumNext/Trilium/issues/8121) — Reasonable backend utility for a knowledge-base tool; fits as an optional maintenance action over Becca.
- [#8158 — Split lines into paragraphs](https://github.com/TriliumNext/Trilium/issues/8158) — Paste-handling tweak in CKEditor that addresses a common text-entry friction point.
- [#8174 — Add the "Distribute Columns" feature to the table](https://github.com/TriliumNext/Trilium/issues/8174) — Standard table editing affordance matching CKEditor's table feature set.
- [#8219 — Custom Icon Support (Upload/Delete Beyond Default Icons)](https://github.com/TriliumNext/Trilium/issues/8219) — Fits the existing icon/attribute system and is a commonly requested personalization feature.
- [#8228 — Make Github releases immutable](https://github.com/TriliumNext/Trilium/issues/8228) — A one-click repo setting improving supply-chain security for released binaries.
- [#8281 — Search history](https://github.com/TriliumNext/Trilium/issues/8281) — Small quality-of-life addition to the existing search bar; bounded scope.
### From Batch 02

- [#8319 — Improved Note-Maps](https://github.com/TriliumNext/Trilium/issues/8319) — Relation/note maps exist as a core visualization and filtering/coloring by label or link-depth is a natural extension of that widget.
- [#8332 — Global custom color palette for text background](https://github.com/TriliumNext/Trilium/issues/8332) — CKEditor5 supports configuring color palettes and exposing this via Options fits the existing theming/settings surface.
- [#8333 — Quick access UI for frequently used text background colors](https://github.com/TriliumNext/Trilium/issues/8333) — Last-used/recent-colors is a standard CKEditor5 toolbar pattern and a modest UX improvement to the existing editor.
- [#8372 — Support share_target in PWA to share files into Trilium notes](https://github.com/TriliumNext/Trilium/issues/8372) — Trilium ships a PWA and web clippers; registering a Web Share Target manifest entry fits the existing mobile-web story.
- [#8389 — Make it possible to add preact to Dialogs](https://github.com/TriliumNext/Trilium/issues/8389) — The frontend is migrating to Preact and exposing a typed Preact-component dialog API is a natural extension of the scripting surface.
- [#8466 — Naming and locking some note revisions](https://github.com/TriliumNext/Trilium/issues/8466) — Revisions are a core BRevision entity and pinning/naming individual revisions is a modest schema/UX addition with clear value.
- [#8526 — Ctrl+Click to multi-select in note tree](https://github.com/TriliumNext/Trilium/issues/8526) — Multi-select in the tree already exists for ranged selection; adding the standard non-adjacent modifier (configurable) is a straightforward tree-widget fix.
- [#8588 — Import .ics Calendar Support](https://github.com/TriliumNext/Trilium/issues/8588) — Trilium has a calendar/day-note subsystem and `.ics` import (one-shot or subscription) fits that existing surface.
- [#8606 — Implement Authorization on OpenID](https://github.com/TriliumNext/Trilium/issues/8606) — OIDC login already exists; gating it on a claim/subject allowlist is a small but important hardening for single-user self-hosters.
- [#8658 — OIDC groups claims for access control](https://github.com/TriliumNext/Trilium/issues/8658) — Same OIDC subsystem; evaluating a `groups` claim against an allowlist is a natural companion to the existing auth code.
- [#8699 — Backup enhancements (custom path, retention)](https://github.com/TriliumNext/Trilium/issues/8699) — The built-in backup service already runs on a schedule; making the path and retention configurable is a small extension of existing options.
- [#8720 — Inline Code copy button](https://github.com/TriliumNext/Trilium/issues/8720) — Block code already has a copy affordance; mirroring it on inline code fits the existing CKEditor5 code plugin.
### From Batch 01

- [#8912 — macOS dynamic traffic light offset based on zoom factor](https://github.com/TriliumNext/Trilium/issues/8912) — Small, self-contained Electron polish fix for a real visual bug on macOS with custom title bar.
- [#8941 — Ability to Download Backups](https://github.com/TriliumNext/Trilium/issues/8941) — Backups are a built-in feature and letting users download them from Settings is a natural, low-effort extension.
- [#8954 — Allow filtering by categories for custom icon packs](https://github.com/TriliumNext/Trilium/issues/8954) — Icon picker is an existing widget and 16k+ icons clearly need category filtering to remain usable.
- [#8955 — Simpler UI mode for new / casual users](https://github.com/TriliumNext/Trilium/issues/8955) — Reorganizing the context menu into the existing Advanced submenu is a reasonable onboarding improvement without removing functionality.
- [#9003 — Drag-and-drop files/folders to insert clickable file:// hyperlinks](https://github.com/TriliumNext/Trilium/issues/9003) — Fits the existing drag-and-drop import flow as an alternate modifier-key behavior, useful for local-knowledge-hub workflows.
- [#9029 — Integrated Web-Clipper](https://github.com/TriliumNext/Trilium/issues/9029) — An "import from URL" action in the web UI reuses existing clipper/import machinery and covers users who can't install the extension.
- [#9032 — Horizontal scroll bar for improved tab row navigation](https://github.com/TriliumNext/Trilium/issues/9032) — Tabs are a core UI element and scroll/overflow handling with many open tabs is a reasonable UX fix.
- [#9059 — Link Notes in PDF To Internal Notes](https://github.com/TriliumNext/Trilium/issues/9059) — Builds naturally on the existing internal link system and the new PDF viewer, complementing #8635.
- [#9120 — Images as links](https://github.com/TriliumNext/Trilium/issues/9120) — Basic CKEditor capability users reasonably expect from a rich-text editor; likely a small plugin/config tweak.
- [#9164 — PDF Export feature and font size](https://github.com/TriliumNext/Trilium/issues/9164) — Export is core functionality and inconsistent font sizing plus an export options dialog are reasonable improvements.
- [#9311 — Official RISC-V (riscv64) Docker image support](https://github.com/TriliumNext/Trilium/issues/9311) — Self-hosting on ARM/x86 is already supported and the reporter has a working PoC plus CI contribution offer, making it low-risk to add to the build matrix.
- [#9337 — Renaming Bookmarks](https://github.com/TriliumNext/Trilium/issues/9337) — Rename-propagation is already expected behavior for note links and bookmarks should behave consistently.
- [#9353 — Zoom with a pen tablet on canvas notes](https://github.com/TriliumNext/Trilium/issues/9353) — Canvas (Excalidraw) is a supported note type and keyboard-modifier zoom is a reasonable accessibility-style addition.

## Niche / Scripting Territory (77)

These serve specific workflows or small audiences. Trilium already has a scripting API + custom note types + templates — most of these could be built as user scripts or plugins without touching core. Each rationale includes the suggested alternative.

### From Batch 15

- [#641 — npm install additional libraries](https://github.com/TriliumNext/Trilium/issues/641) — Arbitrary npm module loading is an advanced scripting-environment concern best handled by users extending their own backend scripts.
- [#673 — External Resource Notes (npm/git-backed)](https://github.com/TriliumNext/Trilium/issues/673) — A highly speculative note type that could be prototyped as a custom note type or script rather than a core feature.
- [#825 — Link preview](https://github.com/TriliumNext/Trilium/issues/825) — Rich external link previews are better implemented as a custom widget/script since they involve third-party metadata fetching.
- [#986 — Community Code Library / Plugin System](https://github.com/TriliumNext/Trilium/issues/986) — A community plugin/theme registry is adjacent to Trilium's scripting model but is an ecosystem/infrastructure effort rather than a core feature.
### From Batch 14

- [#1142 — enhance link map](https://github.com/TriliumNext/Trilium/issues/1142) — TheBrain-style parent/child/jump visualization is a specialized visualization overhaul better explored as a custom view.
- [#1288 — save picture of linkmap](https://github.com/TriliumNext/Trilium/issues/1288) — Exporting the link map to image is niche and achievable via browser/devtools or scripting.
- [#1507 — save & reset link map arrangement & zoom level](https://github.com/TriliumNext/Trilium/issues/1507) — Persisted link-map layouts are niche polish for a legacy visualization feature.
- [#1650 — Copy notes from tree and paste into relation map](https://github.com/TriliumNext/Trilium/issues/1650) — Cross-widget clipboard into the (legacy) relation map is a narrow power-user workflow.
- [#1654 — Contextual Similar notes algorithm based on search string](https://github.com/TriliumNext/Trilium/issues/1654) — Threading search context into similar-notes ranking is a speculative tweak to an existing heuristic.
- [#1697 — Populate a hyperlinked md file from table rows](https://github.com/TriliumNext/Trilium/issues/1697) — Table-to-templated-note generation is squarely a scripting/template use case.
- [#1716 — Generating citation from note attributes](https://github.com/TriliumNext/Trilium/issues/1716) — BibTeX generation from promoted attributes is a classic backend-script use case.
### From Batch 13

- [#1850 — Collapsable bullets](https://github.com/TriliumNext/Trilium/issues/1850) — Outliner-style collapsible bullets are a CKEditor-heavy feature better handled as a custom plugin/script.
- [#1949 — Fine-grained inheritance control (depth, conditions)](https://github.com/TriliumNext/Trilium/issues/1949) — Complex conditional inheritance is better expressed via scripted attribute logic.
- [#1950 — Transclusion of attributes/searches into note body](https://github.com/TriliumNext/Trilium/issues/1950) — Already achievable via render notes / scripts as the author acknowledges.
- [#1958 — Bulk note creation from text list](https://github.com/TriliumNext/Trilium/issues/1958) — One-off import/scaffold operation well-suited to a backend script.
- [#2115 — BibTeX citation support like Zettlr](https://github.com/TriliumNext/Trilium/issues/2115) — Academic citation workflow is niche and better as a custom CKEditor plugin/script.
- [#2186 — today/yesterday search terms for day notes](https://github.com/TriliumNext/Trilium/issues/2186) — Relative date search aliases are easily handled in a small script as the author already plans.
- [#2330 — Aggregate unfinished TODO items from notes](https://github.com/TriliumNext/Trilium/issues/2330) — Canonical use case for a backend search/render script.
- [#2351 — Documentation for mobile frontend plugin buttons](https://github.com/TriliumNext/Trilium/issues/2351) — Docs request about the scripting/launcher extension surface, handled in the script API docs.
- [#2354 — Group edited-notes list by shared path](https://github.com/TriliumNext/Trilium/issues/2354) — Specific cosmetic preference for the edited-notes widget, easily done via a custom render script.
### From Batch 12

- [#2526 — Simple recurring todo](https://github.com/TriliumNext/Trilium/issues/2526) — Todo/recurrence is not a first-class concept in Trilium and is well-suited to a backend script via the existing API.
- [#2544 — Forms/Fields in a template](https://github.com/TriliumNext/Trilium/issues/2544) — Structured form fields are largely achievable today via promoted attributes and templates; further custom forms are scripting territory.
- [#2802 — Shared SQL between SQL code notes](https://github.com/TriliumNext/Trilium/issues/2802) — An `%INCLUDE%` mechanism for ad-hoc SQL notes is a niche power-user tweak better done via scripting.
- [#3037 — Upgrade the Relation Map (dynamic scripting)](https://github.com/TriliumNext/Trilium/issues/3037) — Dynamic scripted styling/rendering inside Relation Maps is niche and overlaps with Render Notes/scripting.
### From Batch 11

- [#3269 — "Repeated but unique" relation constraint](https://github.com/TriliumNext/Trilium/issues/3269) — Highly personal citation-graph requirement that a backend script attribute-validator can handle.
- [#3493 — Attribute inheritance across arbitrary relations](https://github.com/TriliumNext/Trilium/issues/3493) — Powerful but complex semantics; best prototyped via scripting before touching core attribute engine.
- [#3498 — More ranking signals / ML for search and autocomplete](https://github.com/TriliumNext/Trilium/issues/3498) — Ambitious ranking overhaul with ML ambitions more suited to experimentation/plugin rather than core search.
- [#3551 — Custom context-menu widget API](https://github.com/TriliumNext/Trilium/issues/3551) — A plugin/scripting extension point rather than a built-in product feature.
- [#3557 — Full-text search via command line](https://github.com/TriliumNext/Trilium/issues/3557) — Niche CLI integration that ETAPI plus a small user script already covers.
### From Batch 10

- [#3798 — Reference page listing all link locations](https://github.com/TriliumNext/Trilium/issues/3798) — Easily built as a backend script walking a subtree; too specific to warrant a core feature.
- [#3840 — Transclusion as a note map relation type](https://github.com/TriliumNext/Trilium/issues/3840) — A very specialized note-map view that fits custom visualization scripting rather than a core toggle.
- [#3902 — View child notes inside canvas note](https://github.com/TriliumNext/Trilium/issues/3902) — Excalidraw-specific cross-note rendering is niche and partially overlaps relation map; better suited as a custom canvas integration.
- [#3905 — Central Excalidraw library for all canvas notes](https://github.com/TriliumNext/Trilium/issues/3905) — Niche Excalidraw workflow that can be handled via cloned library notes or scripting.
- [#4052 — File selecting items stored in notes](https://github.com/TriliumNext/Trilium/issues/4052) — Exposing note attachments to OS file pickers is an OS/browser sandboxing issue beyond Trilium's scope, and partially scriptable.
- [#4061 — Unix Days as calendar](https://github.com/TriliumNext/Trilium/issues/4061) — Extremely niche alternative calendar format that is better suited to a user script or custom day-note structure.
### From Batch 09

- [#4203 — Import/Export multilevel node as single MD file](https://github.com/TriliumNext/Trilium/issues/4203) — Non-standard export format (flatten subtree into headings) better handled via a custom export script.
- [#4354 — Input cursor always positioned in the center of screen](https://github.com/TriliumNext/Trilium/issues/4354) — Typewriter-mode is a niche editor preference better implemented as a user script/CSS.
- [#4384 — Display attachments directly inside notes](https://github.com/TriliumNext/Trilium/issues/4384) — Conflicts with the note/attachment model; inline video/PDF playback for arbitrary attachments is a niche rendering ask handled by custom widgets.
- [#4651 — Include webviews into text notes as preview](https://github.com/TriliumNext/Trilium/issues/4651) — Niche preview-in-note rendering that's better handled by custom scripts or note-type-specific widgets.
- [#4668 — Create clone location when it doesn't exist](https://github.com/TriliumNext/Trilium/issues/4668) — Edge-case workflow tweak to the clone dialog that's unlikely to benefit most users.
- [#4755 — Enable trilium iframe compatibility](https://github.com/TriliumNext/Trilium/issues/4755) — Weakens security headers (X-Frame-Options/CSP) for a niche reverse-proxy embed use case; at most a config option.
- [#4811 — Attribute to change document link behaviour](https://github.com/TriliumNext/Trilium/issues/4811) — Small link-target preference that is easily handled by custom CSS or a user script.
- [#4832 — Tag-based note connections in Note Map](https://github.com/TriliumNext/Trilium/issues/4832) — Relation Map already supports custom attribute-driven connections; this is a niche visualization tweak.
### From Batch 08

- [#5217 — Friendly share urls: turn title into shareAlias](https://github.com/TriliumNext/Trilium/issues/5217) — The request itself explicitly proposes this as a user script/button action.
- [#5268 — Register icon pack in mermaid](https://github.com/TriliumNext/Trilium/issues/5268) — Custom mermaid icon pack registration is a niche configuration better handled via scripting or mermaid config.
### From Batch 07

- [#5410 — Add the ability to create a shell link (shortcut) for a note](https://github.com/TriliumNext/Trilium/issues/5410) — OS-specific shortcut file generation is better served by user scripts or manual URL-based shortcuts.
- [#5480 — Notification API for scripts](https://github.com/TriliumNext/Trilium/issues/5480) — A narrow scripting API addition that benefits a small set of script authors; reasonable but scoped to the scripting surface.
- [#5481 — Selected Note API for scripts](https://github.com/TriliumNext/Trilium/issues/5481) — Another targeted scripting API extension useful primarily for custom script workflows.
- [#5511 — Calculated content in templates via inline Javascript](https://github.com/TriliumNext/Trilium/issues/5511) — Templating with inline JS overlaps with existing `runOnNoteCreation` scripting and is better handled by improving that path rather than adding a new evaluator.
### From Batch 06

- [#5572 — API Function to Raise Window](https://github.com/TriliumNext/Trilium/issues/5572) — Very specific Electron convenience; could be added as a small frontend API helper, but is otherwise a user-script concern.
- [#5585 — Search Prefix (JS code block for result prefixes)](https://github.com/TriliumNext/Trilium/issues/5585) — Arbitrary code hook for search rendering is better expressed as a custom render script or a render-note feature rather than a core search option.
### From Batch 05

- [#5825 — Annotate image](https://github.com/TriliumNext/Trilium/issues/5825) — Would require a dedicated image editor; better covered by pasting into the existing Canvas (Excalidraw) note type and annotating there.
- [#5849 — macOS-style label/tag system](https://github.com/TriliumNext/Trilium/issues/5849) — Duplicates Trilium's attribute/label system; any macOS-flavored UI could be a user CSS/script theme.
- [#6350 — Repeat last action shortcut (Word-style F4)](https://github.com/TriliumNext/Trilium/issues/6350) — CKEditor doesn't expose a generic "last command" model; realistically a custom CKEditor plugin experiment rather than a core feature.
- [#6407 — Kanban Board enhancements (subtasks, progress, drag-drop)](https://github.com/TriliumNext/Trilium/issues/6407) — Kanban is not a core Trilium subsystem; these project-management flourishes are better as a community template/script package.
- [#6409 — Checklist progress](https://github.com/TriliumNext/Trilium/issues/6409) — A nice-to-have text editor sugar achievable today with a frontend script counting `<input type=checkbox>` in note content.
- [#6779 — Embedded playbook / runnable script steps](https://github.com/TriliumNext/Trilium/issues/6779) — Overlaps with Trilium's existing backend script note type; a richer multi-step runbook UI is a narrow power-user workflow better built as a custom note type or script.
### From Batch 04

- [#7006 — hope to add protect single note frontApi](https://github.com/TriliumNext/Trilium/issues/7006) — Per-note lock-on-tab-switch is a specific privacy workflow; exposing a frontend API hook is fine but the feature itself is better implemented as a user script using existing protected-session primitives.
- [#7024 — where is my clone note? An easy way to find clone note](https://github.com/TriliumNext/Trilium/issues/7024) — The underlying request (locate clones of a specific note) is reasonable but the proposed solution overlaps with existing note-path and note-map features; a small script or a note-map filter would address it without new core UI.
- [#7291 — Calendar view adds support for Resource Timeline](https://github.com/TriliumNext/Trilium/issues/7291) — Resource timelines are a scheduling/project-management use case well outside typical PKM; better addressed by a custom FullCalendar-based script or a dedicated template.
- [#7635 — Option to use background images in presentations](https://github.com/TriliumNext/Trilium/issues/7635) — Reveal.js presentation polish for a specific subset of users; better handled via per-slide attributes or a script that sets reveal.js background properties.
- [#7670 — Attachment link customization](https://github.com/TriliumNext/Trilium/issues/7670) — Custom share URL routing to enable Google Docs preview is a specific integration workflow; better as a share-layer customization or reverse-proxy rewrite than a core feature.
### From Batch 03

- [#7893 — Add Podman installation to documentation](https://github.com/TriliumNext/Trilium/issues/7893) — Docs-only request for an alternate container runtime; better handled as a community wiki/docs PR than core work.
- [#7923 — Auto Import Folder Contents To Trilium](https://github.com/TriliumNext/Trilium/issues/7923) — Filesystem watcher inbox is a specific workflow; better as a backend script using the existing import API.
- [#8107 — Support Markdown (mindmap extension) syntax](https://github.com/TriliumNext/Trilium/issues/8107) — Unclear/niche mind-map markdown dialect request; more appropriate as a custom importer or script than built-in syntax.
- [#8140 — "shareExternalLink"-type label for PDF generation](https://github.com/TriliumNext/Trilium/issues/8140) — Specialized collaboration workaround for DNS-blocked colleagues; a backend script rewriting links pre-export would fit the workflow.
- [#8150 — Note header image](https://github.com/TriliumNext/Trilium/issues/8150) — Cosmetic SiYuan/Craft-style feature; achievable today via custom CSS or a script-injected template.
### From Batch 02

- [#8382 — Inline tabs in pages](https://github.com/TriliumNext/Trilium/issues/8382) — An admonition-style tab block is doable but better shipped as a custom CKEditor5 plugin (similar to the existing admonition/footnotes packages) rather than as a core content primitive.
- [#8590 — Custom Font Selection with System Font Support](https://github.com/TriliumNext/Trilium/issues/8590) — Font family is already configurable via CSS/themes; a system-font enumerator is a niche cosmetic feature better served by a theme or user CSS snippet.
- [#8600 — Microsoft Word style whole-word formatting commands](https://github.com/TriliumNext/Trilium/issues/8600) — Very small CKEditor5 behavioral tweak serving a narrow muscle-memory preference; fine as an upstream config or frontend script.
- [#8663 — Web Clipper for ChatGPT](https://github.com/TriliumNext/Trilium/issues/8663) — ChatGPT's virtualized DOM breaks the generic clipper; a site-specific extractor is a fragile, single-site special case better handled by a user script or Readability tweak.
- [#8700 — Add G-code formatting](https://github.com/TriliumNext/Trilium/issues/8700) — CodeMirror/highlight.js already cover mainstream languages; G-code is a niche CNC domain better shipped as a user-contributed syntax mode than bundled by default.
### From Batch 01

- [#8766 — Checkbox tree](https://github.com/TriliumNext/Trilium/issues/8766) — Multi-select-with-checkboxes on the note tree is a niche workflow; could be achieved via a frontend script or custom tree widget rather than core.
- [#8957 — Better Separation Between Notes and System Scripts](https://github.com/TriliumNext/Trilium/issues/8957) — Trilium already has the hidden subtree and `#template`/`#appCss` attributes; users can organize their own scripts into a dedicated branch or use the existing hidden subtree conventions.
- [#8963 — Bookmark while viewing pdf](https://github.com/TriliumNext/Trilium/issues/8963) — Per-PDF bookmarking is specific to heavy PDF readers; better served by the native PDF.js viewer's own features or a custom widget than by first-class note metadata.
- [#9006 — Switch Alt Enter with Enter](https://github.com/TriliumNext/Trilium/issues/9006) — Personal keybinding preference that conflicts with standard rich-text paragraph behavior; users can remap via the existing keyboard shortcut settings.
- [#9336 — Global Bookmarks](https://github.com/TriliumNext/Trilium/issues/9336) — This reinvents cross-note anchors/named links; the existing internal-link and `#` reference system already addresses the underlying need without a new global namespace.

## Out of Scope (55)

These don't fit Trilium's identity as a personal hierarchical note-taking app with power-user features. Common rejection themes: real-time collaboration, CMS-style publishing, IDE-like features, fundamental architectural rewrites (sync protocol, encryption model), tool replacements, vendor promos. Each rationale names what Trilium would have to become to accept it.

### From Batch 15

- [#1026 — Show Trilium content related to my web searches](https://github.com/TriliumNext/Trilium/issues/1026) — A browser search-results injection feature is outside the clipper's scope and raises privacy/complexity concerns.
- [#242 — CalDAV Support](https://github.com/TriliumNext/Trilium/issues/242) — Implementing CalDAV server/client protocol for calendar and task sync is well outside Trilium's PKM scope.
### From Batch 14

- [#1209 — Clipper for PDF files?](https://github.com/TriliumNext/Trilium/issues/1209) — Bulk PDF ingestion and metadata scraping is beyond the web clipper's scope; PDFs are already importable as file notes.
- [#1233 — Block Reference and transclude function](https://github.com/TriliumNext/Trilium/issues/1233) — Obsidian/Roam-style block transclusion conflicts with Trilium's note-level model and CKEditor architecture.
- [#1280 — Enabling custom Ckeditor plugins](https://github.com/TriliumNext/Trilium/issues/1280) — User-installable CKEditor plugins is an Obsidian-plugin-style ecosystem Trilium explicitly does not pursue.
- [#1386 — Zotero integration](https://github.com/TriliumNext/Trilium/issues/1386) — Deep reference-manager integration is outside PKM core and better implemented via scripts/ETAPI.
- [#1479 — Apache proxy setup notes](https://github.com/TriliumNext/Trilium/issues/1479) — This is wiki/documentation feedback, not a product feature.
- [#1567 — Proof import / sanitize filenames](https://github.com/TriliumNext/Trilium/issues/1567) — Mixes a bug-style concern with niche filename-rewriting that would likely break round-trip import/export semantics.
- [#1589 — Setting to reduce logging only to errors](https://github.com/TriliumNext/Trilium/issues/1589) — Log verbosity tuning is a low-value config knob; standard syslog filtering handles this externally.
- [#1625 — Add custom MIME types for code notes](https://github.com/TriliumNext/Trilium/issues/1625) — Referenced race-condition history and CodeMirror maintenance burden make this an unattractive extension point.
- [#1704 — Content block reference and embedding](https://github.com/TriliumNext/Trilium/issues/1704) — Same as #1233: block transclusion is fundamentally incompatible with Trilium's editor architecture.
### From Batch 13

- [#1853 — Zotero engines.json integration](https://github.com/TriliumNext/Trilium/issues/1853) — Zotero-side config for external lookup, not something Trilium itself should ship.
- [#1909 — One-way asymmetric encryption of notes](https://github.com/TriliumNext/Trilium/issues/1909) — Introduces a whole new crypto model duplicating the existing protected-notes feature with uncertain security benefit.
- [#1927 — Andy Matuschak-style stacked note navigation](https://github.com/TriliumNext/Trilium/issues/1927) — Fundamentally different navigation paradigm that doesn't match Trilium's tab/tree model.
- [#2159 — jsPlumb node groups in relation map](https://github.com/TriliumNext/Trilium/issues/2159) — Highly specific to the legacy relation-map implementation and unlikely to be prioritized.
- [#2259 — Embedded Neovim support](https://github.com/TriliumNext/Trilium/issues/2259) — Embedding nvim turns Trilium into an IDE host, far outside its scope (Vim keybindings in CodeMirror already exist).
- [#2261 — Chrome "create shortcut" start URL](https://github.com/TriliumNext/Trilium/issues/2261) — Browser-specific PWA launcher workaround; user can configure URL manually.
- [#2391 — One-click CapRover installation](https://github.com/TriliumNext/Trilium/issues/2391) — Belongs in CapRover's own one-click apps catalog, not Trilium's repo.
- [#2404 — Google-style full-text search results](https://github.com/TriliumNext/Trilium/issues/2404) — Vague ask to reskin search results as a web search engine; doesn't match a hierarchical note UI.
### From Batch 12

- [#2620 — Expiration date & max requests for shared notes](https://github.com/TriliumNext/Trilium/issues/2620) — Share lifecycle/rate limiting leans toward a publishing/CMS feature beyond Trilium's personal PKM sharing model.
- [#2637 — Allow styling of mini date selector](https://github.com/TriliumNext/Trilium/issues/2637) — The native browser control cannot be styled without rewriting the widget, for marginal benefit.
- [#2654 — Server to Server Sync](https://github.com/TriliumNext/Trilium/issues/2654) — Multi-master/HA clustering fundamentally conflicts with Trilium's single-authoritative-server sync design.
- [#2726 — Block References like Obsidian/Logseq](https://github.com/TriliumNext/Trilium/issues/2726) — Block-level referencing is a core data-model shift that doesn't fit Trilium's note-as-unit model.
- [#2869 — Bypass auth for specific IP/subnet](https://github.com/TriliumNext/Trilium/issues/2869) — IP-based auth bypass is better handled by a reverse proxy and introduces security risk Trilium shouldn't own.
### From Batch 11

- [#3246 — Integrate PlantUML via CKEditor plugin](https://github.com/TriliumNext/Trilium/issues/3246) — Relies on an unmaintained third-party plugin and overlaps with the existing Mermaid support.
- [#3263 — Generalize the tree to arbitrary transitive relations](https://github.com/TriliumNext/Trilium/issues/3263) — Fundamental rethink of Trilium's core tree model, incompatible with existing UI/data assumptions.
- [#3399 — Export descendants plus linked notes](https://github.com/TriliumNext/Trilium/issues/3399) — Expanding export beyond the hierarchy would require complex closure/cycle handling not aligned with the export model.
- [#3633 — Web page snapshotting / Scrapyard-like offline capture](https://github.com/TriliumNext/Trilium/issues/3633) — Large archiving feature belongs in the web clipper domain, not the core app.
### From Batch 10

- [#3825 — Office document support](https://github.com/TriliumNext/Trilium/issues/3825) — Embedding/editing Office documents is outside Trilium's PKM scope and is adequately handled by file attachments.
- [#3865 — MyScript Handwriting integration](https://github.com/TriliumNext/Trilium/issues/3865) — Bundling a third-party commercial handwriting API is out of scope for a local-first PKM tool.
- [#3906 — Host Trilium demo instance](https://github.com/TriliumNext/Trilium/issues/3906) — This is a community/hosting request, not a product feature, and unsuitable for a self-hosted multi-user app.
- [#3978 — Login page custom background](https://github.com/TriliumNext/Trilium/issues/3978) — Cosmetic tweak to the server login page, already achievable via custom CSS and not worth a built-in setting.
- [#4099 — Rename "clones" to "instances"](https://github.com/TriliumNext/Trilium/issues/4099) — Terminology rename of a deeply embedded concept would cause documentation and API churn for marginal clarity gains.
### From Batch 09

- [#4345 — Sync API support for ETAPI](https://github.com/TriliumNext/Trilium/issues/4345) — Exposing the internal sync/changelog protocol via ETAPI risks corrupting the sync state machine and is outside ETAPI's mandate.
- [#4701 — LanguageTool integration](https://github.com/TriliumNext/Trilium/issues/4701) — Grammar checking is an external service integration better left to browser extensions or user scripts, not core Trilium.
- [#4816 — Public Link with Advanced Search on shared tree](https://github.com/TriliumNext/Trilium/issues/4816) — Pushes Shaca/shared notes toward becoming a publishing CMS with guest accounts, contrary to core identity.
- [#4834 — Import PDF files into Canvas notes](https://github.com/TriliumNext/Trilium/issues/4834) — PDF-to-image rasterization is a heavy external dependency for a niche Excalidraw workflow.
- [#4837 — Cloud Deployment](https://github.com/TriliumNext/Trilium/issues/4837) — Trilium already ships Docker; packaging for a dozen third-party PaaS platforms is not core team work.
### From Batch 08

- [#4871 — Adding Elestio as deployment option](https://github.com/TriliumNext/Trilium/issues/4871) — Vendor promotional/partnership request, not a product feature.
- [#4956 — Milestone: Multi-user support](https://github.com/TriliumNext/Trilium/issues/4956) — Multi-user/collaboration contradicts Trilium's stated single-user PKM identity.
- [#4957 — End-to-end encryption (database-level)](https://github.com/TriliumNext/Trilium/issues/4957) — Conflicts with server-side features like search and share; Trilium already has per-note protected encryption.
- [#4969 — Note editors other than CKEditor](https://github.com/TriliumNext/Trilium/issues/4969) — Swapping out the core rich text editor is infeasible and conflicts with the CKEditor-centric architecture.
### From Batch 07

- [#5355 — Import/Merge another Trilium database into current database](https://github.com/TriliumNext/Trilium/issues/5355) — Merging entire databases conflicts with Trilium's sync model and would introduce severe entity-ID and revision conflicts; users should use sync instead.
- [#5451 — Add polylines or polygons on the geomap note type](https://github.com/TriliumNext/Trilium/issues/5451) — Turning the geomap into a GIS drawing tool goes well beyond its note-pinning purpose.
### From Batch 06

- [#5561 — task management (Kanban + progress + timeline + repetition)](https://github.com/TriliumNext/Trilium/issues/5561) — Turns Trilium into a task/PM tool; Kanban-first workflows and scheduled recurring tasks are outside core PKM identity.
- [#5598 — Run multiple client instances / connect to multiple servers](https://github.com/TriliumNext/Trilium/issues/5598) — Requires fundamentally rethinking the single-profile Electron architecture and multi-server sync model.
- [#5690 — markdown editor](https://github.com/TriliumNext/Trilium/issues/5690) — Duplicates the existing rich text editor's role; Trilium's model is CKEditor5 with markdown import/export, not a parallel raw-markdown note type.
- [#5692 — codesandbox Sandpack note or plugin](https://github.com/TriliumNext/Trilium/issues/5692) — Embedding a live code sandbox turns Trilium into a code playground/IDE, far outside PKM scope.
### From Batch 05

- [#6351 — Mount part of note tree as writable filesystem folder](https://github.com/TriliumNext/Trilium/issues/6351) — Would require a FUSE/WebDAV layer with bidirectional sync semantics, conflicting with Trilium's database-first architecture.
- [#6406 — Packaging for Chocolatey](https://github.com/TriliumNext/Trilium/issues/6406) — Third-party package repository work; should live with a community maintainer, not in the core project.
- [#6546 — Store file notes on the filesystem instead of the database](https://github.com/TriliumNext/Trilium/issues/6546) — Fundamental storage model change that breaks the single-file portability, sync, and protected-note guarantees Trilium is built around.
### From Batch 04

- [#7411 — Better encryption algorithms](https://github.com/TriliumNext/Trilium/issues/7411) — Trilium already uses AES-128 with a deliberate tradeoff; swapping to XChaCha20-Poly1305/Argon2id means a migration path, sync-protocol changes, and cross-client crypto rewrites with low practical security ROI for personal notes.
### From Batch 03

- [#8225 — Offline mode for the PWA](https://github.com/TriliumNext/Trilium/issues/8225) — Would require reimplementing the full Becca stack and sync engine in the browser (IndexedDB, service worker), essentially a new client architecture with very low ROI given the Electron app already exists.
### From Batch 02

- [#8477 — Folders, folders, folders (installer/data dir picker)](https://github.com/TriliumNext/Trilium/issues/8477) — This is a packaging/installer complaint, not a product feature; the data directory is already configurable via env vars and the Electron installer is standard — it would require replacing the installer/packaging stack with no product benefit.
- [#8534 — Password reset makes protected notes unrecoverable](https://github.com/TriliumNext/Trilium/issues/8534) — The proposed "deterministic key from password" fix would break the entire protected-session threat model (it is *designed* so that losing the password loses the data); this is a docs/UX warning issue, not a feature the product should adopt.

## Unclear (2)

These couldn't be judged without clarification from the reporter. Not rejections — ping the reporter.

### From Batch 08

- [#4922 — restore backed up database files to notes](https://github.com/TriliumNext/Trilium/issues/4922) — The request mixes a sync failure bug report with an unclear restore workflow; intent is ambiguous.
### From Batch 03

- [#8122 — Continue updating on chocolatey repository](https://github.com/TriliumNext/Trilium/issues/8122) — Needs clarification on whether this refers to the legacy zadam/Trilium Chocolatey package or a new TriliumNext publish, and who would own maintenance.
