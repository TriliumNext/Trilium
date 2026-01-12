# Documentation
There are multiple types of documentation for Trilium:<img class="image-style-align-right" src="api/images/ywZE36YO8YGQ/Documentation_image.png" width="205" height="162">

*   The _User Guide_ represents the user-facing documentation. This documentation can be browsed by users directly from within Trilium, by pressing <kbd>F1</kbd>.
*   The _Developer's Guide_ represents a set of Markdown documents that present the internals of Trilium, for developers.
*   _Release Notes_, this contains the change log for each released or soon-to-be-released version. The release notes are used automatically by the CI when releasing a version.
*   The _Script API_, which is an automatically generated documentation for the front-end and back-end APIs for scripts.

## Location of the documentation

All documentation is stored in the [Trilium](https://github.com/TriliumNext/Trilium) repository:

*   `docs/Developer Guide` contains Markdown documentation that can be modified either externally (using a Markdown editor, or internally using Trilium).
*   `docs/Release Notes` is also stored in Markdown format and can be freely edited.
*   `docs/Script API` contains auto-generated files and thus must not be modified.
*   `docs/User Guide` contains also Markdown-only documentation but must generally not be edited externally.
    *   The reason is that the `pnpm edit-docs:edit-docs` feature will not only import/export this documentation, but also generate the corresponding HTML documentation and meta structure in `src/public/app/doc_notes/en/User Guide`.
    *   It's theoretically possible to edit the Markdown files externally and then run `docs:edit` and trigger a change in order to build the documentation, but that would not be a very productive workflow.

## Editing the documentation

There are two ways to modify documentation:

*   Using a special mode of Trilium.
*   By manually editing the files.

### Using the `edit-docs` app

To edit the documentation using Trilium, set up a working development environment via <a class="reference-link" href="Environment%20Setup.md">Environment Setup</a> and run the following command: `pnpm edit-docs:edit-docs`.

How it works:

*   At startup, the documentation from `docs/` is imported from Markdown into a in-memory session (the initialization of the database is already handled by the application).
*   Each modification will trigger after 10s an export from the in-memory Trilium session back to Markdown, including the meta file.

### Manual editing

Apart from the User Guide, it's generally feasible to make small modifications directly using a Markdown editor or VS Code, for example.

When making manual modifications, avoid:

*   Uploading pictures, since images are handled as Trilium attachments which are stored in the meta file.
*   Changing the file or directory structure in any way, since that is also handled by the meta file. A missing file will most certainly cause a crash at start-up when attempting to edit the docs using Trilium.

### Reviewing & committing the changes

Since the documentation is tracked with Git, after making the manual or automatic modifications (wait at least 10s after making the modification) the changes will reflect in Git.

Make sure to analyze each modified file and report possible issues.

Important aspects to consider:

*   The Trilium import/export mechanism is not perfect, so if you make some modifications to the documentation using `docs:edit`, at the next import/export/import cycle some whitespace might get thrown in. It's generally safe to commit the changes as-is.
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

To update the API documentation, simply run `pnpm docs:build`. Compare the changes (if any) and commit them.

Note that in order to simulate the environment a script would have, some fake source files (in the sense that they are only used for documentation) are being used as entrypoints for the documentation. Look for `backend_script_entrypoint` and `frontend_script_entrypoint` in `apps/build-docs/src`.

## Building locally

In the Git root:

*   Run `pnpm docs:build`. The built documentation will be available in `site` at Git root.
*   To also run a webserver to test it, run `pnpm docs:preview` (this will not build the documentation) and navigate to `localhost:9000`.