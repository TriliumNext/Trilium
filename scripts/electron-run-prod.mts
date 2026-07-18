import { execSync } from "child_process";

import { getElectronPath, getNixLdLibraryPath, isNixOS } from "./utils.mjs";

// Launches the built Electron app (apps/desktop/dist) for `start-prod`.
//
// This mirrors the NixOS handling in electron-start.mts so production launches
// work on NixOS too, where the npm prebuilt Electron binary can't find FHS
// system libraries (libcups.so.2, libgtk-3, libnss3, ...). On every other
// platform this is a no-op wrapper that simply runs `electron <args>`, so
// behaviour is unchanged there.
//
// Unlike the dev launcher, this expects a fully-built bundle: no preload
// compilation, no tsx runtime, and the caller (package.json) supplies the
// TRILIUM_* / ELECTRON_IS_DEV env vars via cross-env.

const args = process.argv.slice(2);
const electronPath = getElectronPath();

const env = { ...process.env };
let extraArgs = "";

if (isNixOS()) {
    env.LD_LIBRARY_PATH = getNixLdLibraryPath();
    // The Nix Electron's chrome-sandbox helper isn't setuid-root, so the
    // sandbox fails to start; disable it (matches the dev launcher).
    extraArgs = " --no-sandbox";
}

execSync(`${electronPath} ${args.join(" ")}${extraArgs}`, {
    stdio: "inherit",
    env
});
