/**
 * The native core server process. Serves the full app (client bundle +
 * API + WebSocket) on a loopback port with trilium-core running in-process.
 *
 * Used two ways:
 * - spawned by the desktop shell (shell_native.ts), which navigates its
 *   window here — a separate process because the compiled desktop runtime
 *   currently hangs on loading npm modules (upstream deno desktop bug);
 * - run directly for headless development: deno task dev-server
 *   (then open http://127.0.0.1:8765 in any browser or poke it with curl).
 */

import { startCoreServer } from "./core_server.ts";
import { createHttpHandler } from "./http.ts";

const distDir = new URL(import.meta.resolve("../../standalone/dist")).pathname;
const dataDir = Deno.env.get("TRILIUM_DATA_DIR") ?? Deno.makeTempDirSync({ prefix: "trilium-deno-dev-" });
await Deno.mkdir(dataDir, { recursive: true });

const stats = { apiRequests: 0 };
const coreReady = startCoreServer({
    dbPath: `${dataDir}/document.db`,
    dataDir,
    distDir
});
coreReady.catch((e) => {
    console.error("Core failed to start:", e);
    Deno.exit(1);
});

const handler = createHttpHandler(coreReady, distDir, stats);
const port = Number(Deno.env.get("PORT") ?? 8765);
Deno.serve({ port, hostname: "127.0.0.1" }, async (req) => {
    // Introspection for the desktop shell's smoke mode.
    if (new URL(req.url).pathname === "/desktop-status") {
        const core = await coreReady;
        return Response.json({
            apiRequests: stats.apiRequests,
            wsClients: core.messaging.getClientCount(),
            dataDir
        });
    }
    return handler(req);
});
console.log(`Data dir: ${dataDir}`);
