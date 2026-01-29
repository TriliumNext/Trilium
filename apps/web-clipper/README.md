# Trilium Web Clipper

## Context

The Web Clipper is an extension for the Trilium Notes application, an open-source note-taking application that can be used either in standalone mode via the desktop application or connected to a server.

The source is extracted from the official monorepo, where it can be found under `apps/web-clipper`. The only change made to the provided source code is to have `tsconfig.base.json` in the same directory as the Web Clipper. The submitted source code is a snapshot of the following commit: [https://github.com/TriliumNext/Trilium/commit/1cf93ff0dec89ee1a80654934cb30fad74920043](https://github.com/TriliumNext/Trilium/commit/1cf93ff0dec89ee1a80654934cb30fad74920043) 

There are some warnings regarding the use of `innerHTML` but they come from a third-party library (Readability). We plan to update to a newer version of that library soon, but we would like to publish the extension first (if possible).

## Building from source

To build from the provided sources:

1.  `pnpm i` to install the dependencies.
2.  `pnpm build:firefox` to trigger the Firefox build.
3.  The output will be available in `.output/firefox-mv2`.

> [!NOTE]
> To generate the ZIP instead that can be imported into Firefox, run `pnpm zip;firefox` which will generate `.output\triliumnextweb-clipper-1.0.1-sources.zip`.

## Testing

To test it, a functional Trilium Notes desktop application is required:

1.  Download the latest version of Trilium Notes from [https://triliumnotes.org/](https://triliumnotes.org/) (top-right bottom automatically detects the platform).
2.  During the first setup, create a new database.
3.  Allow the Firewall port if asked.
4.  Install the Web Clipper extension into the browser.
5.  The extension should be able to see the Trilium instance and become active.
6.  Web pages can now be clipped and they will appear in the local Trilium instance.