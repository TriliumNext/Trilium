# Plugin migration guide
This guide walks through the basic steps to take to integrate a CKEditor 5 plugin for use inside the Trilium monorepo, which allows:

*   Making modifications to the implementation without having to maintain a new repo.
*   Integrating an older plugin based on the legacy installation method so that it works well with the new one.

> [!IMPORTANT]
> This guide assumes that the CKEditor plugin is written in TypeScript. If it isn't, then you will have to port it to TypeScript to match the rest of the monorepo.

## Step 1. Creating the project skeleton

First, we are going to generate a project from scratch so that it picks up the latest template for building CKEditor plugins, whereas the plugin which is being integrated might be based on the legacy method.

Outside the `Notes` repository, we are going to use the CKEditor generator to generate the new project structure for us. We are not doing it directly inside `Notes` repository since it's going to use a different package manager (Yarn/NPM vs `pnpm`) and it also creates its own Git repository.

```
npx ckeditor5-package-generator @triliumnext/ckeditor5-foo --use-npm --lang ts --installation-methods current
```

Of course, replace `foo` with the name of the plugin. Generally it's better to stick with the original name of the plugin which can be determined by looking at the prefix of file names (e.g. `mermaid` from `mermaidui` or `mermaidediting`).

## Step 2. Copy the new project

1.  Go to the newly created `ckeditor5-foo` directory.
2.  Remove `node_modules` since we are going to use `pnpm` to handle it.
3.  Remove `.git` from it.
4.  Copy the folder into the `Notes` repo, as a subdirectory of `packages`.

## Step 3. Updating dependencies

In the newly copied package, go to `package.json` and edit:

1.  In `devDependencies`, change `ckeditor5` from `latest` to the same version as the one described in `packages/ckeditor5/package.json` (fixed version, e.g. `43.2.0`).
2.  In `peerDependencies`, change `ckeditor5` to the same version as from the previous step.
3.  Similarly, update `vitest` dependencies to match the monorepo one.
4.  Remove the `prepare` entry from the `scripts` section.
5.  Change `build:dist` to simply `build`.
6.  In `tsconfig.dist.json`, change `typings/types` to `../typings/types.d.ts` to be compatible with the latest TypeScript version.

## Step 4. Install missing dependencies and build errors

Run `pnpm build-dist` on the `Notes` root, and:

1.  If there is an error about `Invalid module name in augmentation, module '@ckeditor/ckeditor5-core' cannot be found.`, simply replace `@ckeditor/ckeditor5-core` with `ckeditor5`.
2.  Run the build command again and ensure there are no build errors.
3.  Commit the changes.

## Step 5. Using `git subtree` to pull in the original repo

Instead of copying the files from the existing plugin we are actually going to carry over the history for traceability. To do so, we will use a temporary directory inside the repo:

```
git subtree add --prefix=_regroup/<name> https://[...]/repo.git <main_branch>
```

This will bring in all the commits of the upstream repo from the provided branch and rewrite them to be placed under the desired directory.

## Step 6. Integrate the plugin

1.  Start by copying each sub-plugin (except the main one such as `FooEditing` and `FooUI`).
    1.  If they are written in JavaScript, port them to TypeScript.
        1.  Remove any non-TypeScript type documentation.
    2.  If they have non-standard imports to CKEditor, such as `'ckeditor5/src/core.js'`, rewrite them to simply `ckeditor`.
2.  Install any necessary dependencies used by the source code (try going based on compilation errors rather than simply copying over all dependencies from `package.json`).
3.  Keep the existing TypeScript files that were generated automatically and integrate the changes into them.
4.  In `tsconfig.json` of the plugin, set `compilerOptions.composite` to `true`.
5.  Add a workspace dependency to the new plugin in `packages/ckeditor5/package.json`.
6.  In `packages/ckeditor5` look for `plugins.ts` and import the top-level plugin in `EXTERNAL_PLUGINS`.

## Handling CSS

Some plugins have custom CSS whereas some don't.

1.  `import` the CSS in the `index.ts` of the plugin.
2.  When building the plugin, `dist/index.css` will be updated.
3.  In `plugins.ts` from `packages/ckeditor5`, add an import to the CSS.

## Integrating from another monorepo

This is a more complicated use-case if the upstream plugin belongs to a monorepo of another project (similar to how `trilium-ckeditor5` used to be).

1.  Create a fresh Git clone of the upstream monorepo to obtain the plugin from.
2.  Run `git filter-repo --path packages/ckeditor5-foo/` (the trailing slash is very important!).
3.  Run `git subtree add` just like in the previous steps but point to the local Git directory instead (by appending `/.git` to the absolute path of the repository).
4.  Follow same integration steps as normal.