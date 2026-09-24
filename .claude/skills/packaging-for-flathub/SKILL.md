---
name: packaging-for-flathub
description: Use when working on Trilium's Flathub packaging — the from-source flatpak recipe vendored in apps/desktop/flatpak/ (manifest, trilium.sh, flathub.json, .desktop, metainfo), the scripts/flatpak/ generators (update-repo.mts, generate-sources.mts), .github/workflows/release-flathub.yml, or the published packaging repo at ../org.triliumnotes.Trilium. Covers the settled architecture decisions (no electron-forge, no asar, sandboxed data dir, per-arch pnpm sources, build-time scripts shared with the forge build), the offline-build machinery (flatpak-node-generator, requiresBuild:false, the Electron ≥43 unzip, the armv7l crash), the org.flatpak.Builder-only toolchain rule, how Flathub test-builds pull requests (drafts included, one misleading status), and what remains (the data migration, EOL-rebase of the old app ID). Do NOT use for the electron-forge .flatpak release asset (see forge.config.ts) or for cutting releases (see cutting-a-release).
---

# Packaging Trilium for Flathub

A from-source flatpak of Trilium Desktop, built offline inside the flatpak-builder
sandbox with no Electron Forge involvement. **The app is published**: the submission
(flathub/flathub#10014) merged and `flathub/org.triliumnotes.Trilium` exists. The recipe
now lives in this repo and the packaging repo is generated from it.

**The generated recipe builds on Flathub's own infrastructure.** `FLATHUB_PAT` is in
place and the workflow's first unattended run opened
[org.triliumnotes.Trilium#1](https://github.com/flathub/org.triliumnotes.Trilium/pull/1):
`validate-manifest` passed, `build-x86_64` took 8m07s and `build-aarch64` 10m40s, both
green. That run also carried the first prune, removing the three leftover `.mts` scripts.

**Flathub bans AI-generated submissions** (policy May 2026). Everything addressed to
Flathub — pull request descriptions, review replies, linter-exception requests — is
Elian's to author personally. Draft packaging code and manifests freely; do not write
the words that go to Flathub reviewers.

## The two working locations

- **This repo owns the recipe.** `apps/desktop/flatpak/` holds the manifest
  (`org.triliumnotes.Trilium.yml`), `trilium.sh`, `flathub.json`, the `.desktop` file and
  the metainfo. `scripts/flatpak/` holds `update-repo.mts` (writes the manifest with the
  ref and pnpm pins, copies `trilium.sh` + `flathub.json`) and `generate-sources.mts`
  (regenerates `generated-sources.json`). `.github/workflows/release-flathub.yml` runs
  both and opens the pull request, on every published non-prerelease and on a dispatched
  ref. Also here:
  `apps/website/public/.well-known/org.flathub.VerifiedApps.txt` (empty, serving 200; the
  dev-portal token fills it — post-publication flow, keep the file forever).
- **The packaging repo**: `/home/elian/Projects/TriliumNext/org.triliumnotes.Trilium`,
  a clone of the real Flathub repo (default branch `master`, Elian has `push`). It holds
  only the manifest, `trilium.sh`, `flathub.json`, `generated-sources.json` and a README.
  **Never hand-edit it** — `update-repo.mts` overwrites everything but the sources file,
  which `generate-sources.mts` overwrites, and deletes every *other* tracked file. A file
  the recipe should keep but not write belongs in `KEPT_FILES`; `master` carried
  `flip-fuses.mts`, `stamp-build-info.mts` and `trim-locales.mts` long after the manifest
  moved to running the checkout's own copies, which is what that prune clears.

Local flow, from this repo, in this order:

```sh
pnpm exec tsx scripts/flatpak/update-repo.mts ../org.triliumnotes.Trilium [ref]
pnpm exec tsx scripts/flatpak/generate-sources.mts ../org.triliumnotes.Trilium
```

`ref` defaults to `HEAD`; a **tag** pins `tag:` + `commit:`, anything else pins a bare
commit. The pinned commit must be **pushed** — Flathub clones `TriliumNext/Trilium` at
that SHA.

## Settled decisions and why (do not relitigate without new facts)

- **From source, not repackaged.** The AppImage-extract fallback (Zettlr-style) exists
  if reviewers ever balk at build cost.
- **App ID `org.triliumnotes.Trilium`**, CamelCase last element. The old
  `com.github.zadam.trilium` gets an `end-of-life-rebase` to the new ID — still pending,
  Elian can merge it himself; `<provides>`/`<replaces>` are already in the metainfo. The
  rebase renames `~/.var/app/<id>`, which the old app never used, so it moves no notes —
  see "What remains" for the migration that does.
- **No asar, no Forge.** Payload proven byte-identical to the Forge flatpak; the +11 MB
  is compression granularity (ostree per file vs. one asar stream). Tamper-sealing comes
  from content-addressed ostree, so asar integrity fuses buy nothing.
- **The build-time scripts are shared with the forge build, not copies.** The manifest
  runs the checkout's own code:
  - `pnpm chore:update-build-info --from-commit` — commit date, not wall clock, so a
    rebuild of the same source stamps the same bytes. The default (no flag) is what the
    seven CI callers use; do not change it.
  - `apps/desktop/electron-forge/flip-fuses.ts` — `FUSES` is the shared baseline; the
    forge config spreads it and adds `OnlyLoadAppFromAsar` +
    `EnableEmbeddedAsarIntegrityValidation` at the use site, because only Forge packages
    an asar. `RunAsNode` is OFF, so `ELECTRON_RUN_AS_NODE` smoke tests do not work.
  - `apps/desktop/electron-forge/trim-locales.ts` — one keep-list derived from `LOCALES`,
    one walk, one completeness check (a keep-list locale missing from the package fails
    the build). 55 → 21 `.pak`s on Linux.

  Each has a run-as-script guard (`process.argv[1] === import.meta.filename`) and takes
  its target as an argument. Editing them touches **both** the Flathub build and the
  `.deb`/`.rpm`/Forge artifacts.
- **The desktop file and metainfo install from the pinned checkout**, not from
  packaging-repo copies and not from `raw.githubusercontent` pins. The review wanted them
  in this repo; the URL-pin variant is also how the published build missed the
  `StartupWMClass` fix for weeks. There is **no separate metadata module** any more —
  nothing is left for it to cache-isolate. `trilium.sh` is the one exception, copied into
  the packaging repo so a reviewer reads the sandbox behavior without opening the
  checkout.

  That is also why the metainfo's `<releases>` — the version Flathub displays — has to be
  right in the commit that gets tagged. `pnpm chore:update-version` regenerates it from
  the newest five `vX.Y.Z` tags, so it is never hand-edited and never accumulates drift;
  the version being prepared is dated today until its own tag supplies the date.
- **Sandboxed data dir, narrow filesystem access.** `trilium.sh` sets
  `TRILIUM_DATA_DIR` to `$XDG_DATA_HOME/trilium-data` (i.e. inside `~/.var/app`), falling
  back to host `~/.local/share/trilium-data` when that exists; a `flatpak override` wins.
  `--filesystem=home` is **gone** — four read-only XDG dirs cover drag-&-drop import
  (electron#30650), so the linter exception that was pending at submission is moot.

  **Do not grant the legacy path back**, in any form. The reviewer struck
  `--filesystem=home` ([#10014](https://github.com/flathub/flathub/pull/10014#discussion_r3903751184)),
  then struck the narrowed `--filesystem=~/.local/share/trilium-data:create` as well
  ([here](https://github.com/flathub/flathub/pull/10014#discussion_r3904573174)) — "you
  have your sandboxed folder" — when told it would blank out the old app's users:
  migration is upstream's job, the permission set is Flathub's. Re-adding either gets the
  next packaging PR rejected. A review bot that reads `trilium.sh` alone flags this as a
  data-loss bug (PR #11629); it is a known deferred cost, not a defect.

  `$HOME` inside the sandbox is the real path (`/home/user`) whatever is mounted, so the
  fallback branch turns purely on what the manifest or an override exposes. Verify with
  `flatpak run --nofilesystem=home --command=sh <id> -c '…'` against an installed build.
  Since the guard is `[ ! -d "$XDG_DATA_HOME/trilium-data" ]`, an override added *after*
  the first launch no longer reaches the legacy notes — the sandbox dir already exists.
- **pnpm 12 ships as a native binary per platform.** The manifest stages
  `@pnpm/exe.linux-x64` / `-arm64` tarballs with `only-arches`, because the `pnpm`
  wrapper package's `postinstall` (which picks one) cannot run offline. `append-path`
  points at `flatpak-node/pnpm`; the archive root holds an executable `pnpm`, so no
  `chmod`/symlink step. Refs older than pnpm 12 are rejected by `checkPnpmSupported` —
  pnpm 11 had a single wrapper tarball and the per-arch URL would 404.

  **The vendored manifest holds no pins of its own** — `__TAG__`, `__COMMIT__`,
  `__PNPM_VERSION__`, `__PNPM_SHA256_X64__` and `__PNPM_SHA256_ARM64__` are placeholders
  `update-repo.mts` fills in from the packaged ref, fetching the two tarballs for their
  hashes every run. So there is nothing to keep in step and nothing to gate: a check that
  compared a vendored pin with `package.json` was tried and reverted, because on a
  `pull_request` run it sees main's `package.json` against the branch's manifest and one
  Renovate bump reddens every open pull request, none of which can fix it.

  Consequences: the vendored manifest is a template, not a buildable one (it also
  references a `generated-sources.json` that lives only in the packaging repo), and
  `checkPlaceholdersFilled` fails the run when a new `__NAME__` appears that nothing
  fills — including one written inside a comment. Verify a change to the templating by
  rendering into an empty directory and diffing against the packaging repo:
  `node --experimental-strip-types scripts/flatpak/update-repo.mts /tmp/out [ref]`.
  **Never `cp -r` the packaging repo** to do it — its `.flatpak-builder/` holds a
  multi-gigabyte build tree.
- **`flathub.json`** carries `disable-external-data-checker: true` (the checker probes
  broken URLs *without* `x-checker-data`, so it would poll ~2400 generated npm sources)
  and `automerge-flathubbot-prs: false` — the linter errors on `true`
  (`flathub-json-automerge-enabled`). It only takes effect on the **default branch**.
- **No `only-arches`** at app level: x86_64 + aarch64 both build (better-sqlite3 13 ships
  arm64 prebuilds).

## The offline-build machinery (how it works, where it bites)

- `flatpak-node-generator pnpm <lockfile> --pnpm-store-version v11` — the flag is
  **mandatory**. pnpm 12 still reads the **v11** store layout (SQLite `index.db`); the
  generator defaults to v10 (per-package JSON index). Verify with `pnpm store path`
  before assuming a bump changed it. `checkPnpm` in `generate-sources.mts` guards the
  major (currently 12).
- **The generator crashes on Electron ≥44 unless it is recent**: `KeyError:
  electron-v44.4.1-linux-armv7l.zip`, because Electron stopped publishing armv7l and only
  newer generator revisions skip that arch. CI pins a master commit
  (`41c20aa10819cdb2a4f3ca171758a96d1955c018` or later) via pipx. **The copy bundled in
  `org.flatpak.Builder` is too old** — locally, extract it and patch the guard in
  `flatpak_node_generator/electron.py`, keeping the copy under `$HOME` (the sandbox cannot
  see `/tmp`) and pointing `PYTHONPATH` at it through a `flatpak-node-generator` shim on
  `PATH`. Drop that crutch once the Builder flatpak updates.
- The generated store marks every package `requiresBuild: false` ⇒ **no dependency
  lifecycle script runs**. The workspace's OWN `postinstall` DOES run. Nothing in the
  graph needs a native build.
- **Electron ≥43 has no install script** — it lazy-downloads on first `require`, which
  offline forbids. The manifest unzips `flatpak-node/cache/electron/electron-v*-linux-*.zip`
  itself, renames the binary to `trilium`, deletes `chrome-sandbox` (zypak replaces the
  setuid sandbox), and the wrapper runs `zypak-wrapper`.
- Playwright's ~511 MB of browser archives are filtered out by `filterSources`, which also
  fails loudly if the count collapses or the Electron zip disappears. `--no-devel` is
  unsupported for lockfile v9 and would break the build (Vite/esbuild/tsx are devDeps).
- Generator output is **deterministic** across runs and machines.

## Toolchain rule: org.flatpak.Builder ONLY

Build and lint exclusively through the `org.flatpak.Builder` flatpak (bundles
flatpak-builder, flatpak-builder-lint, appstreamcli, ostree, jq). The host's
flatpak-builder cost two wasted investigations: NixOS ships it without `appstreamcli`,
and version skew produced phantom lint errors.

```sh
flatpak run org.flatpak.Builder --user --install --force-clean builddir org.triliumnotes.Trilium.yml
flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest org.triliumnotes.Trilium.yml
# Repo lint as Flathub's test pipeline judges it:
flatpak run org.flatpak.Builder --user --force-clean --default-branch=test --repo=repo builddir org.triliumnotes.Trilium.yml
flatpak run --env=REPO=https://github.com/flathub/org.triliumnotes.Trilium --command=flatpak-builder-lint org.flatpak.Builder repo repo
# Metainfo alone, no build needed (what CI does):
flatpak run --command=appstreamcli org.flatpak.Builder validate --explain apps/desktop/flatpak/org.triliumnotes.Trilium.metainfo.xml
```

**Expected findings — do not re-investigate**: `runtime-update-available-…` (a runtime
bump is a deliberate decision) and, on local repo lint,
`appstream-remote-icon-not-mirrored` (the mirroring checks string-match
`dl.flathub.org/media` URLs that appstreamcli never emits locally; only Flathub's own
build adjudicates it).

## How Flathub builds pull requests (verified 2026-09-21)

- **Draft PRs are test-built** — `flathub/org.kde.kolourpaint#128` (`draft: true`)
  produced a vorarbeiter run. Drafting costs no coverage.
- **Only one status is ever posted: `builds/x86_64`** — an aggregate, on every app,
  whether or not aarch64 built. The aarch64 result is a `build-aarch64` job inside the
  run the status links to (alongside `validate-manifest`). **Never read a green check as
  proof aarch64 built**; open the run.
- **The arch matrix is fail-fast, both directions** — one arch failing cancels the other.
  Failures do post (`builds/x86_64=failure`); `bot, build` re-triggers and the newer run
  overwrites the status.
- **What triggers a build**: `refs/pull/*/head` (test, publishes nothing), `master`
  (stable publish), `beta` (beta channel). A push to any other branch builds nothing — so
  a pull request is the only way to get a build without publishing.
- Therefore **untagged commits go out as draft PRs to `master`** (shared `update/beta`
  branch, superseded per run) purely for the two-arch verdict. A real `beta` branch is
  for `-rc` tags with actual testers, and publishing there has no review gate.

## Runtime behaviors (verified — trust these)

- `flatpak-builder --run` CANNOT test zypak apps (portal Spawn needs a registered
  instance). Always `--install` + `flatpak run`.
- GNOME matches the window to the desktop file **without any desktopName /
  CHROME_DESKTOP fix** — but only in a session started after flatpak enablement. If
  integration looks broken, check `XDG_DATA_DIRS` of the running gnome-shell before
  touching code: a re-login fixes it. Two "fixes" were nearly shipped for this non-bug.
- The app runs Wayland-native. The system-bus dbus error at startup is benign Chromium
  probing.
- Quarantine tests with `--env=TRILIUM_DATA_DIR=/tmp/...`.
- **`--talk-name=org.freedesktop.Notifications` is NOT needed** (libnotify ≥0.8 uses the
  portal). The tray's `org.kde.StatusNotifierWatcher` has no portal equivalent and stays.
  Audit a finish-arg with `flatpak run --no-talk-name=… <id>` and `dbus-monitor`.

## What remains

1. **The packaging repo's README**, which still describes staged scripts and the old
   pnpm/ASAR reasoning.
2. **The data migration for existing users**, which the EOL-rebase does not perform and
   which no permission can substitute for (see "Sandboxed data dir"). The old Flathub app,
   the Forge `.flatpak` and every `.deb`/AppImage keep notes at host
   `~/.local/share/trilium-data`; the new app starts on an empty
   `$XDG_DATA_HOME/trilium-data` and says nothing about why. Options not yet weighed: a
   first-run prompt that asks for the directory through the file portal, a documented
   `flatpak override --filesystem=…` in the release notes, or exposing the legacy
   database read-only for a one-time import. Settle it **before** the rebase — after it,
   the old app is gone and the surprise is the user's.
3. **EOL-rebase the old app**: PR `flathub.json` with
   `end-of-life-rebase: org.triliumnotes.Trilium` to `flathub/com.github.zadam.trilium`
   (needs `end-of-life` too, or the linter errors). Old app ships 0.63.7/2024 on EOL
   23.08 to ~71k installs.
4. Parked polish: carousel-spec screenshots (window ≤1000×700 or 2× at ≤2000×1400, shadow
   + rounded corners), `<branding>` colors (leaf-green `#cfe8c0` light / `#254d18` dark;
   compare peers via `flathub.org/api/v2/appstream/<id>` → `.branding`), metainfo
   description refresh, and the `--no-playwright-browsers` flag worth filing upstream.
   License stays `AGPL-3.0-only` until the repo reconciles package.json with the README's
   v3+ grant.
