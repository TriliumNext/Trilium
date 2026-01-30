/**
 * @module
 *
 * This script synchronizes the `package.json` version of the monorepo (root `package.json`)
 * into the apps, so that it is properly displayed.
 */

import { join } from "path";
import { readFileSync, writeFileSync } from "fs";

function patchPackageJson(packageJsonPath: string, version: string) {
    // Read the version from package.json and process it.
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

    // Write the adjusted version back in.
    packageJson.version = version;
    const formattedJson = JSON.stringify(packageJson, null, 2);
    writeFileSync(packageJsonPath, formattedJson);
}

function getVersion(packageJsonPath: string) {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    return packageJson.version;
}

function main() {
    const version = getVersion(join(__dirname, "..", "package.json"));

    for (const appName of ["server", "client", "desktop", "edit-docs"]) {
        patchPackageJson(join(__dirname, "..", "apps", appName, "package.json"), version);
    }

    for (const packageName of ["commons"]) {
        patchPackageJson(join(__dirname, "..", "packages", packageName, "package.json"), version);
    }
}

main();
