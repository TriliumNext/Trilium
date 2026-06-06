/// <reference types='vitest' />
import { defineConfig } from "vite";

export default defineConfig(() => ({
    root: __dirname,
    cacheDir: "../../node_modules/.vite/apps/desktop",
    test: {
        watch: false,
        globals: true,
        setupFiles: ["./spec/setup.ts"],
        environment: "node",
        env: {
            // Server initialization touches RESOURCE_DIR / utils.isDev at
            // module-load time; setting these here (not inside spec/setup.ts)
            // ensures they're in place before static imports resolve.
            NODE_ENV: "development",
            TRILIUM_INTEGRATION_TEST: "memory",
            TRILIUM_ENV: "dev",
            // Specs `vi.mock("electron", ...)`, but vitest still *evaluates* the
            // real electron module when code does a dynamic `await import("electron")`
            // (window.ts / main.ts). On CI the electron binary isn't installed, so
            // electron's index.js throws "Electron failed to install correctly".
            // This override makes index.js return a path instead of throwing; the
            // mock value is still what the code receives, so the value is never used.
            ELECTRON_OVERRIDE_DIST_PATH: "/nonexistent/electron-dist-test-override"
        },
        include: ["src/**/*.spec.ts"],
        reporters: [
            "verbose",
            ["junit", { outputFile: "./test-output/vitest/junit.xml", addFileAttribute: true }]
        ],
        coverage: {
            reportsDirectory: "./test-output/vitest/coverage",
            provider: "v8" as const,
            reporter: ["text", "html", "lcov"],
            include: ["src/**/*.{ts,tsx}"],
            exclude: ["**/*.{test,spec}.{ts,mts,cts,tsx,js,jsx}", "**/*.d.ts"]
        }
    }
}));
