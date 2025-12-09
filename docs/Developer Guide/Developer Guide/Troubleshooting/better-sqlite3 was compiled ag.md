# better-sqlite3 was compiled against a different Node.js version
This generally can happen when running the development version of either the `desktop` or `server`, but it should not happen as often as it used to. The reason is that `better-sqlite3` is a native dependency and has different builds for either the system's Node.js (as used by the `server`), or Electron's one (as used by the `desktop`).

To solve this, go to `apps/server` and run `pnpm rebuild`. For Electron (`desktop`) this step generally not necessary, however `pnpm postinstall` should solve it.

If you can reproduce this issue consistently, please open a bug report.