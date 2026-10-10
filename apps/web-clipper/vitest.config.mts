import { join } from "path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
    plugins: [ manifestVersionGlobal(), WxtVitest() ],
    test: {
        environment: "happy-dom",
        include: [ "**/*.{test,spec}.{ts,tsx}" ],
        exclude: [ "**/node_modules/**", ".output/**", ".wxt/**" ],
        reporters: [
            "default",
            [ "junit", {
                outputFile: join(import.meta.dirname, "test-output/vitest/junit.xml"),
                addFileAttribute: true
            } ]
        ],
        coverage: {
            reportsDirectory: join(import.meta.dirname, "test-output/vitest/coverage"),
            provider: "v8" as const,
            include: [ "entrypoints/**/*.{ts,tsx}", "utils.ts" ],
            exclude: [ "**/*.{test,spec}.{ts,tsx}", "**/*.d.ts" ],
            // Repo-root-relative `SF:` paths, so Codecov does not match a bare `utils.ts` or
            // `entrypoints/…/index.ts` to another project of the monorepo.
            reporter: [ "text", [ "lcov", { projectRoot: join(import.meta.dirname, "../..") } ] ],
            thresholds: {
                lines: 100,
                statements: 100,
                functions: 100,
                branches: 100
            }
        }
    }
});

/**
 * Vitest stores `import.meta.env` values as strings, so WXT's numeric `MANIFEST_VERSION` arrives
 * as `"3"` and `=== 3` never matches. Reading it from `globalThis.__MANIFEST_VERSION__` keeps
 * the number and lets a spec switch between Manifest V2 and V3.
 */
function manifestVersionGlobal(): Plugin {
    const MANIFEST_VERSION = "import.meta.env.MANIFEST_VERSION";
    return {
        name: "manifest-version-global",
        enforce: "pre",
        transform(code, id) {
            if (id.includes("node_modules") || !code.includes(MANIFEST_VERSION)) return;
            return code.replaceAll(MANIFEST_VERSION, "(globalThis.__MANIFEST_VERSION__ ?? 3)");
        }
    };
}
