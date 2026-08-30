# Trilium Notes — Competitive Analysis & Strategic Action Plan

*August 2026 · based on the v0.105.0 codebase, the TriliumNext/Trilium issue tracker, and a market scan of the PKM/note-taking landscape*

## Executive summary

Trilium is in the strongest position of its life: the fork succession was unusually clean (~30k stars, steady v0.98→v0.105 release cadence), the Preact migration is modernizing the UI incrementally instead of via a risky rewrite, and the standalone WASM build plus the LLM/MCP stack are capabilities most competitors do not have. But the market moved in 2025–2026: Obsidian dropped its commercial-license fee and shipped Bases and Mobile 2.0; SiYuan (~46k stars, Trilium's nearest feature twin) repositioned as an AI-agent workspace; E2EE became table stakes for the privacy segment; and even solo-PKM tools now ship some form of collaboration.

Trilium's edge will not come from out-Notioning Notion or out-plugging Obsidian. It comes from doubling down on the combination nobody else has — **a fully self-hostable, scriptable, hierarchical knowledge base whose entire backend also runs in the browser, with first-party AI/MCP integration** — while closing the four gaps that actively push users away: **mobile, offline/sync robustness, encryption depth, and data-format lock-in anxiety.**

The single highest-leverage fact in the research: the official-mobile-app milestone (#7447) gathered **77 reactions in weeks** — more than any open feature request — and the website FAQ *still says no official mobile app exists*, while a working Capacitor app sits in `apps/mobile` with signed Android nightlies. Trilium's biggest competitive problem is partly a shipping-and-messaging problem, not only an engineering one.

---

## 1. Where Trilium stands today

### Durable strengths (the moat)

| Strength | Evidence | Who else has it |
|---|---|---|
| Free self-hosted sync server | Custom entity-change protocol, `packages/trilium-core/src/services/sync.ts` | Joplin (via WebDAV/Nextcloud), SiYuan (paid unlock) — none as integrated |
| True hierarchy with cloning (multi-parent tree) | `BBranch` entity model | Effectively unique; praised repeatedly in switch-to stories |
| Per-note attributes with inheritance, templates, promoted attributes | Becca entity/attribute system | Anytype/Capacities have objects; none combine with hierarchy + scripting |
| Full JS scripting, front and back | `frontend_script_api.ts`, `backend_script_api.ts`, custom request handlers/resource providers | Nobody. Obsidian plugins are frontend-only |
| **Whole backend in the browser** (SQLite-WASM + OPFS, leader election, service-worker request routing) | `apps/standalone`, deployed at app.triliumnotes.org | **Nobody.** This is architecturally unique in the category |
| First-party AI: 5 LLM providers + agent hosts (Claude Code, Copilot), tool registries, skill sheets, **MCP server** | `packages/trilium-core/src/services/llm/`, `apps/server/src/services/mcp/` | SiYuan and Tana lead here; Obsidian delegates to plugins; Trilium is ahead of most |
| Notion-style collections (Table, Board, Calendar, Geo, Presentation, Dashboard) | `apps/client/src/widgets/collections/` | Caught up fast; Obsidian Bases is the benchmark now |
| Import breadth (Evernote, Notion, Obsidian, OneNote, Keep, Anytype, OPML, Markdown) | `packages/trilium-core/src/services/import/` | Best-in-class switching funnel |
| 18 note types incl. canvas, mermaid, mind map, spreadsheet, geo map | `ALLOWED_NOTE_TYPES` in `packages/commons/src/lib/rows.ts` | Breadth few match in one app |

### Structural weaknesses (the gaps users cite when they leave)

1. **Mobile.** `apps/mobile` is a thin Capacitor shell at version 0.102.2 (core is at 0.105.0); iOS has CI builds but no signing or store publishing; the website FAQ (`apps/website/src/translations/en/translation.json`) still states "Currently there is no official mobile application." Users fall back to the mobile web layout or third-party apps (TriliumDroid). This is the #1 demand signal and the #1 complaint.
2. **Encryption depth.** Only `isProtected` entities are encrypted, using **AES-128-CBC with a SHA-1 checksum** (`data_encryption.ts`) — while backups already use AES-256-GCM. Ordinary notes sync **in plaintext** to the sync server. Notesnook, Anytype, Joplin, Standard Notes and Reflect all offer E2EE; issue #7411 asks for modern crypto.
3. **No collaboration of any kind.** Single-user by design (`Security.md`); no CRDT/Yjs/automerge anywhere in the repo; sync conflict resolution is last-write-wins with no merge UI and a documented manual-recovery path for divergence. Multi-user (#4956) is the most-reacted open issue (38 reactions, 111 comments, an IssueHunt bounty).
4. **Lock-in anxiety.** Notes are HTML in SQLite. HN threads repeatedly hold this against Trilium vs. Obsidian/Logseq's file-first model. Attributes don't round-trip through Markdown export (#8452). This anxiety costs adoptions regardless of how good the export actually is.
5. **No plugin ecosystem.** Scripting is more powerful than any plugin API, but there is no manifest, registry, marketplace or sandbox — so there is no discoverability flywheel and no long tail of community contributions visible to prospects. Obsidian's ~4,300 plugins is its moat; Trilium's equivalent asset (script notes) is invisible.
6. **Offline on the web is incomplete.** The server-backed web client has no service worker (installable shell only); the standalone build's service worker has `isDev = true` hardcoded, disabling its precache paths. Offline PWA is a top-15 ask (#8225).
7. **Complexity tax.** "Dated/complex UI" recurs in reviews; #8955 explicitly asks for a simpler mode. The market discourse ("second-brain fatigue") is moving toward capture-and-retrieve with AI doing the organizing — pressure against manual-system maximalism.
8. **No official hosted offering and single-maintainer funding.** The FAQ points at third-party PikaPods. Sync pricing across the market has converged at $3–8/user/mo — revenue competitors capture and Trilium forgoes, while large efforts (mobile) depend on donations.

---

## 2. Competitive landscape, condensed

- **Obsidian** — the tool to beat for power users. Bases (native database views + API, Map/List views in v1.10), Mobile 2.0, free-for-commercial-use. Weaknesses to attack: paid sync ($4/mo)/publish stack, plugin quality/security sprawl, no backend/scripting server, markdown-only data model, no self-hosted web access.
- **SiYuan** — nearest feature twin (block refs, WYSIWYG, self-hosted, plugin bazaar, ~46k stars), now marketing itself as a human+AI-agent workspace with built-in agent sessions and MCP plugins. Strong in China, weak Western docs/community — a window Trilium can occupy in the West with the same positioning, which it already has the plumbing for.
- **Logseq** — the cautionary tale: 3-year DB rewrite shipped July 2026 but starved the shipping product and bled users. Validates Trilium's incremental Preact migration strategy; never big-bang rewrite.
- **Joplin** — steady rival for the self-host segment: E2EE, Joplin Cloud ($3–8.50/mo), plugins, now whiteboards. Trilium beats it on data model, scripting, and collections; Joplin beats Trilium on E2EE, mobile maturity, and hosted offering.
- **Anytype / Notesnook / AppFlowy** — the local-first/E2EE cohort. AppFlowy's local-AI-via-Ollama is a differentiator Trilium can match trivially (the `local` OpenAI-compatible provider already exists — it needs packaging and marketing, not engineering).
- **Notion** — AI-first pivot with credit-metered agents and an effective price increase; offline still partial; no E2EE, no self-host. Trilium's best conversion source (the importer already exists; the XDA "I replaced Notion with Trilium Next" genre is live).
- **NotebookLM & AI-native tools (Tana, Reflect, Capacities)** — category threat that resets expectations: notes as *fuel for AI* rather than an end artifact. MCP SDK downloads grew from 2M/mo (late 2024) to ~97M/mo (early 2026). Trilium already ships an MCP server — almost nobody knows.

---

## 3. Missed opportunities

1. **The standalone WASM build is unmarketed category-defining tech.** "Open a URL, get the full app, your data stays in your browser; connect it to your sync server and every device is a full client with zero install" is a story neither Obsidian (paid sync, installed app) nor Notion (cloud-only) can tell. It is currently a footnote.
2. **AI positioning is ahead of the market and invisible.** Multi-provider LLM chat, agent host providers (Claude Code, GitHub Copilot), tool registries, skill sheets, an authenticated MCP server, in-editor AI — this is the SiYuan/Tana pitch, already implemented, absent from the homepage.
3. **Mobile demand (77 reactions) is unmonetized attention.** The pivot from React Native to Capacitor was sound engineering, but closing #7447 as "not planned" while the work continued in-tree created a perception gap the website still reinforces.
4. **The switching funnel is built but not aimed.** Six dedicated importers exist exactly when Notion raises prices, Logseq resets, and Evernote decays — with no landing pages ("Trilium for Notion refugees") to catch that traffic.
5. **Scripting has no showcase.** The most differentiated feature has no gallery, no one-click install, no registry — `apps/script-deployer` and icon packs are seeds of a packaged-extension format that was never grown.
6. **A hosted sync service is a self-funding flywheel** at the market-converged $4–8/mo — and pairing it with E2EE sync (gap #2) would make it the only open-source, self-hostable *and* zero-knowledge-hosted offering in the category.

---

## 4. Action plan

### P0 — Ship and tell the truth (next 1–2 quarters, mostly low engineering risk)

1. **Publish the mobile app.** Bring `apps/mobile` to version parity; Play Store open beta from the existing signed nightly pipeline; iOS signing + TestFlight. Reopen a public mobile milestone so the 77-reaction demand has somewhere to point.
2. **Fix the messaging debt now.** Update the website FAQ (no-mobile-app and no-hosted claims), fix the `Architecture.md` "multi-user capable" contradiction, and put the standalone build + AI/MCP on the homepage. This is days of work against a real perception drag.
3. **Offline PWA (#8225).** Remove the hardcoded `isDev = true` in `apps/standalone/src/sw.ts`, enable precache, and define the offline story for the server-backed client (either a real service worker or an explicit "use standalone + sync" path).
4. **Crypto refresh (#7411).** Migrate protected notes from AES-128-CBC/SHA-1 to AES-256-GCM (the backup path already uses it) with a versioned migration. Cheap to do, expensive to be criticized for.
5. **Flathub (#5108, 16 reactions).** A packaging task that buys Linux distribution and legitimacy.

### P1 — Sharpen the differentiators (2–4 quarters)

6. **Collections parity push**: table filtering (#8481), multi-attribute sort (#6829), and task management (#5561, building on checkbox-tree #8766) — with **Attributes V2 (#6421, typed values + enum labels #4124)** as the foundation, since filtering and Bases-class views are only as good as the property system under them.
7. **Lock-in relief as a feature**: full-fidelity Markdown + frontmatter round-trip (export attributes, #8452 — import already parses frontmatter), documented and marketed ("your data is never trapped"). Consider a read-only live file-tree mirror for external tools/backup peace of mind.
8. **Own the "self-hosted AI knowledge base" position**: market the MCP server and agent providers; ship an explicit Ollama/local-model preset on the existing `local` provider (AppFlowy's differentiator, one settings preset away); add per-subtree AI scoping (e.g. an `#aiExclude`-style label) to close the documented "AI reaches your whole tree" privacy gap before critics find it.
9. **Packaged extensions v1.** Not a sandboxed plugin SDK — a declarative package format (icon packs are the precedent, `script-deployer` the tooling seed), a curated community registry, and one-click install of script/widget/theme bundles. The goal is discoverability of what scripting can already do.
10. **Simple mode (#8955).** A default reduced UI (progressive disclosure of attributes/cloning/scripting) aligned with the setup-wizard redesign — the answer to second-brain fatigue and the "for a specific audience" review ceiling.

### P2 — Strategic bets (roadmap-level, design docs first)

11. **E2EE sync.** Extend the protected-notes key-envelope model toward encrypting all entity content end-to-end, with the sync server blind. This is the single feature that flips the hosted-service economics (see 13) and neutralizes Notesnook/Anytype/Joplin's main advantage. Staged: design doc → opt-in per-tree → default.
12. **Collaboration, staged — never big-bang.** (a) Shared read-only/subtree sync between instances; (b) CRDT (Yjs) merge for *text notes only* over the existing WebSocket channel, killing the worst last-write-wins data-loss cases even for one user on many devices; (c) only then multi-user accounts with permissions — with scripting gated per-user, honoring the FAQ's legitimate XSS concern rather than dismissing it. #4956's 111 comments will fund and test this.
13. **Official hosted service.** Managed sync hosting at the converged $4–8/mo (PikaPods proves demand), ideally launched with or after E2EE sync so the pitch is "we host it and cannot read it." Recurring revenue directly addresses the single-maintainer sustainability risk the community already names.

### What *not* to do

- **No ground-up rewrite** of client or sync — Logseq spent three years and its community learning this lesson. The incremental Preact migration is the correct template.
- **Don't chase Obsidian's plugin count or Notion's workspace breadth.** Curated packaged extensions and focused collections parity beat feature-count wars.
- **Don't ship first-party AI as a paid dependency.** Trilium's credibility in its segment rests on bring-your-own-key/local models; Notion's credit-metering backlash is the counter-example.

---

## 5. Positioning statement to build toward

> **Trilium is the self-hosted knowledge base that runs everywhere — your server, your desktop, your phone, or entirely in your browser — that you can script like an application and that AI agents can work in natively, without your notes ever belonging to anyone else.**

Every P0/P1 item above either makes that sentence true on more devices (mobile, offline, PWA), more trustworthy (crypto, E2EE, lock-in relief), more visible (messaging, registry, landing pages), or more defensible (attributes/collections, AI scoping). The P2 bets — E2EE sync, staged collaboration, hosted service — turn the position into a sustainable business for the project.
