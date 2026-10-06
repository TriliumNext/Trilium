---
name: maintaining-docker-hub
description: Use when working on Trilium's published Docker images on Docker Hub or GHCR rather than on the Dockerfiles — "how many pulls does the image get?", "why is the Docker Hub repository so big?", "clean up old tags", "delete untagged images", "which tags do we publish?", the legacy repositories (triliumnext/notes, zadam/trilium) and their mirroring, the main-docker.yml copy-to-Docker-Hub step, mirror-legacy-docker.yml, Docker Hub categories, stars or the overview. Includes hub.mjs (stats, tag listing/deletion, the manifest inventory and a safe untagged-image purge, all dry-run by default) and the storage model that decides how a cleanup works. Do NOT use for building or running the image locally (see the Developer Guide's Docker page).
---

# Maintaining Trilium's Docker Hub repositories

Everything below is done through one script, [hub.mjs](hub.mjs). Don't write throwaway Python or curl
loops against the Hub API — the pagination caps, token expiry, rate limits and the storage model
below each broke a hand-rolled attempt once.

```bash
H=.claude/skills/maintaining-docker-hub/hub.mjs
node $H stats triliumnext/trilium triliumnext/notes zadam/trilium   # pulls, stars, storage, weekly series
node $H tags triliumnext/trilium --prefix sha-                       # list; add --delete to delete
node $H inventory triliumnext/trilium                                # every manifest, untagged included
node $H purge triliumnext/trilium --older-than 7                     # dry run; add --delete to delete
```

Credentials come from `docker login` (`~/.docker/config.json` or its `credsStore` helper), or from
`DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN`. `stats` and listing work for anyone signed in; deleting needs
an owner of the namespace. **Every delete is the user's call** — run the dry run, report its numbers,
and wait for an explicit go-ahead before `--delete`. A delete is not reversible.

## The repositories

| Repository | Role | Pulls / week (Sep 2026) | Credentials in CI |
| --- | --- | --- | --- |
| `triliumnext/trilium` | the image | ~140K | `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` |
| `ghcr.io/triliumnext/trilium` | build target; every tag, `sha-*` included | — | `GITHUB_TOKEN` |
| `triliumnext/notes` | pre-rename image, last own build v0.95.0 | ~29.6K | same as the image |
| `zadam/trilium` | the original Trilium image, last own build 0.63.7 | ~24K (from totals) | `zadam` + `ZADAM_DOCKERHUB_TOKEN` |

`stats` prints the weekly series Docker Hub embeds in the repository page (`repoPullsData`); it is
published for organization repositories only, so `zadam/trilium` has none and its rate has to be
derived from `pull_count` snapshots (the Wayback Machine has archived copies of
`hub.docker.com/v2/repositories/<repo>`). Pulls count manifest requests, so auto-updaters
(Watchtower, Diun) polling an unchanged tag inflate them — read them as "installations still
tracking this", not downloads.

## What is published where

`.github/workflows/main-docker.yml` builds on GHCR and copies to Docker Hub in its merge job:

- **`sha-<commit>`** — GHCR only. Until 2026-10 they were copied to Docker Hub too, which left
  1,672 `sha-*` tags and ~10K untagged images there (974 GB in `triliumnext/trilium`, 658 GB in
  `triliumnext/notes`). The copy loop skips them now; do not undo that.
- **`main`, `v<version>`, `stable`, `latest`** — both registries. `stable`/`latest` only for a
  version tag without a hyphen.
- **`<branch-name>`** — both, from a manual run of the workflow on a branch (`/` becomes `-`, e.g.
  `feature-deployment_fixes`). Delete it on Docker Hub once the branch is merged.

`.github/workflows/mirror-legacy-docker.yml` copies `ghcr.io/triliumnext/trilium:stable` to
`triliumnext/notes:stable`+`latest` and `zadam/trilium:latest` after each stable release (the
`mirror_legacy` job). The old version tags and `zadam/trilium:0.63-latest` are left alone, so pinned
installs keep their version. A manual run with an empty _tags_ input writes the release tags. The
container contract (port 8080, `/home/node/trilium-data`, `USER_UID`/`USER_GID`) has not changed
since 0.63, and a migration writes a `before-migration` backup; desktop clients of the old version
stop syncing until replaced (`SYNC_VERSION` 32/36 → 39). The `zadam` account's token is a personal
access token, which Docker Hub cannot restrict to one repository — it must carry an expiry date.

## How Docker Hub stores images

These four facts decide every cleanup — verified against the live repositories in 2026-10:

1. **Deleting a tag frees nothing.** The image stays, pullable by digest, and keeps counting toward
   `storage_size`. Tag cleanup is cosmetic; storage only drops when the *untagged image* is deleted.
2. **Deleting an image index deletes its per-platform images.** Trilium's index holds 8 manifests (4
   platforms + 4 attestations); after `DELETE` of the index all of them answer `404`. So a purge
   deletes indexes only — never walk the children (that would be 13K wasted requests).
3. **A digest a tag still uses cannot be deleted** — the registry answers `403`. That holds through
   an index: a `sha-*` build of a release commit has the same digest as `v<version>`, and its
   children are the release's children. `purge` also subtracts a keep list (every live tag's index
   and children), so the 403 is a second line, not the only one.
4. **Untagged images are listed by `GET /v2/namespaces/<ns>/repositories/<name>/manifests`**
   (`last_evaluated_key` pagination), which is what `inventory` and `purge` read. It is not in
   Docker's public API reference; the older `/images` endpoints return 404. It reports the
   per-platform images of a *tagged* index as untagged single manifests — they are not orphans.

`storage_size` tracks deletions within minutes. Its "before" values were real: the
`triliumnext/trilium` purge took it from 974 GB to 18 GB, `triliumnext/notes` from 658 GB to 19 GB.

## Recipes

**Clean a repository** (after a burst of unwanted tags, or periodically):

1. `node $H tags <repo> --prefix <p>` → report the count → with consent, `--delete`. The listing
   returns at most 1,000 tags and its `count` lags several minutes; re-run until it reports 0.
2. `node $H purge <repo> [--older-than N]` → report the dry run → with consent, `--delete`.
   `purge` refuses to run while the repository has 1,000+ tags, because the keep list would be
   incomplete — finish step 1 first.
3. Verify: `docker manifest inspect <repo>:<tag>` for `latest`, `stable`, `main` and a couple of
   versions, and `node $H stats <repo>` for the storage figure.

About 60–250 deletes a minute at the default `--concurrency 4`; the rate varies by time of day.

**Open issue — `main` keeps leaving untagged images.** Each push to `main` moves the `main` tag and
leaves the previous index untagged on Docker Hub: ~12 a day in early 2026-10, ~640 MB each. Either
keep `main` on GHCR only (as with `sha-*`; then document `ghcr.io/triliumnext/trilium:main` for
anyone tracking it) or run `purge --older-than 7` periodically. Until one lands, expect the
inventory to show recent untagged indexes.

## Traps

- **Docker Hub's _Image Management_ page shows the per-platform images of tagged indexes as
  untagged** and has no "untagged" filter. Never tell the user to bulk-delete untagged _Image_ rows
  there — it breaks `docker pull` of releases. Indexes only, or use `purge`.
- **Two tokens, two lifetimes.** The Hub API (`hub.docker.com`) wants a JWT from
  `POST /v2/auth/token`; the registry (`registry-1.docker.io`) wants one from `auth.docker.io` with
  scope `repository:<repo>:pull,push,delete`. Both expire after minutes; `hub.mjs` renews on 401.
  A long run that does not renew dies at ~650 requests with a wall of 401s.
- **Rate limits.** The Hub API answers 429 after a few thousand requests; the script backs off.
  Don't probe tags one by one anonymously — it hits the limit within a minute.
- **Stopping a background run:** `pkill -f "hub.mjs purge"` also matches the shell that issued it if
  the pattern appears in that command line. Use the PID, or `ps -eo pid,args | grep "[n]ode .*hub.mjs"`.
- **GHCR and Docker Hub digests match only for images CI copied** with `crane copy` (all of
  `triliumnext/trilium`, and `triliumnext/notes` from v0.95.0). Older `triliumnext/notes` images
  were built per registry. The inventory makes GHCR unnecessary as a digest source anyway.

## Visibility

- Categories (`stats` prints them): the knowledge-base peers use _Content management system_
  (Wiki.js, BookStack, MediaWiki, XWiki, Outline, Docmost); `triliumnext/trilium` adds _Machine
  learning & AI_. Most note apps set none.
- Stars need a signed-in visit to the repository page, and `docker pull` never shows the page —
  links from the README badge, the User Guide's Docker page and the legacy repositories' overviews
  are what bring visitors. Never ask for stars in the app or in issue replies.
- The legacy repositories' overview and short description must say they mirror
  `triliumnext/trilium` and that users should switch image names.

## Related

- `docs/Developer Guide/Developer Guide/Building/Docker Hub maintenance.md` — the human-facing
  version of this page; keep the two in step.
- **cutting-a-release** — a release is what moves `stable`/`latest` and triggers the legacy mirror.
