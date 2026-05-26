/// <reference types='vitest' />
import { defineConfig } from "vite";

export default defineConfig(() => ({
    root: __dirname,
    cacheDir: "../../node_modules/.vite/apps/desktop",
    test: {
        watch: false,
        globals: true,
        environment: "node",
        include: ["src/**/*.spec.ts"],
        reporters: ["verbose"]
    }
}));
