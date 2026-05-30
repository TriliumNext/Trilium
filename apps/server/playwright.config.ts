import { cpSync } from "fs";
import { join } from "path";

import { createBaseConfig } from "../../packages/trilium-e2e/src/base-config";

const port = process.env["TRILIUM_PORT"] ?? "8082";
const baseURL = process.env["BASE_URL"] || `http://127.0.0.1:${port}`;

// Copy the test fixture database into the spec/db data directory so the
// server finds it as a regular file-backed database. In CI the workflow
// handles this, but for local runs we do it here.
if (!process.env.TRILIUM_DOCKER) {
    cpSync(
        join(__dirname, "../../packages/trilium-core/src/test/fixtures/document.db"),
        join(__dirname, "spec/db/document.db")
    );
}

export default createBaseConfig({
    appDir: __dirname,
    localTestDir: "e2e",
    projectName: "server",
    webServer: !process.env.TRILIUM_DOCKER ? {
        command: "pnpm start-prod-no-dir",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        cwd: __dirname,
        env: {
            TRILIUM_DATA_DIR: "spec/db",
            TRILIUM_PORT: port,
            TRILIUM_INTEGRATION_TEST: "memory",
        },
        timeout: 5 * 60 * 1000
    } : undefined,
});
