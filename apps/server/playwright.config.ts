import { createBaseConfig } from "../../packages/trilium-e2e/src/base-config";

const port = process.env["TRILIUM_PORT"] ?? "8082";
const baseURL = process.env["BASE_URL"] || `http://127.0.0.1:${port}`;

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
            TRILIUM_INTEGRATION_TEST: "memory"
        },
        timeout: 5 * 60 * 1000
    } : undefined,
});
