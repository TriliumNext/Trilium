import { join, resolve } from "path";
import { cpSync, exists, existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { execSync } from "child_process";
import { rebuild } from "@electron/rebuild"
import { getElectronPath, isNixOS } from "./utils.mjs";

const workspaceRoot = join(import.meta.dirname, "..");

function copyNativeDependencies(projectRoot: string) {
    const destPath = join(projectRoot, "node_modules/better-sqlite3");
    
    if (existsSync(destPath)) {
        rmSync(destPath, { recursive: true });
    }
    mkdirSync(destPath, { recursive: true });

    const sourcePath = join(workspaceRoot, "node_modules/better-sqlite3");
    if (!existsSync(sourcePath)) {
        console.warn("Nothing to rebuild as source path is missing:", sourcePath);
        console.info("For CI builds with filtered package installs, this is normal. For normal development, it's not.");
        process.exit(0);
    }
    cpSync(sourcePath, destPath, { recursive: true, dereference: true });
}

async function rebuildNativeDependencies(projectRoot: string) {
    const electronVersion = determineElectronVersion(projectRoot);

    if (!electronVersion) {
        console.error("Unable to determine Electron version.");
        process.exit(1);
    }

    const targetArch = process.env.TARGET_ARCH || process.arch;
    console.log(`Rebuilding ${projectRoot} with ${electronVersion} for ${targetArch}...`);

    const resolvedPath = resolve(projectRoot);
    await rebuild({
        projectRootPath: resolvedPath,
        buildPath: resolvedPath,
        electronVersion,
        arch: targetArch,
        force: true
    });
}

function determineElectronVersion(projectRoot: string) {
    const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf-8"));

    if (isNixOS()) {
        console.log("Detected NixOS, reading Electron version from PATH");

        try {
            return execSync(`${getElectronPath()} --version`, { }).toString("utf-8");
        } catch (e) {
            console.error("Got error while trying to read the Electron version from shell. Make sure that an Electron version is in the PATH (e.g. `nix-shell -p electron`)");
            process.exit(1);
        }
    } else {
        console.log("Using Electron version from package.json");
        return packageJson.devDependencies.electron;
    }
}

for (const projectRoot of [ "apps/desktop", "apps/edit-docs" ]) {
    copyNativeDependencies(projectRoot);
    await rebuildNativeDependencies(projectRoot);
}
