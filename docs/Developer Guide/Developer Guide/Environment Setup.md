# Environment Setup
## Node.js

Use the Node.js version pinned in `.nvmrc` at the root of the repository. With [nvm](https://github.com/nvm-sh/nvm), `nvm install` run inside the repository installs and activates it.

## Setting up `pnpm`

Trilium uses the `pnpm` package manager in order to better manage its mono-repo structure. Unlike `npm` which comes by default with Node.js, `pnpm` needs to be installed separately. The expected version is the `packageManager` field of the root `package.json`; a newer release of the same major works too, since `pmOnFail: ignore` in `pnpm-workspace.yaml` tolerates the difference.

Install it with `npm`:

```
npm install -g pnpm
```

pnpm 12 is a native executable that its install script links into place, so the command needs lifecycle scripts allowed (npm's default). Under a version manager such as nvm, a global package belongs to one Node.js version, so run the command again after switching to another one. The [standalone installer](https://pnpm.io/installation) is an alternative that does not depend on the Node.js version.

After that, run `pnpm` in a new terminal to see if it is working.

> [!WARNING]
> `corepack enable` is no longer the recommended way to obtain `pnpm`. Only Corepack 0.34.5 or newer (bundled from Node.js 24.12 on) can start the native pnpm 12, and Node.js 25 no longer ships Corepack at all. An older Corepack fails with `Cannot find module '…/corepack/v1/pnpm/12.x.y/bin/pnpm.cjs'`, and the `~/.cache/node/corepack/v1/pnpm/12.x.y` directory it wrote makes a newer Corepack fail the same way, so delete that directory too.

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