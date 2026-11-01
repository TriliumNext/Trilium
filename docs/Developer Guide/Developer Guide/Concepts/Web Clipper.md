# Web Clipper
The Web Clipper is present in the monorepo in `apps/web-clipper`. It's based on [WXT](https://wxt.dev/guide/introduction.html), a framework for building web extensions that allows very easy development and publishing.

## Manifest version

Originally the Web Clipper supported only Manifest v2, which made the extension incompatible with Google Chrome. [#8494](https://github.com/TriliumNext/Trilium/pull/8494) introduces Manifest v3 support for Google Chrome, alongside with Manifest v2 for Firefox.

Although Firefox does support Manifest v3, we are still using Manifest v2 for it because WXT dev mode doesn't work for the Firefox / Manifest v3 combination and there were some mentions about Manifest v3 not being well supported on Firefox Mobile (and we plan to have support for it).

## Development

WXT allows easy development of the plugin, with full TypeScript support and live reload. To enter dev mode:

*   Run `pnpm --filter web-clipper dev` to enter dev mode for Chrome (with manifest v3).
*   Run `pnpm --filter web-clipper dev:firefox` to enter dev mode for Firefox (with manifest v2).

This will open a separate browser instance in which the extension is automatically injected. Its profile is kept in `apps/web-clipper/.wxt/chrome-data` or `.wxt/firefox-data`, so the extension's settings and its toolbar button stay between runs; delete the folder to start with a fresh profile.

> [!NOTE]
> On NixOS, the same development commands work just fine. Just make sure the browser is available in the system path:
> 
> ```sh
> nix-shell -p chromium
> ```

## Default port

The default port is:

*   `37743` if in development mode, the port `pnpm desktop:start` runs the desktop app on, so a dev build of the Clipper finds a dev desktop instance.
*   `37840` in production, the default Trilium port.

`pnpm desktop:start-prod` and `desktop:start-prod-no-dir` run the desktop app on `37841`, so a production build of the Clipper needs that port set in its options to find them.

## Building

*   Run `build` (Chrome) or `build:firefox` to generate the output files, which will be in `.output/[browser]`.
*   Run `zip` or `zip:firefox` to generate the ZIP files. `zip:firefox` also generates the sources ZIP that Mozilla's reviewers build the extension from.

The sources ZIP has the monorepo's layout: the workspace files and lockfile, `apps/web-clipper`, and the stylesheets and fonts the Clipper imports from `apps/client`, listed in `zip.includeSources` in `wxt.config.ts`. A new import from outside `apps/web-clipper` must be added to that list. `apps/web-clipper/README.md`, which tells the reviewers how to build, is copied to the root of the ZIP.

## CI

`.github/workflows/web-clipper.yml` handles the building of the web clipper. Whenever the web clipper is modified, it generates the ZIPs and uploads them as artifacts. It also rebuilds the Firefox extension from the sources ZIP and fails if the result differs from the regular build, which catches a file missing from `zip.includeSources`.

## Releasing

A release is started by pushing a tag. The version is the one in `apps/web-clipper/package.json`, not the tag's: both stores accept only numbers and dots, and a version can be submitted only once.

*   **Release candidate** (`web-clipper-v1.2.0-rc1`, with the version set below the final one, such as `1.1.90`): the Firefox build is signed on Mozilla's unlisted channel, which only signs it and does not list it, and a GitHub pre-release is created with the ZIPs and the signed `.xpi`, which installs in any Firefox.
*   **Release** (`web-clipper-v1.2.0`, with the version set to `1.2.0`): a GitHub release is created with the ZIPs, and the extension is submitted to the Chrome Web Store and to Firefox Add-ons, where it is published once the review passes. Each store is a job of its own, so a failed one can be re-run without submitting to the other again.

Running the workflow by hand (_Actions_ → _Deploy web clipper extension_ → _Run workflow_) checks the store credentials with a dry run, without uploading anything.

The workflow reads these repository secrets:

| Secret | Store | Value |
| --- | --- | --- |
| `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` | Firefox Add-ons | API credentials from the Developer Hub (_Tools_ → _Manage API Keys_), of an account that develops the add-on. |
| `CHROME_PUBLISHER_ID` | Chrome Web Store | The publisher ID shown in the Chrome Web Store developer dashboard. |
| `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL`, `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` | Chrome Web Store | A Google Cloud service account with the Chrome Web Store API enabled, added under _Publisher_ → _Settings_ in the Chrome Web Store developer dashboard. The private key is the PEM block, with real line breaks. |

The release text is not generated; write it on the GitHub release once the workflow has created it.