# bettersqlite binaries
### The native node bindings

`better-sqlite3` has native Node bindings. With updates of `better-sqlite3`, but also of Electron and Node.js versions, these bindings need to be updated.

Note that Electron and Node.js versions need different versions of these bindings, since Electron usually packs a different version of Node.js.

During development, `pnpm install` tries to build or reuse prebuilt natives for the current Node.js version. This makes `npm run start-server` work out of the box. Trying to run `npm run start-electron` with these versions generally causes an error such as this:

```
Uncaught Exception:
Error: The module '/Users/elian/Projects/Notes/node_modules/better-sqlite3/build/Release/better_sqlite3.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 108. This version of Node.js requires
NODE_MODULE_VERSION 116. Please try re-compiling or re-installing
the module (for instance, using `npm rebuild` or `npm install`).
```

### How the natives are handled

To avoid issues between the `server` and the `desktop`, the `desktop` build gets its own copy of the `bettersqlite3` dependency in its `node_module`. This copy is then rebuilt automatically to match the Electron version.

This process of rebuilding is handled by `scripts/electron-rebuild.mts` which runs automatically after `pnpm install` (via `postinstall`).

If needed, the script can be run manually again via `pnpm postinstall`.