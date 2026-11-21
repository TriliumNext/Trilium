/**
 * The version the website offers for download. While `main` carries a release candidate, the
 * root `package.json` names a version whose files are only on a prerelease, so the site links
 * to the newest stable `vX.Y.Z` tag instead. `vite.config.ts` resolves it at build time and
 * passes it in as `__RELEASE_VERSION__`.
 */
export function pickReleaseVersion(packageVersion: string, tags: string[]): string {
    if (isStable(packageVersion)) {
        return packageVersion;
    }

    const [ newest ] = tags
        .map((tag) => tag.replace(/^v/, ""))
        .filter((tag, index) => tags[index].startsWith("v") && isStable(tag))
        .sort(compareVersions)
        .reverse();
    if (!newest) {
        throw new Error(`package.json is at the prerelease ${packageVersion} and no stable `
            + "release tag was found; fetch the v* tags before building the website.");
    }
    return newest;
}

function isStable(version: string) {
    return /^\d+\.\d+\.\d+$/.test(version);
}

function compareVersions(a: string, b: string) {
    const [ left, right ] = [ a, b ].map((version) => version.split(".").map(Number));
    return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}
