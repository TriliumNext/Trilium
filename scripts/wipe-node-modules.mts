import { existsSync } from "fs";
import { readdir, rm } from "fs/promises";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");

const dirs = [
    path.join(root, "node_modules"),
    ...await workspaceNodeModules("apps"),
    ...await workspaceNodeModules("packages")
].filter((dir) => existsSync(dir));

if (dirs.length === 0) {
    console.log("No node_modules directories found.");
} else {
    for (const dir of dirs) {
        console.log(`Removing ${path.relative(root, dir)}`);
        await rm(dir, { recursive: true, force: true });
    }
    console.log(`Done. Removed ${dirs.length} node_modules director${dirs.length === 1 ? "y" : "ies"}.`);
}

/** Returns the `node_modules` path of every workspace directly under `group` (`apps` or `packages`). */
async function workspaceNodeModules(group: string) {
    const entries = await readdir(path.join(root, group), { withFileTypes: true });
    return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, group, entry.name, "node_modules"));
}
