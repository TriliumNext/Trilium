/**
 * Locates the vendored pdf.js viewer bundle (`viewer/viewer.mjs`) on disk.
 *
 * Tests that need the bundle read it as *text* rather than importing it: it is a
 * self-executing application bundle, not a module with exports. happy-dom rewrites
 * `import.meta.url` to an http:// origin, so the path is resolved from the working
 * directory instead — walking up so the suite runs the same from the package
 * directory and from the monorepo root.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function resolveViewerBundle(): string {
    const relative = join("viewer", "viewer.mjs");
    let dir = process.cwd();
    for (;;) {
        const candidates = [ join(dir, relative), join(dir, "packages", "pdfjs-viewer", relative) ];
        for (const candidate of candidates) {
            if (existsSync(candidate)) {
                return candidate;
            }
        }
        const parent = dirname(dir);
        if (parent === dir) {
            throw new Error("Could not locate the pdf.js viewer bundle (viewer/viewer.mjs)");
        }
        dir = parent;
    }
}
