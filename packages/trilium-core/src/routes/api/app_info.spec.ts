import { beforeAll, describe, expect, it } from "vitest";

import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core app-info route through {@link CoreApiTester} (no Express),
 * so this spec runs under both the node and standalone (WASM) suites.
 */
let api: CoreApiTester;

interface AppInfoResponse {
    appVersion: string;
    dbVersion: number;
    syncVersion: number;
    buildDate: string;
    buildRevision: string;
    clipperProtocolVersion: string;
    utcDateTime: string;
}

describe("App info API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    it("returns the installation info object", async () => {
        const res = await api.get<AppInfoResponse>("/api/app-info");

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            appVersion: expect.any(String),
            dbVersion: expect.any(Number),
            syncVersion: expect.any(Number),
            buildDate: expect.any(String),
            buildRevision: expect.any(String),
            clipperProtocolVersion: expect.any(String),
            utcDateTime: expect.any(String)
        });
    });

    it("returns a parseable ISO timestamp for utcDateTime", async () => {
        const res = await api.get<AppInfoResponse>("/api/app-info");

        expect(res.status).toBe(200);
        expect(Number.isNaN(Date.parse(res.body.utcDateTime))).toBe(false);
    });
});
