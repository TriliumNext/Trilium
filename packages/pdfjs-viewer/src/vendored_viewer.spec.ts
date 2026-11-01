/**
 * Guards the one coupling a `pdfjs-dist` bump silently breaks.
 *
 * Two copies of pdf.js meet at runtime: the viewer application vendored under `viewer/`
 * (extracted from the GitHub release by `scripts/update-viewer.ts`) and the library
 * `scripts/build.ts` copies out of the npm package. pdf.js compares the two at
 * construction — `The API version "x" does not match the Viewer version "y"` — so
 * bumping the dependency without re-running the vendoring script leaves the viewer
 * throwing on every PDF a user opens.
 *
 * The e2e suite would eventually catch it, as a browser-side error some way into a
 * Playwright run. This says the same thing in milliseconds, and names the fix.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveViewerBundle } from "./test/viewer_bundle";

describe("vendored pdf.js viewer", () => {
    it("is built from the same pdf.js release as the pdfjs-dist dependency", () => {
        const bundlePath = resolveViewerBundle();
        const packageRoot = dirname(dirname(bundlePath));
        const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
        const declared = packageJson.devDependencies["pdfjs-dist"];

        // pdf.js embeds the version it compares against; if the declaration is ever
        // renamed the check has stopped meaning anything, so fail rather than skip.
        const match = readFileSync(bundlePath, "utf8").match(/const viewerVersion = "([^"]+)"/);
        expect(match, "viewer.mjs no longer declares `const viewerVersion`").not.toBeNull();

        expect(
            match?.[1],
            `viewer/ was vendored from pdf.js ${match?.[1]} but pdfjs-dist is ${declared}. `
                + "Re-run `pnpm --filter pdfjs-viewer update-viewer` and commit the result."
        ).toBe(declared);
    });
});
