/**
 * @module
 *
 * Prints the Android `versionCode` of the root `package.json` version, which the stable mobile
 * build passes to Gradle as `TRILIUM_ANDROID_VERSION_CODE`. Google Play rejects an upload whose
 * code is not above the previous one, so the code orders versions the way semver does.
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

/** Google Play's upper bound for `versionCode`. */
const MAX_VERSION_CODE = 2_100_000_000;

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-(beta|rc)\.?(\d+)?)?$/;

/**
 * Returns the `versionCode` of `version`, laid out as `MMmmmpppss`: major, minor (up to 999),
 * patch (up to 999), then a two-digit stage. A release gets stage 99, a release candidate
 * 50 + its number and a beta 10 + its number, so each pre-release sorts below its release.
 */
export function androidVersionCode(version: string) {
    const match = VERSION_PATTERN.exec(version);
    if (!match) {
        throw new Error(`Version ${version} has no Android version code; expected X.Y.Z, X.Y.Z-betaN or X.Y.Z-rcN.`);
    }

    const [ , major, minor, patch, preRelease, preReleaseNumber ] = match;
    const number = Number(preReleaseNumber ?? 0);
    const stage = !preRelease ? 99 : preRelease === "rc" ? 50 + number : 10 + number;
    const stageCeiling = !preRelease ? 100 : preRelease === "beta" ? 50 : 99;
    if (Number(minor) > 999 || Number(patch) > 999 || stage >= stageCeiling) {
        throw new Error(`Version ${version} does not fit the Android version code layout.`);
    }

    const code = ((Number(major) * 1000 + Number(minor)) * 1000 + Number(patch)) * 100 + stage;
    if (code >= MAX_VERSION_CODE) {
        throw new Error(`Version ${version} gives version code ${code}, above Google Play's maximum.`);
    }
    return code;
}

if (process.argv[1] === SCRIPT_PATH) {
    const packageJsonPath = join(dirname(SCRIPT_PATH), "..", "package.json");
    const { version } = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version: string };
    try {
        console.log(androidVersionCode(version));
    } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    }
}
