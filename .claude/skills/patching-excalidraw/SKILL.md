---
name: patching-excalidraw
description: Use when changing, regenerating, checking or upgrading Trilium's patch of @excalidraw/excalidraw (`patches/@excalidraw__excalidraw@<version>.patch`): adding or editing a hunk in the dev bundle, the minified prod bundle or the `.d.ts` files, a new `UIOptions` hook or export, bumping Excalidraw to a new release (including Renovate's bump PR), a failing `excalidraw_contract.spec.ts` or `excalidraw_offsets.spec.ts`, an install that fails on the patch, the lockfile `patch_hash`, or "is the installed Excalidraw patched?". Covers what each hunk does and which Trilium code depends on it, the scratch-repo workflow that replaces `pnpm patch`, carrying the patch to a new release (three-way merge for the readable files, re-applying the minified prod changes by hand), and the upgrade checklist beyond the patch (asset paths, stylesheets, the three Excalidraw editors). Includes excalidraw_patch.mjs (check, open, changes, save, rebase); don't hand-roll a scratch repo, a hash update or a tar extraction.
---

# Patching Excalidraw

Trilium patches `@excalidraw/excalidraw` where its behaviour has no API to hook into: the canvas
layers drawn in layout effects for Preact, view limits, a desktop layout at any size, a thinner pen,
two handwriting performance fixes, zoom-to-fit with the properties panel on the right, and one
internal function exported. `references/hunks.md` lists every hunk with its reason, the Trilium code
that depends on it, the spec that guards it and what would let it go.

**Library patches are avoided** (section 8 of
`.claude/skills/reviewing-pull-requests/references/philosophy.md`). A patch is acceptable only when
it is strictly necessary for a proper integration in Trilium, and it needs an extensive suite of
tests for the patched behavior and a well-documented patching process: for Excalidraw, the contract
spec and this document. Precedent: the CKEditor code-block patch broke on every release that rebuilt
its dist files, and 52d6f8ba24 replaced it with a converter in Trilium's own code. So before adding
a hunk, look for a seam in Trilium (a prop, an action registered with `registerAction()`, a
wrapper, CSS). A hunk that is still needed comes with its contract spec assertions, its entry in
`references/hunks.md`, and a way out: an upstream issue or PR, or the upstream change that would
replace it.

## Where things are

| What | Where |
|---|---|
| The patch | `patches/@excalidraw__excalidraw@<version>.patch`: `dist/dev/index.js`, `dist/prod/index.js`, `dist/types/excalidraw/index.d.ts`, `dist/types/excalidraw/types.d.ts`. Kept LF by `.gitattributes` (`patches/** eol=lf`) |
| Its registration | `patchedDependencies` in `pnpm-workspace.yaml`, keyed by the exact version |
| The pinned version | `apps/client/package.json` and `apps/standalone/package.json`, exact (no range) |
| The patch hash | `sha256` of the patch file, once in `patchedDependencies` and once per importer and snapshot (4 places today; the count follows the importers), in `pnpm-lock.yaml` **and** in pnpm's copy, `node_modules/.pnpm/lock.yaml` |
| The installed copy | `node_modules/@excalidraw/excalidraw`, the only one: the workspace uses `nodeLinker: hoisted` |
| The guards | `apps/client/src/widgets/type_widgets/canvas/excalidraw_contract.spec.ts` (every hunk but one, in both bundles, plus the unpatched internals Trilium relies on) and `excalidraw_offsets.spec.ts` (the `getEditorUIOffsets` hunk) |

The package's `development` export is `dist/dev`, which the Vite dev server and Vitest load; builds
load `production`, `dist/prod`. A hunk missing from the prod bundle therefore works in development
and fails in every release build, and only the contract spec notices before that.

## The script

`node .claude/skills/patching-excalidraw/excalidraw_patch.mjs <command>`, from the repository root.
It downloads releases from the npm registry (checked against their integrity), works in a scratch
directory (`<os tmp>/trilium-excalidraw-patch`, or `--dir`), and never runs pnpm.

| Command | Does |
|---|---|
| `check` | Checks that the workspace entry, the pinned versions, the hash in both lockfiles and the patch agree, and that each installed file is the patched one (by its git blob id, which the patch records). Exit code 1 on any mismatch |
| `open` | Builds a scratch git repo for the patched version: the release's files staged as the base, the patch applied in the working tree. Confirms that it reproduces the patch byte for byte. Refuses to overwrite unsaved edits without `--force` |
| `changes [file...]` | Prints the patch as word-level snippets, `[-removed-]{+added+}` with some context. The readable view of the minified prod bundle. `--version` reads another version's repo, `--context n` |
| `save` | Checks that each script parses, writes the patch with `git diff --full-index --diff-algorithm=patience`, replaces the hash everywhere in both lockfiles and copies the files into `node_modules`. After a rebase it writes the new version's patch, moves the workspace entry and the pins, and deletes the old patch file. Refuses a patch that leaves a file unchanged without `--force` |
| `rebase <version>` | Carries the patch onto another release: a three-way merge per file, the minified prod bundle reset to the release's own file for work by hand. Lists what needs attention |

## Changing the patch

1. `check`. A `MATCHES NEITHER` or `UNPATCHED` file means a pnpm install ran or is running; a
   wrong hash means someone edited the patch without the lockfile.
2. `open`, and edit the files under the scratch repo it names.
3. **Write the change in the dev bundle first**, with a `// Trilium patch:` comment on the
   changed code that says what it does. A new option goes into `UIOptions` in `types.d.ts` with a
   `Trilium patch:` doc comment; `App` reads it as `this.props.UIOptions.x`, an action as
   `app.props.UIOptions.x` (actions get `app` as the fourth argument of `perform` and as a prop of
   `PanelComponent`). An internal function made public goes into the export list of both bundles
   and gets a declaration in `dist/types/excalidraw/index.d.ts`.
4. **Then make the same change in the prod bundle.** Run `changes dist/prod/index.js` to see how
   the existing hunks look there. Minification keeps property and method names, string
   literals, `this.props`, `this.state` and `UIOptions` keys, and renames local variables and
   imported helpers, so look for the spot by the names that survive. A helper imported from
   another module has a short alias in prod (`hitElementBoundingBox` is `ax` in 0.18.1): find it
   at another call site that both bundles share, and check that the alias is not declared again in
   the scope you patch. If prod's `index.js` does not import a helper at all, the import would
   come from a content-hashed `chunk-*.js` file; choose another place for the change instead.
5. Add the contract spec assertion for the new hunk **before** `save`: it fails against the
   installed bundle (red), then passes once `save` copies the patched files in (green). Check both
   bundles, on the source with whitespace removed (`replace(/\s+/g, "")`); count the occurrences
   when the hook appears a known number of times. The existing tests show the patterns.
6. `save`, then restart the dev server so that Vite pre-bundles Excalidraw again; under
   `pnpm server:start`, `touch apps/server/src/main.ts` makes `tsx watch` restart it. The new
   `lockfileHash` in `.cache/vite-<port>/deps/_metadata.json` shows that it did.
7. Run `pnpm --filter client test excalidraw_` (both guards) and the specs of the feature, then
   `pnpm typecheck` if a `.d.ts` changed.
8. Add the hunk to `references/hunks.md`. Commit the patch together with `pnpm-lock.yaml`: CI
   installs with `--frozen-lockfile`, so a patch without its hash fails every job at install. The
   commit body says why Excalidraw needed the hunk and what would let it go.

## Upgrading Excalidraw

Renovate has no rule for Excalidraw, so a new release arrives as an ordinary bump PR. That PR
changes the pins but not the patch entry, which still names the old version, and pnpm fails the
install on a patch that matches no installed version. Do the upgrade with these steps instead,
on a branch.

1. **Read the release notes against `references/hunks.md`.** Some hunks are backports or have
   upstream replacements in waiting (`getFormFactor`, the freedraw width, the `interaction` prop for
   the no-tool mode); drop what the release makes unnecessary.
2. `rebase <version>`. Per file it reports `merged`, `CONFLICTS` (ours is the new release,
   theirs the patched old one), `BY HAND` (minified: reset to the release) or `GONE`.
3. **Review every clean merge.** A hunk can apply cleanly in code that upstream changed around
   it. The command that `rebase` prints (`git -C <repo> diff <old tree> <new tree> -- <path>`) shows
   upstream's changes; read the ones near each hunk. For hunk 7, search the new dev bundle for
   readers of `originalElements`.
4. **Re-apply the prod changes** with `changes --version <old> dist/prod/index.js` as the list,
   finding each spot as in step 4 of "Changing the patch". Between patch releases the minified
   names mostly hold (the 0.18.1 anchors checked against 0.18.0 were all there); across minor
   releases expect new ones. A function that the patch exports needs its new minified name, found
   by its body.
5. `save`. It writes `patches/@excalidraw__excalidraw@<new>.patch`, moves the `pnpm-workspace.yaml`
   entry and both pins, and deletes the old patch file. Then `pnpm install`, which rewrites the
   lockfile and applies the new patch, and `check`.
6. **Run both guards.** A failure in the unpatched half of the contract spec names the Trilium
   code to review (table at the end of `references/hunks.md`). Rewrite the negative check of
   `excalidraw_offsets.spec.ts`, which names 0.18.1's minified variables and cannot fail after an
   upgrade.
7. **Check what the patch does not cover:**
   - asset paths: `window.EXCALIDRAW_ASSET_PATH` in `canvas/Canvas.tsx`, the dev route in
     `apps/server/src/routes/assets.ts`, the font copies (`viteStaticCopy` of `dist/prod/fonts`) in
     the client and standalone Vite configs;
   - languages: `LANGUAGE_MAPPINGS` in `canvas/i18n.ts` against `dist/prod/locales`
     (`adding-a-display-language` skill);
   - stylesheets that select Excalidraw's classes outside `CanvasDrawing.css`, which the contract
     spec does not read: `theme-next/notes/canvas.css` most of all, then `canvas/Canvas.css`,
     `NoteEmbeddable.css`, the menu, shell and form stylesheets, and the Bootstrap `<legend>` rule
     rewritten in `apps/client/vite-plugins.mts`;
   - desktop: the `enable-experimental-web-platform-features` switch (export) in
     `apps/desktop/src/main.ts` and the File System Access grant in `web_contents_security.ts`;
   - React: Excalidraw runs on `preact/compat`, so check that the release needs no React API that
     compat lacks.
8. **Try the three editors** that share `CanvasEditor`: a canvas note, a drawing in a text note
   (in the note, in fullscreen, at a narrow width, on touch with no tool), and a canvas slide in a
   presentation. Draw with the pen, erase, zoom to fit, export in the dark theme, search.

## Traps already hit

- **Only the patience (or histogram) diff reproduces the patch.** git's default algorithm realigns
  an unchanged hunk once new hunks come before it. `save` always uses patience.
- **The lockfile holds the hash several times**, and the count has changed (it was 5 at one point).
  Replace every occurrence, never a fixed number; `save` does.
- **Vite 8 hashes `node_modules/.pnpm/lock.yaml`, not `pnpm-lock.yaml`**, and ignores `patches/`
  for pnpm. With only `pnpm-lock.yaml` updated, a restarted dev server still serves the old
  pre-bundle from `.cache/vite-<port>/deps`: seen as "does not provide an export named
  'getMatchedLines'" and broken drawings. `save` updates both files.
- **A running pnpm install rewrites `node_modules`** from a fresh copy, so for a moment the
  installed bundle is unpatched or half written. Run `check` again before chasing it.
- **The real module does not import under Vitest** (the `open-color` JSON import), so specs mock
  `@excalidraw/excalidraw` and the contract spec reads the bundles as text. Vitest resolves the
  `development` export; the contract spec derives both `dist` folders from it, and a spec that
  reads `require.resolve()` sees one bundle only.
- **A stylesheet imported with `?raw` is empty in client specs**: the contract spec reads
  `CanvasDrawing.css` with `readFileSync`.
- **A minified anchor can occur twice** (`isMobile:this.isMobileBreakpoint(r,n)` in 0.18.1); patch
  the one in the same function as the dev hunk.
- **A bundle copied out of its package loses the package's `"type": "module"`**, and
  `node --check` then parses it as a script and fails on `import`; `save` checks copies named
  `.mjs`.
- **Don't hand-edit the patch file.** Hunk line counts and the blob ids on its `index` lines must
  match the files; edit the scratch repo and `save`.
