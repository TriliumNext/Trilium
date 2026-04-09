import { join, resolve } from "path";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { execSync } from "child_process";
import { rebuild } from "@electron/rebuild"
import { isNixOS } from "./utils.mjs";

const workspaceRoot = join(import.meta.dirname, "..");

// On NixOS, re-execute this script inside `nix develop` to get access to Python and other build tools.
// Skip this if we're already inside a nix shell or a nix build (NIX_BUILD_TOP is set during `nix build`).
if (isNixOS() && !process.env.IN_NIX_SHELL && !process.env.NIX_BUILD_TOP) {
    console.log("Detected NixOS, re-running electron-rebuild inside 'nix develop'...");
    try {
        execSync("nix develop -c pnpm exec tsx scripts/electron-rebuild.mts", {
            cwd: workspaceRoot,
            stdio: "inherit",
            env: { ...process.env, IN_NIX_SHELL: "1" }
        });
        process.exit(0);
    } catch (e) {
        console.error("Failed to run electron-rebuild inside 'nix develop'.");
        process.exit(1);
    }
}

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
    console.log("Using Electron version from package.json");
    return packageJson.devDependencies.electron;
}

for (const projectRoot of [ "apps/desktop", "apps/edit-docs" ]) {
    copyNativeDependencies(projectRoot);
    await rebuildNativeDependencies(projectRoot);
}
