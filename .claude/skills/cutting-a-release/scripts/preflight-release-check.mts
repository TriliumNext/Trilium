#!/usr/bin/env -S npx tsx
/**
 * @module
 *
 * Pre-flight verifier for a Trilium release — a strict SUPERSET of the CI gate.
 *
 * The CI sanity-check (scripts/check-version-consistency.ts, run from
 * .github/workflows/release.yml:31) validates only 5 of the 9 package.json files
 * that must agree:  root, apps/server, apps/client, apps/desktop, packages/commons.
 * But `pnpm chore:update-version` (scripts/update-version.ts) propagates the root
 * version into 8 files — so apps/standalone, apps/edit-docs, packages/pdfjs-viewer
 * and packages/trilium-core are WRITTEN but NEVER validated. A stale version in any
 * of those four passes CI and ships.
 *
 * This script checks all 9, confirms the release-notes file the publish step
 * hard-requires exists at the exact doubled path, and warns about the rc/beta
 * "latest"/prerelease labeling so it is intentional.
 *
 * Usage (from the repo root):
 *     npx tsx .claude/skills/cutting-a-release/scripts/preflight-release-check.mts v0.103.0
 *     # or omit the arg to use the root package.json version as the source of truth:
 *     npx tsx .claude/skills/cutting-a-release/scripts/preflight-release-check.mts
 *
 * Exit code 0 = ready to tag/push. Non-zero = a hard failure CI would (or wouldn't!) catch.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_PKG_NAME = "@triliumnext/source";

// All 9 files that must agree: root + the 8 that scripts/update-version.ts writes.
const ALL_PACKAGE_JSONS = [
    "package.json",
    "apps/server/package.json",
    "apps/client/package.json",
    "apps/standalone/package.json",
    "apps/desktop/package.json",
    "apps/edit-docs/package.json",
    "packages/commons/package.json",
    "packages/pdfjs-viewer/package.json",
    "packages/trilium-core/package.json"
];

// The subset the CI gate (scripts/check-version-consistency.ts:5-11) actually validates.
const CI_GATE_FILES = new Set([
    "package.json",
    "apps/server/package.json",
    "apps/client/package.json",
    "apps/desktop/package.json",
    "packages/commons/package.json"
]);

function readPackageVersion(packageJsonPath: string): string {
    return JSON.parse(readFileSync(packageJsonPath, "utf-8")).version;
}

function findRepoRoot(start: string): string {
    let dir = start;
    for (;;) {
        const pkg = join(dir, "package.json");
        if (existsSync(pkg)) {
            try {
                if (JSON.parse(readFileSync(pkg, "utf-8")).name === ROOT_PKG_NAME) {
                    return dir;
                }
            } catch {
                // not valid JSON — keep walking up
            }
        }
        const parent = dirname(dir);
        if (parent === dir) {
            return start;
        }
        dir = parent;
    }
}

function main(): void {
    const here = dirname(fileURLToPath(import.meta.url));
    const root = findRepoRoot(process.cwd() === here ? here : process.cwd());

    // Accept "v0.103.0" or "0.103.0"; default to the root version (single source of truth).
    let arg = process.argv[2];
    if (!arg) {
        arg = readPackageVersion(join(root, "package.json"));
        console.log(`No version argument — using root package.json version: ${arg}`);
    }
    const expectedVersion = arg.startsWith("v") ? arg.substring(1) : arg;
    const tag = `v${expectedVersion}`;

    console.log(`\nPre-flight for tag ${tag} (version ${expectedVersion}) in ${root}\n`);

    const failures: string[] = [];

    // 1. All 9 package.json versions must equal the target. Flag the 4 the CI gate ignores.
    for (const file of ALL_PACKAGE_JSONS) {
        const full = join(root, file);
        if (!existsSync(full)) {
            failures.push(`${file} is missing`);
            console.log(`[FAIL] ${file} — file not found`);
            continue;
        }
        const version = readPackageVersion(full);
        const blindSpot = CI_GATE_FILES.has(file) ? "" : "  (CI gate does NOT check this)";
        if (version === expectedVersion) {
            console.log(`[ OK ] ${file} = ${version}${blindSpot}`);
        } else {
            failures.push(`${file}: expected ${expectedVersion}, found ${version}`);
            console.log(`[FAIL] ${file} = ${version}, expected ${expectedVersion}${blindSpot}`);
        }
    }

    // 2. The publish step hard-requires the release-notes file at the DOUBLED path.
    const notesRel = join("docs", "Release Notes", "Release Notes", `${tag}.md`);
    if (existsSync(join(root, notesRel))) {
        console.log(`[ OK ] ${notesRel} exists`);
    } else {
        failures.push(`release-notes file missing: ${notesRel}`);
        console.log(`[FAIL] ${notesRel} — softprops/action-gh-release will ENOENT (release.yml:155)`);
    }

    // 3. rc/beta labeling — release.yml:159-160 substring-matches the ref.
    if (tag.includes("rc")) {
        console.log(`[INFO] tag contains "rc" -> prerelease=true, make_latest=false (intended for a release candidate)`);
    } else if (/beta|alpha|dev|test/i.test(tag)) {
        console.log(`[WARN] tag "${tag}" is pre-release-looking but does NOT contain "rc":`);
        console.log(`       release.yml only special-cases "rc", so this publishes as make_latest=true`);
        console.log(`       and prerelease=false — i.e. marked the LATEST STABLE release. Use an "rc" tag`);
        console.log(`       (e.g. v0.103.0-rc.1) if you do not want that.`);
    } else {
        console.log(`[INFO] tag "${tag}" -> make_latest=true, prerelease=false (published as the latest stable release)`);
    }

    console.log("");
    if (failures.length > 0) {
        console.error(`Pre-flight FAILED with ${failures.length} problem(s):`);
        for (const f of failures) {
            console.error(`  - ${f}`);
        }
        process.exit(1);
    }
    console.log("Pre-flight passed. Safe to commit, tag, and push.");
}

main();
