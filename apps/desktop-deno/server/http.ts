/**
 * HTTP layer for the native core server: dispatches API requests into the
 * shared route table, upgrades WebSocket connections for entity-change
 * messaging, and serves the standalone client bundle with the in-page
 * server disabled (window.TRILIUM_NATIVE_SERVER marker).
 */

import { serveDir } from "@std/http/file-server";

import type { CoreServer } from "./core_server.ts";

const NATIVE_MARKER = "<script>window.TRILIUM_NATIVE_SERVER = true;</script>";

export interface HttpHandlerStats {
    apiRequests: number;
}

export function createHttpHandler(
    coreReady: Promise<CoreServer>,
    distDir: string,
    stats: HttpHandlerStats
): (req: Request) => Promise<Response> {
    return async (req: Request): Promise<Response> => {
        const { pathname } = new URL(req.url);

        // WebSocket upgrade — the client connects to the page origin for
        // entity-change push messages, exactly as with the Node server.
        if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
            const core = await coreReady;
            const { socket, response } = Deno.upgradeWebSocket(req);
            core.messaging.addSocket(socket);
            return response;
        }

        // API routes handled by core's shared route table.
        if (pathname.startsWith("/api/") || pathname === "/bootstrap") {
            const core = await coreReady;
            stats.apiRequests++;
            let body: ArrayBuffer | undefined;
            if (req.method !== "GET" && req.method !== "HEAD") {
                body = await req.arrayBuffer();
            }
            const result = await core.router.dispatch(
                req.method,
                req.url,
                body,
                Object.fromEntries(req.headers)
            );

            // The shared bootstrap route reports isStandalone: true, which
            // makes the client listen to the in-page worker bridge instead
            // of opening a WebSocket. Here there is a real server, so let
            // the client behave like it does against the Node server.
            if (pathname === "/bootstrap" && result.status === 200 && result.body) {
                const bootstrap = JSON.parse(new TextDecoder().decode(result.body));
                bootstrap.isStandalone = false;
                return new Response(JSON.stringify(bootstrap), {
                    status: 200,
                    headers: result.headers
                });
            }

            return new Response(result.body, {
                status: result.status,
                headers: result.headers
            });
        }

        // The client bundle. Inject the native-server marker into the app
        // shell so the standalone bootstrap skips its in-page server.
        if (pathname === "/" || pathname === "/index.html") {
            return serveIndex(distDir);
        }

        const res = await serveDir(req, { fsRoot: distDir, quiet: true });
        if (res.status === 404 && req.method === "GET" && wantsHtml(req)) {
            return serveIndex(distDir);
        }
        return withSecurityHeaders(new Response(res.body, res));
    };
}

async function serveIndex(distDir: string): Promise<Response> {
    const index = await Deno.readTextFile(`${distDir}/index.html`);
    return withSecurityHeaders(
        new Response(index.replace("<head>", `<head>\n        ${NATIVE_MARKER}`), {
            headers: { "content-type": "text/html" }
        })
    );
}

function wantsHtml(req: Request): boolean {
    const { pathname } = new URL(req.url);
    return !/\.[a-z0-9]+$/i.test(pathname) &&
        (req.headers.get("accept") ?? "").includes("text/html");
}

function withSecurityHeaders(res: Response): Response {
    res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    return res;
}
