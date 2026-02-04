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

By default we include a number of suggested extensions which should appear when opening the repository in VS Code. Most of the extensions are for integrating various technologies we are using such as Playwright and Vitest for testing or for <a class="reference-link" href="Concepts/Internationalisation%20%20Translat.md">Internationalisation / Translations</a>.