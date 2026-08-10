import { execSync } from "child_process";
import { buildSync } from "esbuild";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getElectronPath, getNixLdLibraryPath, isNixOS } from "./utils.mjs";

// Compile the preload script to CJS so Electron's sandboxed renderer can load it.
// Always build from apps/desktop/ regardless of CWD — window.ts resolves the
// compiled preload there for every Electron-based app (desktop, edit-docs, ...).
const DESKTOP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "apps", "desktop");
buildSync({
    entryPoints: [join(DESKTOP_DIR, "src", "preload.ts")],
    outfile: join(DESKTOP_DIR, "src", "preload.compiled.cjs"),
    platform: "node",
    format: "cjs",
    bundle: true,
    external: ["electron"]
});

const LD_LIBRARY_PATH = isNixOS() && getNixLdLibraryPath();

const args = process.argv.slice(2);
execSync(`${getElectronPath()} ${args.join(" ")} --no-sandbox`, {
    stdio: "inherit",
    env: {
        ...process.env,
        NODE_OPTIONS: "--import tsx",
        NODE_ENV: "development",
        TRILIUM_ENV: "dev",
        TRILIUM_RESOURCE_DIR: "../server/src",
        // No BETTERSQLITE3_NATIVE_PATH: since better-sqlite3 v13 the addon is
        // N-API based and ships prebuilt binaries for every supported
        // platform/arch, which load unchanged under Electron. Its own resolver
        // picks prebuilds/<platform>-<arch>.node, so there is no Electron-
        // specific build in build/Release/ to point at any more.
        LD_LIBRARY_PATH
    }
});
