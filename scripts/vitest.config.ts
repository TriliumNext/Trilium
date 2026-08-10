import { defineConfig } from "vitest/config";

// The repo-root maintenance scripts are not a workspace package, so they get their
// own project rather than a `pnpm --filter` target. Run it with `pnpm scripts:test`.
export default defineConfig({
    test: {
        name: "scripts",
        environment: "node",
        include: [ "*.spec.ts" ]
    }
});
