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
*   Some User Guide pages are generated from source files instead of being written by hand, among them the frontend and backend _Script API_ references; see [Generated pages](#generated-pages) below.
*   `docs/User Guide` contains Markdown documentation as well, together with a `!!!meta.json` file that describes the note tree (note IDs, share aliases, icons, attachments).
    *   From it, `apps/server/src/assets/help/help_meta.json` (the note tree of the in-app help) and `apps/server/src/assets/help/help_content.json` (the HTML of each page) are generated. These generated files must never be edited by hand.
    *   The in-app help is not stored in the database: at startup, Trilium builds the `_help` subtree from these two files as read-only virtual notes, which are never persisted or synchronized.
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
*   Each modification will trigger after 10s an export from the in-memory Trilium session back to Markdown, including the meta file, as well as the two files used by the in-app help.

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

The `deploy-docs` workflow triggers the documentation build and uploads it to CloudFlare Pages.

## Generated pages

The REST API references (ETAPI and the internal API), the Electron API reference and the frontend and backend script API references are User Guide pages whose Markdown is generated from their sources, so they appear both in the in-app help and on the website. `edit-docs-config.yaml` lists them for each documentation tree:

*   `openApiPages` renders an OpenAPI document (`apps/server/src/assets/etapi.openapi.yaml`, `apps/server/internal.openapi.yaml`), through `apps/edit-docs/src/openapi_markdown.ts`.
*   `typeDocPages` renders the exports of a TypeScript module, as TypeDoc reads them, through `apps/edit-docs/src/typedoc_markdown.ts`. The Electron API page documents `packages/commons/src/lib/electron_api_interface.ts`, starting from `ElectronApi`; its introduction is the module's `@packageDocumentation` comment. The Frontend API and Backend API pages document `packages/commons/src/lib/script_api.ts`, the curated types that script notes' autocomplete also uses, starting from `FrontendApi` and `BackendApi`. A page with a `root` shows only what the root reaches, so one module can hold the types of several pages. `stripPrefixes` leaves a naming prefix out of the names the page shows, so `ScriptBNote` reads `BNote` and `ElectronWindowApi` reads `WindowApi`; references, signatures and code spans that name a type follow, and two types that would end up with one name stop the sync. A page with a `skillReference` also writes what it shows as compact TypeScript (every member on one line, under the first sentence of its description, deprecated members left out) to that file. The Frontend API and Backend API pages write `frontend_scripting_api.md` and `backend_scripting_api.md` under `packages/trilium-core/src/assets/llm/skills/`, which `load_skill` appends to the hand-written scripting sheets so the AI has every member's exact signature. A spec in `skills.spec.ts` fails when a reference lists other members than `script_api.ts` declares.

Both `pnpm edit-docs:sync-docs` and `pnpm edit-docs:edit-docs` regenerate these pages before importing the documentation, so any edit made to them directly is overwritten. To change one, edit its source (the OpenAPI document, or the comments of the TypeScript module), then run `pnpm edit-docs:sync-docs` and commit the regenerated page along with the help files.

## Building locally

In the Git root:

*   Run `pnpm docs:build`. The built documentation will be available in `site` at Git root.
*   To also run a webserver to test it, run `pnpm docs:preview` (this will not build the documentation) and navigate to `localhost:9000`.