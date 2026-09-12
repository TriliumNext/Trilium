---
name: packaging-for-flathub
description: Use when working on Trilium's Flathub packaging — the from-source flatpak manifest (org.triliumnotes.Trilium), scripts/generate-flatpak-sources.mts, the Flathub submission, the future release-flathub update workflow, or anything touching the packaging repo at ../com.github.zadam.trilium. Covers the settled architecture decisions (no electron-forge, no asar, new app ID, pnpm store v11, manual Electron unzip, metadata module last), the offline-build machinery (flatpak-node-generator, requiresBuild:false, lifecycle-script semantics), the org.flatpak.Builder-only toolchain rule, the expected lint findings, the verified runtime behaviors (zypak, GNOME window matching, fuses), and the submission state (PR flathub/flathub#10014 in review; /review-based pr-check mechanics; EOL-rebase of com.github.zadam.trilium last). Do NOT use for the electron-forge .flatpak release asset (see forge.config.ts) or for cutting releases (see cutting-a-release).
---

# Packaging Trilium for Flathub

A from-source flatpak of Trilium Desktop, built offline inside the flatpak-builder
sandbox with no Electron Forge involvement, targeted at a Flathub submission under a
new app ID. Everything below was built and verified against **v0.105.0** on 2026-08-31
/ 2026-09-01; the manifest builds, installs, launches, and lints clean modulo two
expected findings.

## The two working locations

- **This repo**: `scripts/generate-flatpak-sources.mts` (+ `.spec.ts`) — generates and
  filters `generated-sources.json` from `pnpm-lock.yaml`. Lives on branch
  `flatpak/generated_sources` (PR #11283) together with
  `apps/website/public/.well-known/org.flathub.VerifiedApps.txt` (empty, deployed and
  serving 200 at triliumnotes.org; the dev-portal token fills it after publication).
- **The packaging repo**: `/home/elian/Projects/TriliumNext/com.github.zadam.trilium` —
  a clone of the OLD Flathub repo (Elian has write access, granted via
  flathub/flathub#6715), emptied and reused as the working directory for the NEW app.
  Contains `org.triliumnotes.Trilium.yml`, `.desktop`, `.metainfo.xml`,
  `generated-sources.json` (2 610 entries, generated from the v0.105.0 lockfile),
  `stamp-build-info.mts`, `trim-locales.mts`, `flip-fuses.mts`, README. Its contents get
  copied into the flathub/flathub `new-pr` submission; the repo itself is never pushed.

## Settled decisions and why (do not relitigate without new facts)

- **From source, not repackaged.** Flathub prefers it; the AppImage-extract fallback
  (Zettlr-style) exists if reviewers ever balk at build cost.
- **New app ID `org.triliumnotes.Trilium`**, CamelCase last element (ecosystem norm:
  md.obsidian.Obsidian). The old `com.github.zadam.trilium` cannot be verified (ID maps
  to zadam's GitHub) and gets an `end-of-life-rebase` to the new ID **after** the new
  app publishes — EOL-ing first would leave a window where searching "trilium" finds
  nothing. `<provides>`/`<replaces>` with the old ID are already in the metainfo; user
  data survives either way because the notes DB lives in `~/.local/share/trilium-data`,
  not in `~/.var/app`.
- **No asar, no Forge.** Payload proven byte-identical to the Forge flatpak (2 850
  files, 3 trivial diffs); the +11 MB bundle delta is compression granularity (ostree
  compresses per file, asar is one stream). Tamper-sealing comes from content-addressed
  ostree, so asar integrity fuses buy nothing.
- **Fuses are flipped anyway** (`flip-fuses.mts`): Forge's hardening set minus the two
  asar fuses (`OnlyLoadAppFromAsar`, `EnableEmbeddedAsarIntegrityValidation`), which
  would brick a directory-loaded app. `RunAsNode` is OFF — `ELECTRON_RUN_AS_NODE`
  smoke tests no longer work, by design.
- **Build info is stamped from the commit date** (`stamp-build-info.mts`), not wall
  clock: reproducible-builds consensus, Cemu precedent on Flathub, and rebuilds of the
  same source must not claim new dates. The tag's committed `build.ts` is a stale
  placeholder (wrong date AND revision) — the stamp is mandatory.
- **Locale trim** (`trim-locales.mts`): 55 → 21 Chromium `.pak`s, keep-list derived at
  build time from `LOCALES` in `packages/commons/src/lib/i18n.ts` (drift-proof), with
  the `en-US.pak`-is-"en" special case. Mirrors Forge's postPackage hook.
- **Generation is NOT wired into CI** (deliberate reversal — commit `f16771c918`):
  release-asset coupling would block every release channel on an unpinned generator.
  Future model is winget-style push (see below). Only the script + spec live upstream.
- **`metadata` module holds `.desktop` + metainfo and MUST STAY LAST** in the manifest:
  flatpak-builder's stage cache is sequential, so this keeps metadata edits from
  invalidating the ~20-minute app build. No peer does this; it is our optimization.
- **`--filesystem=home` stays**, justified by drag-&-drop import from anywhere in home
  (core UX) plus the data dir; needs a per-app linter exception granted at submission.
- **No `flathub.json`** yet: defaults build x86_64 + aarch64 (the old app's
  `only-arches x86_64` reflected constraints that no longer exist; arm64 prebuilds
  ship in better-sqlite3 13). `disable-external-data-checker: true` gets added only
  when the push workflow lands.

## The offline-build machinery (how it works, where it bites)

- `flatpak-node-generator pnpm --pnpm-store-version v11` — the flag is **mandatory**:
  the generator defaults to store v10 (per-package JSON index), pnpm 11 reads only v11
  (SQLite `index.db`). Wrong store ⇒ generation succeeds, sandbox install fails
  minutes later. `checkPnpm` in the script guards the major.
- The generated store marks every package `requiresBuild: false` ⇒ **no dependency
  lifecycle script ever runs**. The workspace's OWN `postinstall` (pdfjs-viewer,
  share-theme, wxt prepare) DOES run. Nothing in the graph needs a native build
  (better-sqlite3 13 ships N-API prebuilds; esbuild resolves `@esbuild/linux-x64`).
- **Electron ≥43 has NO install script at all** — it lazy-downloads on first
  `require`, which offline cannot allow and the build never triggers. Hence the
  manifest unzips `flatpak-node/cache/electron/electron-v*-linux-*.zip` itself, renames
  the binary to `trilium`, deletes `chrome-sandbox` (zypak replaces the setuid
  sandbox), and the wrapper runs `zypak-wrapper`.
- The pnpm tarball ships `bin/pnpm.cjs` **without the exec bit** ⇒ `chmod +x` before
  the `ln -s pnpm.cjs … pnpm`. The pnpm archive version must track the tag's
  `packageManager` pin (v0.105.0 = 11.22.0; minor drift is harmless, major is not).
- Playwright's 5 browser archives (~511 MB, x64-only, no arch guards) are dead weight
  the script filters out; `--no-devel` is unsupported for pnpm lockfile v9 and would
  break the build anyway (Vite/esbuild/tsx are devDependencies).
- Generator output is **deterministic** (byte-identical across runs, machines, cache
  states) but the tool is installed from unpinned master — the script's count/electron
  guards exist to catch drift, and any future CI use must pin a commit (Greptile P1).

## Toolchain rule: org.flatpak.Builder ONLY

Build and lint exclusively through the `org.flatpak.Builder` flatpak (Flathub's CI
toolchain; bundles flatpak-builder 1.4.9, flatpak-builder-lint, appstreamcli, ostree,
jq, and flatpak-node-generator — the last kills any pipx/venv need locally). Using the
host's flatpak-builder caused two wasted investigations: NixOS ships it without
`appstreamcli` (compose step dies), and version skew produced phantom lint errors.

```sh
flatpak run org.flatpak.Builder --user --install --force-clean builddir org.triliumnotes.Trilium.yml
flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest org.triliumnotes.Trilium.yml
# Repo lint as Flathub's test pipeline judges it (test branch + REPO env):
flatpak run org.flatpak.Builder --user --force-clean --default-branch=test --repo=repo builddir org.triliumnotes.Trilium.yml
flatpak run --env=REPO=https://github.com/flathub/org.triliumnotes.Trilium --command=flatpak-builder-lint org.flatpak.Builder repo repo
```

**Expected lint findings — do not re-investigate**: `finish-args-home-filesystem-access`
(until the exception is granted) and `appstream-remote-icon-not-mirrored` (local-run
artifact: the mirroring checks string-match absolute `dl.flathub.org/media` URLs that
appstreamcli 1.x compose never emits locally; adjudicated only by Flathub's own test
build — Cockpit's external CI hit the identical pair).

## Runtime behaviors (verified — trust these)

- `flatpak-builder --run` CANNOT test zypak apps (portal Spawn needs a registered
  instance: `run-environ` missing). Always `--install` + `flatpak run`.
- GNOME matches the window to the desktop file **without any desktopName /
  CHROME_DESKTOP fix** — but only in a session started after flatpak enablement.
  If integration looks broken (generic icon, app absent from grid), check
  `XDG_DATA_DIRS` of the running gnome-shell before touching code: a re-login fixes
  it. Two "fixes" were nearly shipped for this non-bug.
- The app runs Wayland-native (Electron auto-picks the wayland socket). The system-bus
  dbus error at startup is benign Chromium probing.
- Data dir is shared with non-flatpak Trilium; quarantine tests with
  `--env=TRILIUM_DATA_DIR=/tmp/...`.
- **`--talk-name=org.freedesktop.Notifications` is NOT needed** (verified empirically
  + docs.flatpak.org/en/latest/electron.html: libnotify ≥0.8 auto-uses the
  notification portal in sandboxes; modern peers — Signal/Discord/Element — omit it).
  The tray's `org.kde.StatusNotifierWatcher` HAS no portal equivalent and stays.
  Audit any finish-arg one-off with `flatpak run --no-talk-name=… <id>`; watch the
  wire with `dbus-monitor` on both the portal and classic interfaces.

## Update model (designed, not yet built)

Winget-style push from this repo (mirror `release-winget.yml`): a `release-flathub.yml`
on `release: published` + `workflow_dispatch`, needing a `FLATHUB_PAT` secret — so it
can only exist after the Flathub repo does. Duties beyond the obvious bump: metainfo
`<release>` entry; `git rev-parse 'vX.Y.Z^{commit}'` (annotated-tag footgun); run the
TAG'S OWN generation script against the tag's lockfile; conditional pnpm-pin update
(fetch + sha256); node-major drift check against the manifest's node24 extension;
skip prereleases; idempotent re-runs; supersede stale bump PRs. flathubbot test-builds
every PR automatically; `gh pr merge --auto` is the auto-merge path if ever wanted
(`automerge-flathubbot-prs` only covers checker PRs and never applied to us). Do the
first cycles manually before automating.

## Submission state (submitted 2026-09-01)

**The submission is live: flathub/flathub#10014** ("Add org.triliumnotes.Trilium"),
labeled `migrate-app-id` by a human triager within minutes. The AI disclosure went
into the PR body itself (an "Additional information" bullet, proactive, with the
app-side LLM use shown) rather than a separate up-front issue. The body also carries
the rename/EOL-rebase rationale and the `--filesystem=home` justification. All review
replies remain Elian's to write.

What remains, in order:

1. Review (expect Fluxer-style: per-finish-arg "why?", possibly "desktop/metainfo
   should live upstream" — Fluxer got that comment and still merged with the files in
   the packaging repo). `bot, build` restarts test builds; the test build is also the
   first aarch64 verdict.
2. On merge: accept the invite (2FA, one week). Verification is a **post-publication
   dev-portal flow** — the portal issues a token that fills the currently-empty (and
   already live, HTTP 200) well-known file; keep that file forever (periodic
   re-checks). Nothing in the submission pipeline fetches it.
3. Only after the new app is live: PR `flathub.json` with
   `end-of-life-rebase: org.triliumnotes.Trilium` to the old repo (Elian can merge it
   himself). Old app currently ships 0.63.7/2024 on EOL 23.08 to ~71k installs.

## Submission-pipeline mechanics (learned from source + #10014)

- **`pr-check.yml` triggers ONLY on**: a comment containing `/review`, a 2-hourly
  cron, and admin dispatch. Close/reopen and title/body edits do NOT re-run it —
  comment `/review` to clear `pr-check-blocked` after fixing something.
- The checker (flathub-infra/flathub-submission-checker) automates only proxies;
  "requirements followed" in its posted comment is the human reviewer's line. The
  gates: title `Add <appid>` (3+ dot components, `^[A-Za-z_][\w\-]*$` each); a
  top-level manifest file (all-files-nested ⇒ auto spam-flag); the 4 template
  checklist sentences as substrings PLUS a role line whose regex allows only
  whitespace between "I am a/an" and "developer/author/…" (leftover template italics
  break it); tolerance is exactly ONE missing item. The video item needs a ticked box
  + URL within 2 lines — **waived entirely under the `migrate-app-id` label**.
- The domain comment is informational; the checker never fetches the well-known URL
  and there is no "verified" state pre-publication.
- **Submission branch history is preserved unsquashed** as the new app repo's master
  (verified on Fluxer's repo: its review fixups sit on the 2017 scaffold root
  forever). Tidy before opening; write commits as permanent. Decided: do NOT graft
  the old zadam repo history into the submission — provenance lives in
  `provides`/`replaces` + a link to flathub/flathub#6715 (link the issue, never
  @-mention admins for review; queue etiquette).
- Closest precedent PR: flathub/flathub#7843 (Fluxer, 2026, month-long) — the review
  that spawned pnpm support in flatpak-builder-tools (#511). Older peers (Obsidian
  #1883, Joplin #2061, Logseq #2729, Notesnook #3543) merged in 2–5 days under the
  laxer pre-2023 climate; don't calibrate expectations on them.

Post-publication niceties parked: carousel-spec screenshots (window ≤1000×700 or 2× at
≤2000×1400, with shadow + rounded corners — current 1302×826 pinned-sha shots pass
review but fail the featured checklist), `<branding>` colors (proposal: leaf-green
pastel `#cfe8c0` light / `#254d18` dark, derived from the website palette
`#4fa52b`/`#e47b19`/`#e33f3b`; compare peers via
`flathub.org/api/v2/appstream/<id>` → `.branding`; Logseq/Loupe/Warp/Bazaar have
blocks, Obsidian/Zed render the default gray), metainfo description refresh (bullets
drafted for canvas/mind maps/geo maps/collections/dark theme/customizable UI/languages
+ the relation-map→note-map wording fix; Elian rephrasing), release entries
(latest-only now, append per release, never backfill; `<url type="details">` per
entry), beta branch for rc tags, the `--no-playwright-browsers` upstream flag worth
filing on flatpak-builder-tools. License stays `AGPL-3.0-only` in the metainfo (the
conservative claim) until the repo reconciles package.json (`-only`, since 2018) with
the README's v3+ grant (zadam 2021, commit f8c310eb8f).
