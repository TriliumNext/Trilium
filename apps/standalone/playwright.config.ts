import { createBaseConfig } from "../../packages/trilium-e2e/src/base-config";

const port = process.env["TRILIUM_PORT"] ?? "8082";
const baseURL = process.env["BASE_URL"] || `http://127.0.0.1:${port}`;

export default createBaseConfig({
    appDir: __dirname,
    projectName: "standalone",
    workers: 1,
    webServer: !process.env.TRILIUM_DOCKER ? {
        command: `pnpm build && pnpm vite preview --host 127.0.0.1 --port ${port}`,
        url: baseURL,
        env: {
            TRILIUM_INTEGRATION_TEST: "memory"
        },
        reuseExistingServer: !process.env.CI,
        cwd: __dirname,
        timeout: 5 * 60 * 1000
    } : undefined,
});
