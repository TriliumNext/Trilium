import { execFile } from "child_process";
import fs from "fs";
import http from "http";
import https from "https";
import net from "net";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SELF_SIGNED_CERT, SELF_SIGNED_KEY } from "../../spec/support/self_signed_tls.js";
import {
    HEALTHCHECK_SOCKET_FILE, HEALTHCHECK_URL_FILE, publishHealthcheckTarget
} from "./healthcheck.js";

const PROBE_SCRIPT = path.join(__dirname, "../../docker_healthcheck.sh");

//#region Publishing where the server listens

describe("publishing the healthcheck target", () => {
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "trilium-publish-"));
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it("writes the port the server actually bound, not the one that was asked for", () => {
        const bound = { address: "0.0.0.0", family: "IPv4", port: 9001 };

        publishHealthcheckTarget(dataDir, bound, false);

        expect(readTarget().url).toBe("http://127.0.0.1:9001/api/health-check");
        expect(readTarget().socket).toBeUndefined();
    });

    it("dials loopback for wildcard binds, and the interface itself otherwise", () => {
        const cases: [ string, string, string ][] = [
            [ "0.0.0.0", "IPv4", "127.0.0.1" ],
            [ "::", "IPv6", "[::1]" ],
            [ "192.168.1.5", "IPv4", "192.168.1.5" ],
            [ "fe80::1", "IPv6", "[fe80::1]" ]
        ];

        for (const [ address, family, expected ] of cases) {
            publishHealthcheckTarget(dataDir, { address, family, port: 8080 }, false);

            expect(readTarget().url).toBe(`http://${expected}:8080/api/health-check`);
        }
    });

    it("records the scheme the server speaks", () => {
        publishHealthcheckTarget(dataDir, { address: "0.0.0.0", family: "IPv4", port: 8080 }, true);

        expect(readTarget().url).toBe("https://127.0.0.1:8080/api/health-check");
    });

    it("passes a unix socket path separately, since the url cannot carry it", () => {
        publishHealthcheckTarget(dataDir, "/run/trilium.sock", false);

        expect(readTarget()).toEqual({
            url: "http://localhost/api/health-check",
            socket: "/run/trilium.sock"
        });
    });

    it("clears a stale socket file when the server moves back to a port", () => {
        publishHealthcheckTarget(dataDir, "/run/trilium.sock", false);
        publishHealthcheckTarget(dataDir, { address: "0.0.0.0", family: "IPv4", port: 80 }, false);

        expect(readTarget().socket).toBeUndefined();
    });

    it("writes nothing when the server reports no address", () => {
        publishHealthcheckTarget(dataDir, null, false);

        expect(fs.existsSync(path.join(dataDir, HEALTHCHECK_URL_FILE))).toBe(false);
    });

    function readTarget() {
        const read = (name: string) => {
            const file = path.join(dataDir, name);

            return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
        };

        return { url: read(HEALTHCHECK_URL_FILE), socket: read(HEALTHCHECK_SOCKET_FILE) };
    }
});

//#endregion

//#region The probe docker runs

/**
 * Drives the shipped shell script rather than a re-implementation of it, against real servers, so
 * the exit codes docker reads are the ones this asserts. Needs a POSIX shell and curl.
 */
describe.skipIf(process.platform === "win32")("the docker healthcheck script", () => {
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "trilium-probe-"));
    });

    afterEach(async () => {
        await stopEverything();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it("reports healthy on 200, having asked for the health-check resource", async () => {
        const seen: { method?: string; url?: string }[] = [];
        await publishServer((req, res) => {
            seen.push({ method: req.method, url: req.url });
            res.statusCode = 200;
            res.end('{"status":"ok"}');
        });

        expect(await probe()).toBe(0);
        expect(seen).toEqual([ { method: "GET", url: "/api/health-check" } ]);
    });

    it("reports unhealthy on any status other than 200", async () => {
        let status = 500;
        await publishServer((_req, res) => {
            res.statusCode = status;
            res.end();
        });

        for (const next of [ 500, 503, 404, 301 ]) {
            status = next;
            expect(await probe()).toBe(1);
        }
    });

    it("reports unhealthy when nothing is listening", async () => {
        const port = await reserveFreePort();
        publishHealthcheckTarget(dataDir, { address: "127.0.0.1", family: "IPv4", port }, false);

        expect(await probe()).toBe(1);
    });

    it("reports unhealthy when the server never reached listening", async () => {
        expect(await probe()).toBe(1);
    });

    it("gives up and reports unhealthy when the server accepts but never answers", async () => {
        const server = track(net.createServer(() => { /* accepts, never answers */ }));
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        publishHealthcheckTarget(dataDir, addressOf(server), false);

        const started = Date.now();

        expect(await probe()).toBe(1);
        expect(Date.now() - started).toBeLessThan(8000);
    });

    it("speaks TLS, accepting a certificate a loopback probe cannot verify", async () => {
        await publishServer((_req, res) => {
            res.statusCode = 200;
            res.end();
        }, true);

        expect(await probe()).toBe(0);
    });

    it("reaches a server listening on a unix socket", async () => {
        const socketPath = path.join(dataDir, "trilium.sock");
        const seen: (string | undefined)[] = [];
        const server = track(http.createServer((req, res) => {
            seen.push(req.url);
            res.statusCode = 200;
            res.end();
        }));
        await new Promise<void>((resolve) => server.listen(socketPath, resolve));
        publishHealthcheckTarget(dataDir, socketPath, false);

        expect(await probe()).toBe(0);
        expect(seen).toEqual([ "/api/health-check" ]);
    });

    /** Runs the real script the image ships, with the data directory this test wrote into. */
    function probe() {
        return new Promise<number>((resolve) => {
            const env = { ...process.env, TRILIUM_DATA_DIR: dataDir };

            execFile("/bin/sh", [ PROBE_SCRIPT ], { env },
                (error) => resolve(error ? (typeof error.code === "number" ? error.code : 1) : 0));
        });
    }

    async function publishServer(handler: http.RequestListener, overTls = false) {
        const server = track(overTls
            ? https.createServer({ key: SELF_SIGNED_KEY, cert: SELF_SIGNED_CERT }, handler)
            : http.createServer(handler));
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        publishHealthcheckTarget(dataDir, addressOf(server), overTls);
    }
});

//#endregion

/** Everything a test opened, torn down afterwards whether or not the test got that far. */
const openServers: (http.Server | net.Server)[] = [];
const openSockets = new Set<net.Socket>();

function track<T extends http.Server | net.Server>(server: T) {
    openServers.push(server);
    server.on("connection", (socket: net.Socket) => {
        openSockets.add(socket);
        socket.on("close", () => openSockets.delete(socket));
    });

    return server;
}

function addressOf(server: http.Server | net.Server) {
    const address = server.address();
    if (address === null || typeof address === "string") {
        throw new Error("expected the server to be listening on a TCP port");
    }

    return address;
}

async function reserveFreePort() {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = addressOf(server);
    await new Promise<void>((resolve) => server.close(() => resolve()));

    return port;
}

async function stopEverything() {
    for (const socket of openSockets) {
        socket.destroy();
    }
    openSockets.clear();

    for (const server of openServers.splice(0)) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}
