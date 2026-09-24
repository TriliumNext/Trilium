/**
 * Stamps the build date and commit hash into the module behind the About dialog.
 * CI runs it before every packaged build, through `chore:update-build-info`.
 *
 * Pass `--from-commit` to take the date from the commit instead of the clock, so
 * that two builds of the same source stamp the same date. The Flathub build, which
 * builds a published tag inside a sandbox, uses it.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const OUTPUT_PATH = "packages/trilium-core/src/services/build.ts";
const COMMIT_DATE_FLAG = "--from-commit";

export function main(argv: string[]) {
    const date = usesCommitDate(argv)
        ? new Date(Number(git("log", "-1", "--format=%ct")) * 1000)
        : new Date();
    const buildDate = formatBuildDate(date);
    const buildRevision = git("log", "-1", "--format=%H");

    writeFileSync(OUTPUT_PATH, renderBuildInfo(buildDate, buildRevision));
    console.log(`Stamped ${buildDate} @ ${buildRevision}`);
}

export function usesCommitDate(argv: string[]): boolean {
    return argv.includes(COMMIT_DATE_FLAG);
}

/** Whole seconds, since the About dialog shows no finer resolution. */
export function formatBuildDate(date: Date): string {
    const wholeSeconds = new Date(date);
    wholeSeconds.setMilliseconds(0);
    return wholeSeconds.toISOString().replace(".000", "");
}

export function renderBuildInfo(buildDate: string, buildRevision: string): string {
    return `export default {
    buildDate: "${buildDate}",
    buildRevision: "${buildRevision}"
};
`;
}

function git(...args: string[]): string {
    return execFileSync("git", args).toString().trim();
}

// Only when run as a script — the helpers above are imported by the spec.
if (process.argv[1] === import.meta.filename) {
    main(process.argv.slice(2));
}
