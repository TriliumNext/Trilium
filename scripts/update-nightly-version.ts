/**
 * @module
 *
 * The nightly version works uses the version described in `package.json`, just like any release.
 * The problem with this approach is that production builds have a very aggressive cache, and
 * usually running the nightly with this cached version of the application will mean that the
 * user might run into module not found errors or styling errors caused by an old cache.
 *
 * This script is supposed to be run in the CI, which will update locally the version field of
 * `package.json` to contain the date. For example, `0.90.9-beta` will become `0.90.9-test-YYMMDD-HHMMSS`,
 * and the released `0.90.9` will become `0.90.10-test-YYMMDD-HHMMSS`.
 *
 */

import fs from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

/**
 * Returns the nightly version for the `package.json` version `version`, built at `date`.
 *
 * A pre-release sorts below its release, so a nightly of a released version bumps the patch
 * number first; otherwise winget and the in-app update check offer the release as an upgrade.
 */
export function processVersion(version: string, date: Date) {
    if (version.includes("-test-")) {
        version = version.split("-test-")[0];
    } else if (version.endsWith("-beta")) {
        version = version.replace("-beta", "");
    } else if (/^\d+\.\d+\.\d+$/.test(version)) {
        const [ major, minor, patch ] = version.split(".");
        version = `${major}.${minor}.${Number(patch) + 1}`;
    }

    // Add the nightly suffix, plus the date.
    const referenceDate = date.toISOString().substring(2, 19).replace(/[-:]*/g, "").replace("T", "-");
    return `${version}-test-${referenceDate}`;
}

function patchPackageJson(packageJsonPath: string, date: Date) {
    // Read the version from package.json and process it.
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    const currentVersion = packageJson.version;
    const adjustedVersion = processVersion(currentVersion, date);
    console.log("Current version is", currentVersion);
    console.log("Adjusted version is", adjustedVersion);

    // Write the adjusted version back in.
    packageJson.version = adjustedVersion;
    const formattedJson = JSON.stringify(packageJson, null, 4);
    fs.writeFileSync(packageJsonPath, formattedJson);
}

function main() {
    const scriptDir = dirname(SCRIPT_PATH);
    const date = new Date();

    const rootPackageJson = join(scriptDir, "..", "package.json");
    patchPackageJson(rootPackageJson, date);

    for (const app of ["server", "client", "standalone", "desktop"]) {
        const appPackageJsonPath = join(scriptDir, "..", "apps", app, "package.json");
        patchPackageJson(appPackageJsonPath, date);
    }

    for (const packageName of [ "pdfjs-viewer" ]) {
        const packageJsonPath = join(scriptDir, "..", "packages", packageName, "package.json");
        patchPackageJson(packageJsonPath, date);
    }
}

if (process.argv[1] === SCRIPT_PATH) {
    main();
}
