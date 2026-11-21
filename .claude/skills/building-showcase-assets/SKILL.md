---
name: building-showcase-assets
description: Use when making or changing the pictures and texts of Trilium shown outside the app — the Google Play listing (icon, feature graphic, phone and tablet screenshots, captions, description in listing.json), the Flathub screenshots and their metainfo captions, the website's home page hero (`hero.html`) and its note type / collection / tree screenshots (`apps/website/public/*.webp`), or the demo document those are captured from. Covers `apps/showcase` (targets play, flathub, flathub-preview, hero, website; scenes and seeds; running it on NixOS; its checks), where each output goes and how it is published (Play Console by hand, Flathub through commit-pinned URLs in the metainfo, the website through `apps/website/public`), how the store texts must stay aligned, how to fix the demo document itself (`apps/edit-docs/demo` → `demo.zip`), and the traps already hit (tsx breaking `page.evaluate`, a busy port giving 401, the editor toolbar vanishing, captions wrapping, the tablet layout, canvas text with no height). Do NOT use for Flathub packaging itself (packaging-for-flathub) or for the mobile app's code (developing-capacitor-mobile).
---

# Building the showcase: store listings, Flathub, website

`apps/showcase` renders every picture of Trilium that lives outside the app from one
**demo document**: a fresh server with the bundled demo, which holds every note the
shots show except one AI chat the build seeds. One
command per destination; the outputs land in `apps/showcase/out` (gitignored), and the
website ones are also copied into the repo.

```
pnpm --filter showcase play       # Google Play: icon, screenshots, feature graphic, preview
pnpm --filter showcase flathub    # Flathub: desktop window screenshots + preview with checks
pnpm --filter showcase hero       # website hero → apps/website/public/hero{,-mobile}.html
pnpm --filter showcase website    # website screenshots → apps/website/public/*.webp
pnpm --filter showcase user-guide # User Guide heroes → docs/User Guide/**/*_demo.webp
pnpm --filter showcase start <targets…> [--only tree,text] [--devices phone,tablet]
    [--url http://localhost:8080] [--port 37991]
```

Targets: `icon`, `screenshots`, `feature`, `preview` (the `play` group, the default),
`flathub`, `flathub-preview`, `hero`, `website`, `user-guide` (never `docs`: `pnpm docs` is a
pnpm built-in). `--only` takes scene IDs (or website file names, or User Guide image names),
`--url` reuses a running server that already holds the demo plus the seed and needs
no login (`flathub` always boots its own).

## Where each output goes

| Target | Output in `out/` | Destination | How it gets there |
|---|---|---|---|
| `icon`, `feature`, `screenshots` | `icon.png`, `feature-graphic.png`, `screenshots/{phone,tablet}/NN-<scene>.png` | Google Play listing | **By hand** in the Play Console; nothing uploads |
| `preview` | `preview.html` (+ `listing-data.js`) | nowhere: a review mock of the Play page, light and dark | open the file |
| `flathub` | `flathub/NN-<scene>.png` | Flathub app page | copied to `apps/desktop/flatpak/screenshots/<scene>.png`, committed, then linked from the metainfo (below) |
| `flathub-preview` | `flathub-preview.html` | nowhere: a mock of the Flathub page with Flathub's quality checks | open the file |
| `hero` | `hero/hero.html`, `hero/hero-mobile.html` (+ app/snapshot/diff PNGs per variant) | `apps/website/public/`, iframed by the home page | copied **only when** every snapshot differs from the app by ≤ 0.5 % of pixels in both schemes |
| `website` | `website/<file>.webp`, `<file>-dark.webp` | `apps/website/public/` | copied on every run; the home page serves `-dark` through `darkSrc` / `darkImageUrl` in `pages/Home/index.tsx` |
| `user-guide` | `docs/<image>.webp` | the attachments of User Guide pages | overwritten on every run, and the page's `<img>` resized to match; then `docs.mjs sync` (below) |

The Play texts live in `src/play/listing.json` (name, developer, category, short and full
description, feature graphic tagline and alt). The Flathub texts live in the metainfo,
`apps/desktop/flatpak/org.triliumnotes.Trilium.metainfo.xml`. **Keep the two descriptions
in the same shape and wording**: the Play one is the Flathub one with the second paragraph
about the phone and without the desktop-only items (tabs and windows, global shortcuts, the
web clipper). Change one, then the other.

### Flathub wiring

- Screenshots are linked as
  `https://raw.githubusercontent.com/TriliumNext/Trilium/<commit>/apps/desktop/flatpak/screenshots/<scene>.png`
  where `<commit>` is **the commit that added the images**, not a tag: a Flathub test build
  before the release tag must already download them. So: commit the PNGs first, then the
  metainfo change that pins that hash, in a separate commit.
- Captions sit in the metainfo `<caption>`s, one sentence, no full stop, describing what the
  shot shows; the first screenshot is `type="default"` and light. `flathubCaption` on a scene
  only feeds the preview's checks.
- The metainfo `<releases>` are generated by `scripts/update-version.ts` from the overview of
  each release note, so the overview is also the Flathub release text: no "attached below".
- Everything addressed to Flathub reviewers is Elian's to write (Flathub's AI policy). The
  packaging itself: **packaging-for-flathub** skill.

### Website wiring

- `HERO.variants` in `src/shared/scenes.ts` lists the hero snapshots, each with its own note:
  `hero.html` (desktop layout, Trilium Demo hoisted, 1360×920) and `hero-mobile.html` (mobile
  layout with the phone's user agent and the `trilium-device=mobile` cookie, Rome itinerary,
  360×760). Each viewport must equal `HERO_SNAPSHOTS` in `apps/website/src/pages/Home/index.tsx`
  and the frames' aspect ratios in `index.css`.
- The website draws the phone around `hero-mobile.html`: a bezel, and `PhoneChrome` (status bar,
  home indicator) over the safe area the capture leaves free (`--safe-area-inset-top: 32px`,
  `-bottom: 20px`, set from `mobile.safeArea`; the sizes in `.phone-chrome` must match). Wide
  screens show the phone in front of the desktop window's right side; below 720 px
  (`HERO_WIDE_QUERY`) the phone shows alone and the desktop snapshot never loads.
- The snapshot is static, so the `light-theme` / `dark-theme` classes the app toggles on `body`
  cannot follow the color scheme: `unthemeSelector()` in `hero/snapshot.ts` moves a rule that
  tests them under the matching `prefers-color-scheme` query. A dark snapshot that keeps light
  note colors (highlights, table colors) means a theme selector it does not recognise.
- `WEBSITE_SHOTS` in `src/website/build.ts` maps a scene (or a `query` among the website
  demo's notes) to the file it replaces. `area: "note"` keeps everything right of the tree in
  a window sized so that area has the 16:10 of `.showcase-image-frame`; `"tree"` keeps the
  tree pane. Light and dark are captured one after the other per shot.
- A shot whose view draws after `settle()` returns needs a `prepare` that waits for it:
  `waitForCalendar` waits for a `.calendar-event` chip. FullCalendar's own classes are hashed
  (`fc-forma-…`), so `.fc-event` never matches.

### User Guide wiring

- `DOCS_SHOTS` in `src/docs/build.ts` maps a scene or query to a `page` under
  `docs/User Guide/User Guide` and the `image` beside it, captured light at 1x through the
  website's `captureShots()` (an `area: "window"` shot keeps tree and note; `colorSchemes`
  picks dark). The build only **overwrites**: it fails on an image not yet in `!!!meta.json`.
- **New figure**: register it once with
  `node .claude/skills/writing-documentation/docs.mjs image "<page>" <any.webp> --title demo.webp`,
  put the `<figure>` in the page, add the shot, run `user-guide`, then `docs.mjs sync` and
  `check`. Snapshot the dirty docs before the sync and restore only the pages it churned.
- The page text must match the demo: a hero shows the demo's "Trip to Rome" notes, so a page
  that describes its example names what the shot shows.

## How it is built

- `src/main.ts` parses the arguments and runs the targets; `src/{play,flathub,hero,website}/`
  hold one target family each; `src/shared/` holds what they share: `scenes.ts`,
  `demo_server.ts`, `browser.ts`, `build.ts` (paths, options, checks), `png.ts`.
  `templates/` holds the HTML the Play images and previews are rendered from (`common.css`
  carries the website hero's gradient).
- **It runs on Node's own type stripping (`node src/main.ts`), never tsx.** tsx rewrites
  functions with `__name()` calls, and the functions handed to `page.evaluate()` and the seed
  scripts sent to the server run where `__name` does not exist. Type stripping keeps
  `Function.prototype.toString()` valid JavaScript. Imports therefore name `.ts` files, and
  `tsconfig.app.json` has `erasableSyntaxOnly`. `pnpm typecheck` covers the app.
- A browser: `CHROME_BIN`, then `chromium` on the PATH, then Playwright's own (NixOS needs a
  system one). `hero` needs `fonttools` with Brotli (`FONTTOOLS`); `flathub` needs
  `gnome-shell`, `dbus-run-session` and `gdbus`.

### The demo server and the seed

`startDemoServer()` boots `apps/server` in dev mode on a temp data dir with
`apps/server/spec/db/config.ini` (no login) and **backend scripting enabled**, creates a new
document with the demo, then `seedDocument()` runs `SEED` and `PIN_NOTE_DATES`, each as a backend script through
`api/script/exec`:

- a seed is sent as **source text** (`seed.toString()`), so it cannot see module
  constants: everything it needs goes in `params` (JSON);
- the server runs it in the bundle of `currentNoteId`, which **must be a JavaScript note**
  (`seedDocument` finds one);
- the `api` it calls is declared as a small type at the top of the module that defines the
  seed, not imported.

The notes the shots show live in the demo itself, under "Trilium Demo": the "Trip to Rome"
subtree (itinerary, board, calendar, table, budget, Python and Markdown notes, the PDF, the
packing list, the dashboard), the "Introducing Trilium Notes" presentation and the geo map's
view. `SEED` (in `shared/seed.ts`) adds only the "Packing for Rome" AI chat, which stays out of
the demo because it names a provider and model the user has not set up, and returns early
when it exists. `PIN_NOTE_DATES` fixes every note's dates so the shots do not depend on the
day of the build.

### Scenes

`SCENES` in `scenes.ts` is the listing order. Each scene: `query` (finds the note), optional
`prepare(page)` (runs in Node after the note shows), `tablet` (replaces `query`, `prepare`,
`alt` in the tablet layout), `desktopQuery` / `desktopPrepare` (Flathub and website),
`keepFocus`, `colorScheme`, `caption` (`\n` between its two lines), `alt` (≤ 140 chars).

## Checks

The build fails (exit code 1) on a failed check; `play` checks run after any Play target:

- Play: name ≤ 30, short ≤ 80, full ≤ 4000, alt texts ≤ 140; icon 512×512 with alpha ≤ 1 MB;
  feature graphic 1024×500 without alpha; 4–8 screenshots per device, 16:9 / 9:16, ≥ 1080 px,
  no alpha, ≤ 8 MB; **every caption on exactly two lines** (rendered and measured).
- Flathub (`flathub-preview`): name, summary, description lists ≤ 10 items, branding colors,
  release notes, OARS rating, square SVG icon, 3–10 screenshots, first one light, window
  ≤ 1000×700 (2000×1400 HiDPI), PNGs with alpha (the window shadow), caption form.
- Hero: pixel diff against the live app ≤ 0.5 % in light and dark.

## Store rules the design follows

- Play captions may cover at most 20 % of a screenshot: the 1080×1920 phone image has a 384 px
  caption band above a bottom-aligned, slightly cut app screenshot. Captions say what a view is
  **for** ("Plan your next trip on a map"), not what it is.
- Large-screen (tablet) screenshots get no text outside the app, so they are uncaptioned.
- The feature graphic shows only as a promo video's cover and in featured placements, not on
  the listing page; the developer name is account-wide.
- Flathub windows keep frame, rounded corners and shadow: captured with GNOME's own window
  screenshot in a headless GNOME Shell.

## Changing things

- **New store scene**: add it to `SCENES` (order = listing order) with a caption that fits two
  lines; add its note to the demo if it lacks one (below); run `start screenshots --only <id>`;
  check both devices — the tablet shows the tree beside the note, so a scene about the tree
  needs a `tablet` variant.
- **New website shot**: add to `WEBSITE_SHOTS`, add its note to the demo, reference
  `<file>.webp` and `<file>-dark.webp` in `pages/Home/index.tsx`.
- **New Flathub screenshot**: run `flathub`, copy the PNG to `apps/desktop/flatpak/screenshots/`,
  commit, then add the `<screenshot>` pinned to that commit.
- **New or wrong content in the demo**: fix it in
  `apps/edit-docs/demo/` (or interactively with `pnpm edit-docs:edit-demo`), then
  rebuild `apps/server/src/assets/db/demo.zip` with `createZipFromDirectory()` from
  `apps/edit-docs/src/docs_pipeline.ts`. Compare the entries with the old zip: only the files
  you changed may differ, and keep the noteIds of existing notes. Existing users' databases
  keep the old content. Then rerun every target: a moved note changes the tree and breadcrumbs
  in most shots.

## Traps already hit

- **A busy port looks like a broken setup**: when the port answers already (a leftover or
  someone else's run), `new-document` returns 401. Check `ss -ltnp`, pass `--port`; never
  `pkill -f` (it matches its own shell), stop your own process by PID.
- **The editor toolbar vanishes**: `settle()` blurs the focused element; a scene that needs the
  CKEditor toolbar sets `keepFocus`. Scroll with `behavior: "instant"`, scoped to
  `.ck-editor__editable` (the sidebar has headings too).
- **Mobile layout**: set the `trilium-device=mobile` cookie. A table without a saved width is
  1200 px wide and scrolls on mobile, so the demo's tables carry `style="width:…px"`.
- **Captions wrap** when a line is wider than the 860 px band (88 px font). The two-line check
  catches it; reword or resize, then rerun.
- **Tablet first screenshot**: the tablet lays the tree beside the note, so the "tree" scene
  opens the Trilium Demo note as a note map (`setNote(id, { viewScope: { viewMode: "note-map" } })`).
- **Mind map zoom**: Mind Elixir zooms on a `wheel` event with `ctrlKey`, which
  `page.mouse.wheel()` cannot send; `zoomOutMindMap()` dispatches it.
- **Geo map view**: stored in the map's `viewConfig` attachment as
  `{"view":{"center":…,"zoom":…}}`, in the demo.
- **Canvas text drawn as dashes**: text elements with `"height": null` (old Excalidraw data) are
  restored with height 0 and clipped to nothing. The demo canvas had it until 6340775564;
  a drawing showing fragments of text means its data, not its fonts.
- **Mind map on the desktop** opens at 100 % and is cut off on both sides, so Flathub leaves it
  out.
- **The demo rebuild script never exits** (`docs_pipeline.ts` keeps a handle open); the zip is
  written when the file's time changes — stop the process by PID.
