import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "happy-dom",
        include: ["test/**/*.spec.ts"],
        coverage: {
            provider: "v8",
            include: ["src/**/*.{ts,js}"],
            exclude: ["**/*.{test,spec}.{ts,mts,cts,tsx,js,jsx}", "**/*.d.ts"],
            reporter: ["text", "lcov"],
            reportsDirectory: "./test-output/vitest/coverage"
        },
    },
});
