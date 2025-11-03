import { execSync } from "child_process";
import { getElectronPath, isNixOS } from "./utils.mjs";

const LD_LIBRARY_PATH = isNixOS() && execSync("nix eval --raw nixpkgs#gcc.cc.lib").toString("utf-8") + "/lib";

execSync(`${getElectronPath()} ${process.argv[2]} --no-sandbox`, {
    stdio: "inherit",
    env: {
        ...process.env,
        NODE_OPTIONS: "--import tsx",
        NODE_ENV: "development",
        TRILIUM_ENV: "dev",
        TRILIUM_RESOURCE_DIR: "../server/src",
        BETTERSQLITE3_NATIVE_PATH: "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
        LD_LIBRARY_PATH
    }
});
