/**
 * @module
 *
 * The nightly version works uses the version described in `package.json`, just like any release.
 * The problem with this approach is that production builds have a very aggressive cache, and
 * usually running the nightly with this cached version of the application will mean that the
 * user might run into module not found errors or styling errors caused by an old cache.
 *
 * This script is supposed to be run in the CI, which will update locally the version field of
 * `package.json` to contain the date. For example, `0.90.9-beta` will become `0.90.9-test-YYMMDD-HHMMSS`.
 *
 */

import fs from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

function processVersion(version) {
    // Remove the beta suffix if any.
    version = version.replace("-beta", "");

    // Add the nightly suffix, plus the date.
    const referenceDate = new Date().toISOString().substring(2, 19).replace(/[-:]*/g, "").replace("T", "-");
    version = `${version}-test-${referenceDate}`;

    return version;
}

function patchPackageJson(packageJsonPath) {
    // Read the version from package.json and process it.
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    const currentVersion = packageJson.version;
    const adjustedVersion = processVersion(currentVersion);
    console.log("Current version is", currentVersion);
    console.log("Adjusted version is", adjustedVersion);

    // Write the adjusted version back in.
    packageJson.version = adjustedVersion;
    const formattedJson = JSON.stringify(packageJson, null, 4);
    fs.writeFileSync(packageJsonPath, formattedJson);
}

function main() {
    const scriptDir = dirname(fileURLToPath(import.meta.url));

    const rootPackageJson = join(scriptDir, "..", "package.json");
    patchPackageJson(rootPackageJson);

    for (const app of ["server", "client"]) {
        const appPackageJsonPath = join(scriptDir, "..", "apps", app, "package.json");
        patchPackageJson(appPackageJsonPath);
    }

    for (const packageName of [ "pdfjs-viewer" ]) {
        const packageJsonPath = join(scriptDir, "..", "packages", packageName, "package.json");
        patchPackageJson(packageJsonPath);
    }
}

main();
