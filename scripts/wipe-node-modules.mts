import { rm } from "fs/promises";
import { glob } from "glob";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");

const dirs = await glob([
    "node_modules",
    "apps/*/node_modules",
    "packages/*/node_modules"
], {
    cwd: root,
    absolute: true
});

if (dirs.length === 0) {
    console.log("No node_modules directories found.");
} else {
    for (const dir of dirs) {
        console.log(`Removing ${path.relative(root, dir)}`);
        await rm(dir, { recursive: true, force: true });
    }
    console.log(`Done. Removed ${dirs.length} node_modules director${dirs.length === 1 ? "y" : "ies"}.`);
}
