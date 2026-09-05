import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = fileURLToPath(new URL("../dist/", import.meta.url));
const requiredPaths = [
    "node_modules/better-sqlite3/prebuilds/linux-x64.node",
    "node_modules/better-sqlite3/prebuilds/linux-arm64.node",
    "node_modules/better-sqlite3/prebuilds/linuxmusl-x64.node",
    "node_modules/better-sqlite3/prebuilds/linuxmusl-arm64.node"
];

for (const relativePath of requiredPaths) {
    try {
        await access(join(distDir, relativePath));
    } catch {
        throw new Error(`Missing Docker build artifact: ${relativePath}`);
    }
}

console.log(`Verified ${requiredPaths.length} Docker native artifacts in ${distDir}`);
