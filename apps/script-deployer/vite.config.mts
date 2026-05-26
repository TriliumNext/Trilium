/// <reference types='vitest' />
import { defineConfig } from "vite";

export default defineConfig(() => ({
    root: __dirname,
    test: {
        watch: false,
        globals: true,
        setupFiles: ["../server/spec/setup.ts"],
        environment: "node",
        env: {
            NODE_ENV: "development",
            TRILIUM_DATA_DIR: "./data",
            TRILIUM_INTEGRATION_TEST: "memory",
            TRILIUM_RESOURCE_DIR: "../server/src",
            TRILIUM_ENV: "dev",
        },
        include: ["src/**/*.{test,spec}.ts"],
        testTimeout: 20_000,
    },
}));
