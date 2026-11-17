import { becca_loader, getLog, sql_init } from "@triliumnext/core";
import compression from "compression";
import type { Application } from "express";
import express from "express";
import fs from "fs";
import path from "path";
import supertest from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const devMode = vi.hoisted(() => ({ isDev: true }));

vi.mock("./services/utils.js", async (importOriginal) => ({
    ...await importOriginal<typeof import("./services/utils.js")>(),
    get isDev() {
        return devMode.isDev;
    }
}));

import buildApp from "./app.js";
import config from "./services/config.js";
import { getClientDir } from "./routes/assets.js";
import { RESOURCE_DIR } from "./services/resource_dir.js";
import { getResourceDir } from "./services/utils.js";

describe("buildApp", () => {
    const network = config.Network;
    const originalNetwork = { ...network };
    let app: Application;

    beforeAll(async () => {
        network.corsResourcePolicy = "cross-origin";
        try {
            app = await buildApp();
        } finally {
            network.corsResourcePolicy = originalNetwork.corsResourcePolicy;
        }
    });

    afterEach(() => {
        Object.assign(network, originalNetwork);
        devMode.isDev = true;
        vi.restoreAllMocks();
    });

    it("sends the configured CORS headers and answers preflight requests itself", async () => {
        network.corsAllowOrigin = "https://example.com";
        network.corsAllowMethods = "GET, POST";
        network.corsAllowHeaders = "X-Custom";

        const get = await supertest(app).get("/api/health-check");
        expect(get.headers).toMatchObject({
            "access-control-allow-origin": "https://example.com",
            "access-control-allow-credentials": "true",
            "access-control-allow-methods": "GET, POST",
            "access-control-allow-headers": "X-Custom",
            "cross-origin-resource-policy": "cross-origin"
        });

        const preflight = await supertest(app).options("/api/health-check");
        expect(preflight.status).toBe(204);
        expect(preflight.headers["access-control-allow-origin"]).toBe("https://example.com");
    });

    it("sends only the CORS headers that are configured, and leaves preflights to the routes without an origin", async () => {
        network.corsAllowOrigin = "";
        network.corsAllowMethods = "GET";
        network.corsAllowHeaders = "";

        const preflight = await supertest(app).options("/api/health-check");
        expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
        expect(preflight.headers["access-control-allow-credentials"]).toBeUndefined();
        expect(preflight.headers["access-control-allow-headers"]).toBeUndefined();
        expect(preflight.headers["access-control-allow-methods"]).toBe("GET");
        // Express's own OPTIONS handling answers with the methods the route accepts.
        expect(preflight.status).toBe(200);
        expect(preflight.headers.allow).toContain("GET");

        network.corsAllowMethods = "";
        const get = await supertest(app).get("/api/health-check");
        expect(get.headers["access-control-allow-methods"]).toBeUndefined();
        expect(get.body).toEqual({ status: "ok" });
    });

    it("leaves the streaming endpoints out of compression", async () => {
        const compressible = vi.spyOn(compression, "filter");

        await supertest(app).post("/mcp").send({});
        expect(compressible).not.toHaveBeenCalled();

        await supertest(app).get("/api/health-check");
        expect(compressible).toHaveBeenCalled();
    });

    it("serves the development icon in a checkout", async () => {
        const icon = await supertest(app).get("/favicon.ico").buffer(true).parse(binaryParser);
        expect(icon.body).toEqual(fs.readFileSync(path.join(RESOURCE_DIR, "icon-dev.ico")));
    });

    it("serves the Home Screen icon that iOS asks for at the root", async () => {
        const icon = await supertest(app).get("/apple-touch-icon.png").buffer(true).parse(binaryParser);
        expect(icon.status).toBe(200);
        expect(icon.headers["content-type"]).toBe("image/png");
        expect(icon.body).toEqual(fs.readFileSync(path.join(getClientDir(), "assets", "apple-touch-icon.png")));
    });

    it("builds the production app, falling back on an invalid resource policy and not waiting for becca before setup", async () => {
        devMode.isDev = false;
        network.corsResourcePolicy = "everyone";
        const logError = vi.spyOn(getLog(), "error");
        const staticRoots = vi.spyOn(express, "static");
        vi.spyOn(sql_init, "isDbInitialized").mockReturnValue(false);
        // A database that is not set up never loads becca, so awaiting this would hang.
        const beccaLoaded = becca_loader.beccaLoaded;
        becca_loader.beccaLoaded = new Promise<void>(() => {});

        let production: Application;
        try {
            production = await buildApp();
        } finally {
            becca_loader.beccaLoaded = beccaLoaded;
        }

        expect(logError).toHaveBeenCalledWith("Invalid CORS Resource Policy value: 'everyone', defaulting to 'same-origin'");
        expect(staticRoots).toHaveBeenCalledWith(path.join(getResourceDir(), "public", "root"), { dotfiles: "allow" });

        const icon = await supertest(production).get("/favicon.ico").buffer(true).parse(binaryParser);
        expect(icon.headers["cross-origin-resource-policy"]).toBe("same-origin");
        expect(icon.body).toEqual(fs.readFileSync(path.join(RESOURCE_DIR, "icon.ico")));
    });
});

/** Collects a binary response body, which supertest does not buffer for image types. */
function binaryParser(res: unknown, callback: (err: Error | null, body: Buffer) => void) {
    const stream = res as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => callback(null, Buffer.concat(chunks)));
}
