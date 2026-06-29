---
name: cutting-a-release
description: Use when cutting, preparing, or debugging a Trilium release — bumping the monorepo version, tagging, or diagnosing a failed "Release" workflow run. Covers the ordered bump recipe (edit root package.json → chore:update-version → commit → v-prefixed tag → push), which of the TWO divergent version scripts to use (update-version for releases vs update-nightly-version for CI nightlies), why the CI version-consistency gate validates only 5 of the 8 files update-version writes, the exact `docs/Release Notes/Release Notes/<tag>.md` path the publish step hard-requires, the substring-based rc/beta "latest" labeling, and the RELEASE_PAT (not GITHUB_TOKEN) dependency. Bundles a pre-flight verifier that catches what the CI gate misses before you push the tag.
---

# Cutting a Trilium release

Releases are a tag push, not a button. Pushing a `v*` tag to `main` triggers `.github/workflows/release.yml`, which builds every artifact and creates the GitHub release. Get the version bump and the release-notes file right *before* you tag, because three of the failure modes below pass CI and ship anyway.

## Five traps that bite before you read anything else

1. **Edit the ROOT `package.json` only, then propagate.** Root is the single source of truth. `pnpm chore:update-version` (`scripts/update-version.ts:26-36`) reads root and writes 8 *other* package.jsons. Hand-editing the children desyncs the tree.
2. **There are TWO version scripts — use `update-version`, not `update-nightly-version`.** The nightly one (`scripts/update-nightly-version.ts`) writes a *different* set of files and appends a `-test-YYMMDD-HHMMSS` suffix; it's CI-only. Running it for a release poisons the version. ([§ The two scripts](#the-two-version-scripts--pick-the-right-one))
3. **The CI version gate is a strict SUBSET — don't trust it.** `scripts/check-version-consistency.ts` validates only 5 files; `update-version` writes 8. The 4 gaps (standalone, edit-docs, pdfjs-viewer, trilium-core) can be wrong and still ship. Run the bundled pre-flight, which checks all 9.
4. **The release-notes file must exist BEFORE you tag, at a DOUBLED path.** `docs/Release Notes/Release Notes/v<X.Y.Z>.md` — note `Release Notes/Release Notes/` twice, and the `v` prefix in the filename. The publish step `ENOENT`s without it (`release.yml:155`).
5. **The tag must be `v`-prefixed.** `release.yml` triggers only on `push: tags: v*` (`release.yml:3-5`). A bare `0.103.0` tag runs nothing, silently.

Don't hand-roll a version checker — run the bundled pre-flight, a superset of the CI gate:

```bash
npx tsx .claude/skills/cutting-a-release/scripts/preflight-release-check.mts v0.103.0
```

It asserts all 9 package.jsons match, that the release-notes file exists at the doubled path, and warns on the rc/beta labeling footgun (trap below). Run it right before pushing the tag.

## The recipe (order is load-bearing)

| # | Step | Command / file | Gotcha |
|---|------|----------------|--------|
| 1 | Write release notes | create `docs/Release Notes/Release Notes/v<X.Y.Z>.md` | filename = tag incl. `v`; publish hard-fails without it (`release.yml:155`) |
| 2 | Bump ROOT only | edit `package.json` `version` | do NOT hand-edit the other package.jsons |
| 3 | Propagate | `pnpm chore:update-version` | rewrites 8 package.jsons from root; never the reverse |
| 4 | Pre-flight | `npx tsx .claude/skills/cutting-a-release/scripts/preflight-release-check.mts v<X.Y.Z>` | catches the 4 files CI never checks + a missing notes file |
| 5 | Commit | `chore(release): prepare for v<X.Y.Z>` | stage every changed package.json + the new release-notes md |
| 6 | Tag (`v`-prefixed) | `git tag v<X.Y.Z>` | `release.yml` only fires on `v*` |
| 7 | Push commit + tag | `git push && git push --tags` | |
| 8 | Watch CI, then download + smoke-test the GitHub release | — | see [references/ci-pipeline.md](references/ci-pipeline.md) to map a red job |

The upstream doc (`docs/Developer Guide/Developer Guide/Building/Releasing a new version.md`, 9 steps) is the same recipe but **wrong on step 4**: it tells you to run `pnpm i` "to update the package lock" and calls it `package-lock.json`. A version-only bump does **not** change `pnpm-lock.yaml` (see footgun below), and the lockfile is `pnpm-lock.yaml`. Skip that step unless you also changed a real dependency.

## The two version scripts — pick the right one

| | `scripts/update-version.ts` | `scripts/update-nightly-version.ts` |
|---|---|---|
| npm script | `chore:update-version` (`package.json:37`) | `chore:ci-update-nightly-version` (`package.json:34`) |
| Use for | **releases — manual, this skill** | CI nightlies only |
| Invoked by | you | `nightly.yml:75`, `main-docker.yml:163` |
| Reads root version? | yes (`update-version.ts:27`) | yes, then mutates it |
| Writes root? | **no** | **yes** (`update-nightly-version.ts:47`) |
| Files written | **8**: apps server/client/standalone/desktop/edit-docs + packages commons/pdfjs-viewer/trilium-core (`update-version.ts:29,33`) | **6**: root + apps server/client/standalone/desktop + pdfjs-viewer (`update-nightly-version.ts:49,54`) |
| Version shape | root version, verbatim | strips `-beta`, appends `-test-YYMMDD-HHMMSS` (`update-nightly-version.ts:18-27`) |

The two sets diverge in both directions: `update-version` touches edit-docs/commons/trilium-core (nightly doesn't); nightly touches root (update-version doesn't). Run the wrong one and the tree desyncs — e.g. running nightly during a release stamps `0.103.0-test-260613-...` into root and leaves commons/trilium-core untouched.

## The CI gate checks 5 of 8 — verify all 9 yourself

`scripts/check-version-consistency.ts:5-11` validates exactly:

```
package.json, apps/server, apps/client, apps/desktop, packages/commons
```

(stripping a leading `v` from the tag arg, lines 20-22). But `update-version` writes **8**, so **`apps/standalone`, `apps/edit-docs`, `packages/pdfjs-viewer`, and `packages/trilium-core` are written but never validated.** A stale version in any of those passes the `sanity-check` job (`release.yml:30-31`) and ships.

This isn't theoretical — real release-prep commits touched *different* file subsets because `update-version` only produces a git diff for files that were previously stale: `v0.103.0` (`44f5be88b7`) changed 7 package.jsons including pdfjs-viewer; `v0.102.1` (`8ac9daa5d3`) changed 6, no pdfjs-viewer. The CI gate would not have caught a wrong value in the un-checked four either time. The bundled pre-flight checks all 9 — use it instead of trusting the gate.

## The publish step — exact strings that hard-fail

`release.yml` job `publish_release` (uses `softprops/action-gh-release@v3.0.0`, lines 151-161):

| Field (`release.yml`) | Value | Hard-fail / footgun |
|---|---|---|
| `body_path` (155) | `docs/Release Notes/Release Notes/${{ github.ref_name }}.md` | doubled folder + `v` prefix; `ENOENT` if missing |
| `make_latest` (159) | `${{ !contains(github.ref, 'rc') }}` | pure substring on the full ref `refs/tags/...` |
| `prerelease` (160) | `${{ contains(github.ref, 'rc') }}` | only `rc` is special-cased |
| `token` (161) | `${{ secrets.RELEASE_PAT }}` | **not** `GITHUB_TOKEN` — needs PAT to open the Releases discussion |
| `discussion_category_name` (158) | `Releases` | with `discussions: write` (`release.yml:8`) |
| `fail_on_unmatched_files` (156) | `true` | fails if no `upload/*.*` artifacts (an upstream build job failed) |

**The labeling footgun:** because only the literal substring `rc` flips `prerelease`, a `-beta` (or `-alpha`/`-dev`) tag does NOT match — it publishes with `make_latest=true` and `prerelease=false`, i.e. **marked the latest stable release.** If you want a pre-release that isn't the latest, the tag must contain `rc` (e.g. `v0.103.0-rc.1`). The pre-flight warns on this.

## Footgun list (each with a real cite)

- **Lockfile is NOT touched by a version-only bump.** Internal deps are `workspace:*` (resolve to `link:`, no version recorded — `grep 0.103.0 pnpm-lock.yaml` = 0 hits), and the release-prep commits above never touched `pnpm-lock.yaml`. CI installs `--frozen-lockfile` *before* any bump (`nightly.yml:71` then bump at `:75`; `release.yml:28`). `--frozen-lockfile` only fails if the release *also* changes a real dependency. The upstream doc's "run `pnpm i`" step is precautionary and misnames the file.
- **Tag must be `v`-prefixed** — `release.yml:3-5` triggers only on `v*`. A bare `0.103.0` tag does nothing.
- **`RELEASE_PAT`, not `GITHUB_TOKEN`** — `release.yml:161`. Confirmed the only PAT in the release flow; winget (downstream) uses a separate `WINGET_PAT` (`release-winget.yml:19`).
- **Don't hand-edit child package.jsons** — let `update-version` propagate from root, or they desync silently past the 5-file gate.
- **`update-version` is idempotent but partial in the diff** — it rewrites all 8 unconditionally; only the previously-stale ones show up in `git status`. "Only 6 files changed" is normal and not a sign you missed one.

## Hotfix variant

Same recipe, different branch. Per `docs/Developer Guide/Developer Guide/Branching strategy.md:20-30`: create a `hotfix` branch **from the release tag**, cherry-pick the needed fixes from `main`, bump + release from `hotfix` (the recipe above), then merge `hotfix` back into `main` via PR. The tag still triggers `release.yml` the same way — nothing about the bump/notes/labeling rules changes.

## Reference map

| File | When to open |
|---|---|
| [references/ci-pipeline.md](references/ci-pipeline.md) | Debugging a red "Release" run — job-by-job anatomy (sanity-check → make-electron matrix + build_server → publish_release), the exact failing string per job, and the downstream `release-winget.yml`. |
| [scripts/preflight-release-check.mts](scripts/preflight-release-check.mts) | Run before pushing the tag — superset of the CI gate (all 9 package.jsons + notes file + rc/beta labeling warning). |

Related skills: **writing-unit-tests** / **analyzing-coverage** if a build job's *test* step is what failed (the release builds run the suites); **evolving-the-data-model** if the release includes a DB migration whose version you also need to sanity-check.
