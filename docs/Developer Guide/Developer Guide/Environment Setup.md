# Environment Setup
## Setting up `pnpm`

Trilium uses the `pnpm` package manager in order to better manage its mono-repo structure. Unlike `npm` which comes by default with Node.js, `pnpm` needs to be manually activated.

For most systems this can be achieved via `corepack`:

```
corepack enable
```

After that, run `pnpm` in a new terminal to see if it is working. On Windows, if you get:

```
pnpm : The term 'pnpm' is not recognized as the name of a cmdlet, function, script file, or operable program. Check the spelling of the name, or if a path was included, verify that the path is correct and try again.
```

The solution is to run `corepack enable` in a Terminal with administrative rights.

As a quick heads-up of some differences when compared to `npm`:

*   Generally instead of `npm run` we have `pnpm run` instead.
*   Instead of `npx` we have `pnpm exec`.

## Installing dependencies

Run `pnpm i` at the top of the `Trilium` repository to install the dependencies.

> [!NOTE]
> Dependencies are kept up to date periodically in the project. Generally it's a good rule to do `pnpm i` after each `git pull` on the main branch.

## IDE

Our recommended IDE for working on Trilium is Visual Studio Code (or VSCodium if you are looking for a fully open-source alternative).

By default we include a number of suggested extensions which should appear when opening the repository in VS Code. Most of the extensions are for integrating various technologies we are using such as Playwright and Vitest for testing or for <a class="reference-link" href="Concepts/Internationalisation%20%20Translations.md">Internationalisation / Translations</a>.

## TypeScript

The root `package.json` declares **both** `typescript` (6.x) and `@typescript/native` (an alias of `typescript@7`). This is deliberate — do not "deduplicate" them by bumping `typescript` to 7:

*   **`typescript` 6.x is the library.** TypeScript 7 is the native Go port and its package no longer exports the JS compiler API (`exports["."]` is just a version stub). Everything that does `require("typescript")` needs 6.x: TypeDoc, typescript-eslint, and — the one that also ships to users — `packages/codemirror`, which runs the real language service in the browser for script-note IntelliSense.
*   **`@typescript/native` is the compiler binary**, used only by `scripts/filter-tsc-output.mts` behind `pnpm typecheck`. It builds the whole project graph in roughly a seventh of the time 6.x takes.
*   pnpm gives `node_modules/.bin/tsc` to the alias, so a bare `tsc` on the command line is **7**, not the 6.x that tooling loads. That is also what keeps `.tsbuildinfo` in one format — the two majors cannot read each other's, and mixing them forces a full rebuild every time.

**Do not switch to `@typescript/typescript6`.** Microsoft's documented side-by-side layout aliases `typescript` to that compatibility shim so the native compiler can own the `tsc` bin name. It does not fit here, for two reasons that only show up at build time:

*   The shim ships five files and **no `lib.*.d.ts`**, so the 96 `typescript/lib/lib.*.d.ts?raw` imports in `packages/codemirror/src/type_completion/ts_lib_files.ts` fail to resolve and the client build dies.
*   Working around that by keeping a real `typescript` under `packages/codemirror` splits resolution: `@typescript/vfs` and `@valtown/codemirror-ts` are hoisted to the root and follow the shim, while codemirror's own source follows its nested copy. Two physical paths means the 3.3 MB compiler is bundled **twice** into the lazy script-note chunk (measured: client `dist` 69 M → 72 M).

The official layout assumes the only consumer of the `typescript` name is tooling. This repo also bundles it into a browser app, so the plain package has to stay.