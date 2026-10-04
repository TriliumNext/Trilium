# Documentation
There are multiple types of documentation for Trilium:

*   The _User Guide_ represents the user-facing documentation. This documentation can be browsed by users directly from within Trilium, by pressing <kbd>F1</kbd>.
*   The _Developer's Guide_ represents a set of Markdown documents that present the internals of Trilium, for developers.
*   _Release Notes_, this contains the change log for each released or soon-to-be-released version. The release notes are used automatically by the CI when releasing a version.
*   The _Script API_, which is an automatically generated documentation for the front-end and back-end APIs for scripts.

## Location of the documentation

All documentation is stored in the [Trilium](https://github.com/TriliumNext/Trilium) repository:

*   `docs/Developer Guide` contains Markdown documentation that can be modified either externally (using a Markdown editor, or internally using Trilium).
*   `docs/Release Notes` is also stored in Markdown format and can be freely edited.
*   The _Script API_ is auto-generated and is **not** committed to the repository. It is built into the gitignored `site/` directory and published to [docs.triliumnotes.org](https://docs.triliumnotes.org/); see [Updating the Script API](#updating-the-script-api) below.
*   `docs/User Guide` contains Markdown documentation as well, together with a `!!!meta.json` file that describes the note tree (note IDs, share aliases, icons, attachments).
    *   From it, `apps/server/src/assets/doc_notes/en/User Guide` (the HTML rendered by the in-app help) and `apps/standalone/src/assets/help_meta.json` are generated. These generated files must never be edited by hand.
    *   The Markdown can be edited by hand, as long as the generated files are refreshed afterwards by running `pnpm edit-docs:sync-docs` (see below).

The mappings between note trees and directories are listed in `edit-docs-config.yaml` at the root of the repository.

## Editing the documentation

There are two ways to modify documentation:

*   Using a special mode of Trilium.
*   By manually editing the files.

### Using the `edit-docs` app

To edit the documentation using Trilium, set up a working development environment via <a class="reference-link" href="Environment%20Setup.md">Environment Setup</a> and run the following command: `pnpm edit-docs:edit-docs`.

How it works:

*   At startup, the documentation from `docs/` is imported from Markdown into a in-memory session (the initialization of the database is already handled by the application).
*   Each modification will trigger after 10s an export from the in-memory Trilium session back to Markdown, including the meta file, as well as the HTML and meta files used by the in-app help.

### Manual editing

Small modifications can be made directly using a Markdown editor or VS Code, for example. For the User Guide, run `pnpm edit-docs:sync-docs` afterwards: it performs the same import and export as the `edit-docs` app, without opening a window, so that the Markdown is normalized the same way and the in-app help is regenerated.

When making manual modifications, keep in mind:

*   Images are handled as Trilium attachments which are stored in the meta file, so a picture cannot simply be dropped in the directory.
*   The file or directory structure is described by the meta file. A file that is not described in the meta file will cause the import to fail, and a file that is described but missing from the disk as well.
*   The `writing-documentation` skill in `.claude/skills` provides a `docs.mjs` script that handles these cases (creating a page, registering an image, renaming, moving or deleting a page) and audits the documentation for broken links, missing images and inconsistent metadata.

### Reviewing & committing the changes

Since the documentation is tracked with Git, after making the manual or automatic modifications (wait at least 10s after making the modification in the `edit-docs` app) the changes will reflect in Git.

Make sure to analyze each modified file and report possible issues.

Important aspects to consider:

*   The Trilium import/export mechanism is not perfect, so at the next import/export/import cycle some whitespace might get thrown in. It's generally safe to commit the changes as-is.
*   Since we are importing Markdown, editing HTML and then exporting the HTML back to Markdown there might be some edge cases where the formatting is not properly preserved. Try to identify such cases and report them in order to get them fixed (this will benefit also the users).

## Automation

The documentation is built via `apps/build-docs`:

1.  The output directory is cleared.
2.  The User Guide and the Developer Guide are built.
    1.  The documentation from the repo is archived and imported into an in-memory instance.
    2.  The documentation is exported using the shared theme.
3.  The API docs (internal and ETAPI) are statically rendered via Redocly.
4.  The script API is generated via `typedoc`

The `deploy-docs` workflow triggers the documentation build and uploads it to CloudFlare Pages.

## Updating the Script API

As mentioned previously, the Script API is not manually editable since it is auto-generated using TypeDoc.

The Script API is regenerated automatically as part of `pnpm docs:build` — its output goes into the gitignored `site/script-api/{backend,frontend,electron}` directory and is published by the `deploy-docs` workflow, so there is nothing to commit. To preview changes locally, run `pnpm docs:build` and inspect the output under `site/`.

Note that in order to simulate the environment a script would have, some fake source files (in the sense that they are only used for documentation) are being used as entrypoints for the documentation. Look for `backend_script_entrypoint` and `frontend_script_entrypoint` in `apps/build-docs/src`.

## Building locally

In the Git root:

*   Run `pnpm docs:build`. The built documentation will be available in `site` at Git root.
*   To also run a webserver to test it, run `pnpm docs:preview` (this will not build the documentation) and navigate to `localhost:9000`.