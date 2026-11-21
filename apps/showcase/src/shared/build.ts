import path from "path";
import type { Browser } from "playwright";

const appDir = path.resolve(import.meta.dirname, "..", "..");

export const repoRoot = path.resolve(appDir, "..", "..");
export const templatesDir = path.join(appDir, "templates");
export const outDir = path.join(appDir, "out");

export interface BuildOptions {
    targets: string[];
    devices: string[];
    /** The IDs of the scenes to capture, or all of them. */
    only?: string[];
    /** A running server to capture instead of a demo server the build boots. */
    url?: string;
    port: number;
}

export type Builder = (browser: Browser, options: BuildOptions) => Promise<void> | void;

/** One rule of a store's guidelines, checked against an asset. */
export interface Check {
    asset: string;
    rule: string;
    actual: string;
    ok: boolean;
}

/** Collects checks into a list, with `actual` turned into text. */
export function checkList() {
    const checks: Check[] = [];
    const check = (asset: string, rule: string, actual: unknown, ok: unknown) => {
        checks.push({ asset, rule, actual: String(actual), ok: Boolean(ok) });
    };
    return { checks, check };
}

/** Prints each failed check and sets a failing exit code when there is one. */
export function reportChecks(checks: Check[]) {
    const failed = checks.filter((check) => !check.ok);
    for (const check of failed) {
        console.error(`  Fails: ${check.asset}: ${check.rule} (${check.actual})`);
    }
    console.log(`  ${checks.length - failed.length} of ${checks.length} checks pass.`);
    if (failed.length) {
        process.exitCode = 1;
    }
}

/** The file name of the scene at `index`, numbered in listing order. */
export function sceneFileName(index: number, sceneId: string) {
    return `${String(index + 1).padStart(2, "0")}-${sceneId}.png`;
}
