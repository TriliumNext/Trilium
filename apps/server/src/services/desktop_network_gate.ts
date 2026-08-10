import type { NextFunction, Request, Response } from "express";

import config from "./config.js";
import { isInternalElectronRequest } from "./electron_request.js";
import { isElectron } from "./utils.js";

/**
 * Paths that stay reachable on the desktop's loopback listener even when the user
 * has NOT enabled network access. These are same-machine integrations rather than
 * the web app:
 *  - `/mcp` — the MCP transport, which requires an ETAPI token on every request
 *    (see routes/mcp.ts), exactly like `/etapi`. The loopback Host check below applies on
 *    top of that token, which is why this middleware must stay mounted ahead of the MCP
 *    routes in app.ts. Note it is the loopback *bind* (see host.ts), not this gate, that
 *    keeps MCP off the LAN while network access is off — the check here only refuses a
 *    rebound Host on a connection that already reached the loopback listener.
 *  - `/api/clipper` — the web clipper endpoint the browser extension talks to.
 *  - `/etapi` — the token-authenticated External API used by local automation.
 *
 * Everything else (the SPA + login, `/share`, the authenticated `/api`, static
 * assets) is "web access to the desktop instance" and is served only once the user
 * opts into network access.
 */
const LOCAL_INTEGRATION_PREFIXES = ["/mcp", "/api/clipper", "/etapi"];

export function isLocalIntegrationPath(path: string): boolean {
    return LOCAL_INTEGRATION_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Whether an HTTP `Host` header names a loopback address. Used to keep the local
 * integrations reachable only from genuine same-machine clients: a page that has
 * DNS-rebound its own domain to 127.0.0.1 still connects from loopback (so an IP
 * check passes) but sends its original host, so the Host header is what exposes it
 * — the same defence MCP applies (see routes/mcp.ts). Guards the unauthenticated
 * web-clipper endpoint in particular.
 */
export function isLoopbackHost(host: string | undefined): boolean {
    if (!host) {
        return false;
    }
    // Strip any :port and IPv6 brackets: "127.0.0.1:37742" → "127.0.0.1", "[::1]:37742" → "::1".
    const hostname = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
    return hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");
}

/**
 * Pure decision for {@link desktopNetworkAccessGate}, extracted so the branching is
 * unit-testable without a live Electron build (isElectron is a process constant).
 *
 * Blocks a request only when ALL hold: it's the desktop build, the user hasn't
 * enabled network access, it arrived over TCP (not from our own trilium-app://
 * renderer), and it targets something other than a localhost integration.
 */
export function shouldBlockDesktopWebRequest(opts: {
    isElectron: boolean;
    allowLanAccess: boolean;
    isInternal: boolean;
    path: string;
    host: string | undefined;
}): boolean {
    if (!opts.isElectron) {
        return false; // server build — web access is the whole point
    }
    if (opts.allowLanAccess) {
        return false; // opted into network access — serve everything (LAN clients included)
    }
    if (opts.isInternal) {
        return false; // our own renderer, dispatched in-process — never gated
    }
    if (!isLocalIntegrationPath(opts.path)) {
        return true; // the web app / share — gated behind the network-access opt-in
    }
    // A local integration on the loopback-only listener: additionally require a loopback
    // Host header so a DNS-rebound attacker domain can't drive the unauthenticated clipper.
    return !isLoopbackHost(opts.host);
}

/**
 * Gates web access to a desktop instance behind the network-access opt-in
 * (`allowLanAccess`). With it off, a browser (or any TCP client) reaching the
 * loopback listener can still use the localhost integrations but not the app or
 * shared notes. Mounted before the static/app/share routes; the renderer bypasses
 * it via the internal-electron marker.
 */
export function desktopNetworkAccessGate(req: Request, res: Response, next: NextFunction): void {
    const blocked = shouldBlockDesktopWebRequest({
        isElectron,
        allowLanAccess: config.Security?.allowLanAccess === true,
        isInternal: isInternalElectronRequest(req),
        path: req.path,
        host: req.get("host")
    });

    if (blocked) {
        res.status(403).type("text/plain").send(
            'Web access to this Trilium desktop instance is disabled. Enable "Network access" in Settings → Security to reach it from a browser.'
        );
        return;
    }

    next();
}
