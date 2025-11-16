# Arhitecture Decision Records
## 🚀 Future milestones

*   [Mobile](https://github.com/TriliumNext/Trilium/issues/7447)
*   [Multi-user](https://github.com/TriliumNext/Trilium/issues/4956)

## Aug 2025 - present: Port the client to React

- [x] [Type widgets](https://github.com/TriliumNext/Trilium/pull/7044)
- [x] [Collections](https://github.com/TriliumNext/Trilium/pull/6837)
- [x] [Various widgets](https://github.com/TriliumNext/Trilium/pull/6830)
- [x] [Floating buttons](https://github.com/TriliumNext/Trilium/pull/6811)
- [x] [Settings](https://github.com/TriliumNext/Trilium/pull/6660)

## Aug 2025 - Move away from NX

We took the decision of moving away from the NX monorepo tool, due to:

*   Various issues with the cache, especially after an update of the NX dependencies which required periodical `nx reset` to get rid of.
*   Various issues with memory and CPU consumption along the way, due to the NX daemon (including it remaining as a background process after closing the IDE).
*   On Windows, almost always there was a freeze on every second build.
*   Various hacks that were needed to achieve what we needed (especially for artifacts since NX would not copy assets if they were in `.gitignore` for some arbitrary reason and requiring a patch that made it difficult to maintain across updates).

As a result, we decided to switch to… nothing. Why?

*   `pnpm` (which we were already using) covers the basic needs of a monorepo via workspaces on its own.
*   Our client-side solution, Vite already supports navigating through projects without requiring built artifacts. This makes the build process slightly faster (especially cold starts) at a slighter bigger RAM consumption.
*   ESBuild, on the server-side, also seems happy to go across projects without an issue.

Apart from this:

*   In dev mode, the server now runs directly using `tsx` and not built and then run. This means that it'll run much faster.
*   We're back to an architecture where the `server` and the `desktop` host their own Vite instance as a middleware. What this means that there is no `client:dev` and no separate port to handle.
    *   This makes it possible to easily test on mobile in dev mode, since there's a single port to access.
    *   The downside is that the initial start up time is longer while Vite is spinning up. Nevertheless, it's still slightly faster than it used to be anyway.
*   No more asset copying, which should also improve performance.
*   No more messing around with the native dependency of `better-sqlite3` that caused those dreaded mismatches when running between server and desktop. We have (hopefully) found a permanent solution for it that involves no user input.
*   A decent solution was put in place to allow easier development on NixOS for the desktop application.
*   The desktop version has also gained back the ability to automatically refresh the client when a change is made, including live changes for React components.

Migration steps, as a developer:

1.  In VS Code, uninstall the NX Console unless you plan to use it for other projects.
2.  Remove `.nx` at project level.
3.  It's ideal to clean up all your `node_modules` in the project (do note that it's not just the top-level one, but also in `apps/client`, `apps/server`, `apps/desktop`, etc.).
4.  Run a `pnpm i` to set up the new dependencies and the installation
5.  Instead of `nx run server:serve`, now you can simply run `pnpm dev` while in `apps/server`, or `pnpm server:start` while in the root.
6.  When first starting the server, it will take slightly longer than usual to see something on the screen since the dependencies are being rebuilt. Those are later cached so subsequent runs should work better. If you end up with a white screen, simply refresh the page a few times until it shows up correctly.

## Apr 2025: NX-based monorepo

*   Goal: Restructure the application from a mix where the client was a subfolder within the server and other dependencies such as <a class="reference-link" href="../Dependencies/CKEditor.md">CKEditor</a> were scattered in various repositories to a monorepo powered by NX.
*   [Initial discussion](https://github.com/TriliumNext/Trilium/issues/4941)
*   [Relevant PR](https://github.com/TriliumNext/Notes/pull/1773)

## Dec 2024: Front-end conversion to TypeScript

*   [Relevant PRs on GitHub](https://github.com/TriliumNext/Notes/pulls?q=is%3Apr+is%3Aclosed+%22Port+frontend+to+TypeScript%22)

## Apr 2024: Back-end conversion to TypeScript

*   [Relevant PRs on GitHub](https://github.com/TriliumNext/Notes/pulls?q=is%3Apr+%22convert+backend+to+typescript%22)