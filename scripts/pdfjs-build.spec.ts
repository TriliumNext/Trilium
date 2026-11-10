import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const viewerDir = join(rootDir, "packages/pdfjs-viewer");
const require = createRequire(join(viewerDir, "package.json"));
const pdfjsDir = dirname(require.resolve("pdfjs-dist/package.json"));

beforeAll(() => {
    execFileSync(process.execPath, [ "--import", "tsx", join(viewerDir, "scripts/build.ts") ], {
        cwd: rootDir,
        stdio: "pipe"
    });
}, 30000);

describe("PDF.js build assets", () => {
    it.each([
        [ "cmaps", "Adobe-GB1-UCS2.bcmap" ],
        [ "standard_fonts", "LiberationSans-Regular.ttf" ]
    ])("packages %s at the viewer's configured resource path", (directory, resource) => {
        const source = join(pdfjsDir, directory);
        const output = join(viewerDir, "dist/web", directory);
        expect(readdirSync(output).sort()).toEqual(readdirSync(source).sort());
        expect(readFileSync(join(output, resource))).toEqual(readFileSync(join(source, resource)));
    });
});
