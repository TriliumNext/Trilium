# Release CI pipeline anatomy (`release.yml`)

For debugging a red **Release** run. Everything here is `.github/workflows/release.yml` unless noted. Trigger: `push: tags: v*` (lines 3-5) — only `v`-prefixed tags.

## Job graph

```
sanity-check ──┬──> make-electron  (matrix: 6 builds)  ──┐
               └──> build_server   (matrix: 2 builds)  ──┴──> publish_release
                                                              │
                                              (on release: published)
                                                              ▼
                                                       release-winget.yml
```

`make-electron` and `build_server` both `needs: sanity-check` (lines 34, 103). `publish_release` `needs: [make-electron, build_server]` (lines 133-135), so it runs only after every build artifact exists.

## Job 1 — `sanity-check` (the version gate)

- Installs `--frozen-lockfile --ignore-scripts` (line 28), then runs `pnpm tsx scripts/check-version-consistency.ts ${{ github.ref_name }}` (line 31). `github.ref_name` is the tag (e.g. `v0.103.0`); the script strips the leading `v` (`check-version-consistency.ts:20-22`).
- **Validates only 5 files** (`check-version-consistency.ts:5-11`): root, `apps/server`, `apps/client`, `apps/desktop`, `packages/commons`. The other 4 that `update-version` writes (standalone, edit-docs, pdfjs-viewer, trilium-core) are **never checked here** — see the main SKILL.md.
- **Fails when:** any of those 5 versions ≠ the tag. Message: `Version mismatch in <file>: expected <tag>, found <ver>` (`check-version-consistency.ts:29`).
- Fix: bump root, re-run `pnpm chore:update-version`, re-commit, re-tag.

## Job 2 — `make-electron` (Electron desktop matrix)

- Matrix `arch: [x64, arm64] × os: [macos-latest, ubuntu-22.04, win-signing]`, **excluding** arm64-linux from that cross and **adding** a native `ubuntu-24.04-arm` arm64-linux runner (lines 36-65). The exclude+include is a runner swap, so it's a net 6 builds (mac x64/arm64, win x64/arm64, linux x64 + native linux arm64).
- Installs `--frozen-lockfile` (line 76), then `./.github/actions/build-electron` (line 78) with Apple notarization / Windows signing / GPG secrets (lines 84-93).
- Uploads `release-desktop-${os}-${arch}` from `apps/desktop/upload/*.*` (lines 95-99).
- **Fails when:** the build or test step inside `build-electron` fails, or signing secrets are missing on a signed runner. `fail-fast: false` (line 37) so one arch failing doesn't cancel the rest — but `publish_release` still won't run.
- If the failure is a *test* step: see the **writing-unit-tests** / **analyzing-coverage** skills.

## Job 3 — `build_server` (Linux server tarballs)

- Matrix `arch: [x64, arm64]` on `ubuntu-22.04` / `ubuntu-24.04-arm` (lines 105-114), `./.github/actions/build-server` (line 119).
- Uploads `release-server-linux-${arch}` from `upload/*.*` (lines 124-128).

## Job 4 — `publish_release`

- `mkdir upload` (137); sparse-checkout of just `docs/Release Notes` (lines 139-142); downloads **all** `release-*` artifacts merged into `upload/` (`download-artifact`, `pattern: release-*`, `merge-multiple: true`, lines 144-149); then `softprops/action-gh-release@v3.0.0` (line 152).
- The release-body / labeling / token fields are the hard-fail surface — table below.

| Field (line) | Value | Fails when |
|---|---|---|
| `body_path` (155) | `docs/Release Notes/Release Notes/${{ github.ref_name }}.md` | the file doesn't exist (doubled folder + `v` prefix) → `ENOENT` |
| `fail_on_unmatched_files` (156) | `true` | `upload/*.*` is empty (an upstream build job produced no artifact) |
| `files` (157) | `upload/*.*` | — |
| `discussion_category_name` (158) | `Releases` | the `Releases` discussion category doesn't exist, or token lacks `discussions: write` |
| `make_latest` (159) | `${{ !contains(github.ref, 'rc') }}` | (no fail) substring on `refs/tags/...`; non-`rc` ⇒ marked latest |
| `prerelease` (160) | `${{ contains(github.ref, 'rc') }}` | (no fail) only `rc` ⇒ prerelease; `-beta` does NOT |
| `token` (161) | `${{ secrets.RELEASE_PAT }}` | PAT missing/expired/insufficient scope (needs `repo` + discussion write) |

## Downstream — `release-winget.yml`

Separate workflow, fires on `release: types: [published]` (lines 2-4) — i.e. after `publish_release` succeeds. Also `workflow_dispatch` with a `release_tag` input (lines 5-10). Calls `vedantmgoyal9/winget-releaser` with `identifier: TriliumNext.Notes` and **`token: ${{ secrets.WINGET_PAT }}`** (lines 16-19) — a different PAT from `RELEASE_PAT`. A winget failure does **not** affect the GitHub release; re-dispatch this workflow with the tag to retry.

## Failure → job cheat-sheet

| Symptom | Job | Root cause / fix |
|---|---|---|
| `Version mismatch in <file>` | sanity-check | one of the 5 checked files is stale; re-bump from root. Run the pre-flight to also catch the 4 it *doesn't* check. |
| Release created with wrong/empty notes, or `ENOENT` on body | publish_release | release-notes file missing/misnamed at `docs/Release Notes/Release Notes/<tag>.md` |
| `make_latest`/prerelease wrong | publish_release | tag's `rc` substring (or absence) — only `rc` flips it; rename the tag |
| `fail_on_unmatched_files` / no artifacts | publish_release | an upstream `make-electron` / `build_server` matrix leg failed — open that job |
| 403 / can't create discussion | publish_release | `RELEASE_PAT` (not `GITHUB_TOKEN`) missing or under-scoped |
| GitHub release fine, winget never updates | release-winget | `WINGET_PAT` problem; re-run `release-winget.yml` via dispatch with the tag |
| Electron/server build step red | make-electron / build_server | a real build or test break — see **writing-unit-tests** / **analyzing-coverage** |
