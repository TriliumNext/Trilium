# Docker Hub maintenance
Trilium's server image is built by `.github/workflows/main-docker.yml` and published to two registries: GHCR (`ghcr.io/triliumnext/trilium`) and Docker Hub (`triliumnext/trilium`). This page describes which tags go where, how the legacy repositories are kept up to date, and how to clean up a repository that has accumulated images nobody uses.

## Where tags are published

| Tag | GHCR | Docker Hub | Created by |
| --- | --- | --- | --- |
| `main` | yes | yes | every push to `main` that touches the app |
| `sha-<commit>` | yes | **no** | every build |
| `v<version>` | yes | yes | a version tag |
| `stable`, `latest` | yes | yes | a version tag without a hyphen (not a prerelease) |
| `<branch-name>` | yes | yes | a manual run of the workflow on a branch |

The `sha-*` tags stay on GHCR only. Before October 2026 they were copied to Docker Hub as well, where nothing ever removed them: by October 2026, 1,672 of the 1,698 tags in `triliumnext/trilium` were `sha-*`, and the repository reported 974 GB of storage.

A manual run of the workflow on a branch also publishes a tag named after the branch, with `/` replaced by `-` (for example `feature-deployment_fixes`). Delete it on Docker Hub once the branch is merged.

Each push to `main` moves the `main` tag and leaves the previous image on Docker Hub without a tag, about a dozen a day. Until `main` is kept on GHCR only, clean them up from time to time as described below.

## Legacy repositories

Two older Docker Hub repositories still receive many pulls from installations that update automatically:

| Repository | History | Pulls per week (Sep 2026) |
| --- | --- | --- |
| `triliumnext/notes` | TriliumNext's image before the rename, last own build v0.95.0 | ~29,600 |
| `zadam/trilium` | the original Trilium image, last own build 0.63.7 | ~24,000 |

`.github/workflows/mirror-legacy-docker.yml` copies `ghcr.io/triliumnext/trilium:stable` to `triliumnext/notes:stable`, `triliumnext/notes:latest` and `zadam/trilium:latest` after every stable release; `main-docker.yml` calls it from its `mirror_legacy` job. The version tags and `0.63-latest` on `zadam/trilium` are left unchanged, so installations that pin a version keep it. To run the mirror by hand, start the workflow from the _Actions_ tab; an empty _tags_ field writes each repository's release tags.

Each repository has its own credentials:

*   `triliumnext/notes` uses the `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` secrets, like the main image.
*   `zadam/trilium` logs in as `zadam` with the `ZADAM_DOCKERHUB_TOKEN` secret, a Read & Write access token of that account. A personal access token cannot be limited to one repository, so give it an expiry date.

Pull statistics are on each repository's page on Docker Hub; `hub.mjs stats` (below) prints them, including the weekly series Docker Hub publishes for repositories owned by an organization.

## How Docker Hub stores images

Four facts decide how a cleanup works:

*   **Deleting a tag does not delete the image.** The image stays in the repository, can still be pulled by digest and still counts towards the repository's storage. Only deleting the untagged image frees space.
*   **Deleting an image index also deletes the images inside it.** A multi-platform image is an index that points to one manifest per platform plus its attestations (eight for Trilium). Once the index is gone, those manifests return `404` as well, so a cleanup deletes indexes only.
*   **Docker Hub refuses to delete a manifest that a tag still uses.** A `DELETE` of such a digest returns `403`, so a cleanup cannot break a tag that is kept, even when a deleted image shares its digest with a release (a `sha-*` build of a release commit is the same image as `v<version>`).
*   **`GET /v2/namespaces/<namespace>/repositories/<name>/manifests` lists every manifest in a repository, untagged ones included.** It is not in Docker's public API reference. It reports the per-platform images of a tagged index as untagged, so an untagged single manifest is not necessarily an orphan.

> [!WARNING]
> Never bulk-delete the untagged _Image_ entries in Docker Hub's _Image Management_ page. The per-platform images of every kept tag appear there as untagged, and deleting them breaks `docker pull` of those tags. Delete image indexes only.

## Cleaning up a repository

The `maintaining-docker-hub` skill in `.claude/skills` provides `hub.mjs`, which does the whole cleanup. Every command that deletes is a dry run unless `--delete` is passed.

```sh
H=.claude/skills/maintaining-docker-hub/hub.mjs
node $H stats triliumnext/trilium                      # pulls, stars, storage, tag count
node $H tags triliumnext/trilium --prefix sha-         # list tags; --delete deletes them
node $H inventory triliumnext/trilium                  # tagged and untagged manifests
node $H purge triliumnext/trilium --older-than 7       # untagged indexes; --delete deletes them
```

It reads the credentials of `docker login` (or `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`). Deleting needs an account that owns the namespace.

To clean up a repository:

1.  Delete the unwanted tags with `tags <repo> --prefix <prefix> --delete`. Docker Hub lists at most 1,000 tags at a time and its tag count lags behind deletions by several minutes, so run it again until it finds none.
2.  Delete the untagged indexes with `purge <repo> --delete`. `purge` keeps the index and the per-platform images of every remaining tag, and refuses to run while the repository has more than 1,000 tags, since its list of tags to keep would be incomplete.
3.  Check the kept tags with `docker manifest inspect <repo>:<tag>` for `latest`, `stable`, `main` and a few versions, and the storage figure with `stats`.

The storage figure follows within minutes. In October 2026 this took `triliumnext/trilium` from 974 GB to 18 GB and `triliumnext/notes` from 658 GB to 19 GB, about 17,000 untagged indexes in all, at 60 to 250 deletions per minute.

## See also

*   <a class="reference-link" href="Docker.md">Docker</a>, for building the image locally.
*   [docker/hub-feedback#2448](https://github.com/docker/hub-feedback/issues/2448), where Docker announced support for deleting manifests through the registry API.
*   [Registry API reference](https://docs.docker.com/reference/api/registry/latest/) on docs.docker.com.