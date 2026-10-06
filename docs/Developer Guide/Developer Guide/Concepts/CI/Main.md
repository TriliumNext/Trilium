# Main
The main workflow of the CI:

*   Builds the Docker image and publishes in the GitHub Docker registry.
*   Builds using a portion of the [delivery script](../../Building/Build%20deliveries%20locally.md) artifacts for the following platforms:
    *   Windows `x86_64` as .zip file
    *   Windows `x86_64` installer (using Squirrel)
    *   macOS `x86_64` and `aarch64`.
    *   Linux `x86_64`
    *   Linux server `x86_64`.

The main workflow of the CI runs on `develop` branches as well as any branch that starts with `feature/update_`.

## Downloading the artifacts from the main branch

Simply go to the [`develop` branch on GitHub](https://github.com/TriliumNext/Trilium) and look at the commit bar:

<figure class="image"><img src="Main_image.png"></figure>

Press the green checkmark (or red cross if something went bad). Then look at the list of jobs and their status:

<figure class="image"><img src="1_Main_image.png"></figure>

Then look for any of the entires that starts with “Main” and press the “Details” link next to it. It doesn't really matter which platform you'll choose as the artifacts are available on the same page.

## Preview deployments

Three workflows publish a Cloudflare Pages preview for every pull request: `deploy-app.yml` (the standalone app, `trilium-app`), `deploy-docs.yml` (`trilium-docs`) and `website.yml` (`trilium-homepage`). Each preview lands at `https://pr-<number>.<project>.pages.dev` and a bot comment on the pull request carries the link.

Those workflows do not deploy the preview themselves. A `pull_request` run started from a fork receives neither secrets nor repository variables, so it cannot reach Cloudflare and `vars.REPO_MAIN` reads as empty. Instead the run builds, `.github/actions/upload-cloudflare-preview` uploads the built directory and the pull request number as artifacts, and the completed run raises a `workflow_run` event. `deploy-previews.yml` answers that event and calls `cloudflare-preview.yml`, which downloads the artifacts, deploys with `wrangler` and posts the comment. A `workflow_run` run always executes the default branch's copy of the workflow with the base repository's secrets.

Two consequences are worth knowing:

*   `cloudflare-preview.yml` must never check out the pull request's head or install its dependencies. It holds the Cloudflare credentials, and running fork-authored code beside them would hand those credentials away. Its only fork-controlled input is a directory of static files passed to `wrangler`.
*   A pull request can edit the workflow that writes the artifacts, so the pull request number it claims is checked against `workflow_run.head_sha` before it is used.
*   The build is served as static files, but Cloudflare Pages runs a `functions/` directory and `_worker.js` server-side, where the project's bindings are reachable. None of the three sites uses them, so a build carrying one fails the deploy rather than publishing it. `_headers` and `_redirects` are published as usual; `apps/standalone/public/_headers` sets the cross-origin isolation the app needs.

Because GitHub only triggers `workflow_run` from workflow files on the default branch, changes to `deploy-previews.yml` and `cloudflare-preview.yml` take effect once they are merged into `main` and cannot be exercised from a branch.