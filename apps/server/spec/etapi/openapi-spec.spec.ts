import { Application, Router } from "express";
import { load } from "js-yaml";
import { beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";

import config from "../../src/services/config.js";
import etapiAppInfoRoutes from "../../src/etapi/app_info.js";
import etapiAttachmentRoutes from "../../src/etapi/attachments.js";
import etapiAttributeRoutes from "../../src/etapi/attributes.js";
import etapiAuthRoutes from "../../src/etapi/auth.js";
import etapiBackupRoute from "../../src/etapi/backup.js";
import etapiBranchRoutes from "../../src/etapi/branches.js";
import etapiMetricsRoute from "../../src/etapi/metrics.js";
import etapiNoteRoutes from "../../src/etapi/notes.js";
import etapiRevisionsRoutes from "../../src/etapi/revisions.js";
import etapiSpecialNoteRoutes from "../../src/etapi/special_notes.js";

let app: Application;

/** The specification cannot usefully describe the route serving it. Everything else must be documented. */
const UNDOCUMENTED_ROUTES = new Set(["/etapi.openapi.yaml"]);

describe("etapi/etapi.openapi.yaml", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await import("../../src/app.js")).default;
        app = await buildApp();
    });

    it("serves the OpenAPI specification (and the cached copy on repeat)", async () => {
        const response = await supertest(app).get("/etapi/etapi.openapi.yaml").expect(200);
        expect(response.headers["content-type"]).toContain("text/plain");
        expect(response.text).toContain("openapi");

        // Second request is served from the in-memory cache.
        const cached = await supertest(app).get("/etapi/etapi.openapi.yaml").expect(200);
        expect(cached.text).toStrictEqual(response.text);
    });

    it("documents every route registered under /etapi", async () => {
        const response = await supertest(app).get("/etapi/etapi.openapi.yaml").expect(200);
        const spec = load(response.text) as { paths: Record<string, Record<string, unknown>> };

        const undocumented = collectEtapiRoutes().filter(({ method, path }) => {
            if (UNDOCUMENTED_ROUTES.has(path)) {
                return false;
            }
            return !spec.paths[path]?.[method];
        });

        expect(undocumented).toStrictEqual([]);
    });
});

/**
 * Registers the ETAPI route modules onto a bare router and reads back what they mounted, as
 * `{ method, path }` pairs addressed the way the specification addresses them: without the
 * /etapi prefix and with `:date` rewritten to `{date}`.
 */
function collectEtapiRoutes() {
    const router = Router();

    etapiAuthRoutes.register(router, []);
    etapiAppInfoRoutes.register(router);
    etapiAttachmentRoutes.register(router);
    etapiAttributeRoutes.register(router);
    etapiBackupRoute.register(router);
    etapiBranchRoutes.register(router);
    etapiMetricsRoute.register(router);
    etapiNoteRoutes.register(router);
    etapiRevisionsRoutes.register(router);
    etapiSpecialNoteRoutes.register(router);

    const routes: { method: string; path: string }[] = [];

    for (const layer of router.stack) {
        // Express exposes the verbs a route was mounted with, but its types don't declare them.
        const route = layer.route as (typeof layer.route & { methods: Record<string, boolean> }) | undefined;
        if (!route?.path.startsWith("/etapi/")) {
            continue;
        }

        const path = route.path.replace("/etapi", "").replace(/:(\w+)/g, "{$1}");
        for (const [method, enabled] of Object.entries(route.methods)) {
            if (enabled && method !== "_all") {
                routes.push({ method, path });
            }
        }
    }

    expect(routes.length).toBeGreaterThan(0);
    return routes;
}
