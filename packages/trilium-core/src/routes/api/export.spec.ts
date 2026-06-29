import { beforeAll, describe, expect, it } from "vitest";

import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core export route through {@link CoreApiTester} (no Express)
 * end to end — the REAL zip/single/opml export services run, writing to the
 * tester's stream-backed mock response. Runs under both the node (archiver) and
 * standalone (fflate) suites, exercising each runtime's real zip provider.
 */
let api: CoreApiTester;
let branchId: string;

function exportPath(type: string, format: string, taskId = "exportTask") {
    return `/api/branches/${branchId}/export/${type}/${format}/${taskId}`;
}

/** A real zip always begins with the "PK" local-file-header signature. */
function isZip(body: unknown): boolean {
    return Buffer.isBuffer(body) && body.length > 2 && body.subarray(0, 2).toString("latin1") === "PK";
}

describe("Export API (core)", () => {
    beforeAll(async () => {
        api = CoreApiTester.build();
        ({ branchId } = await createTextNote(api, { title: "Export me", content: "<p>hello world</p>" }));
    });

    it("returns 500 when the branch does not exist", async () => {
        const res = await api.get<string>(exportPath("subtree", "html").replace(branchId, "missingBranch123"));
        expect(res.status).toBe(500);
        expect(res.headers["Content-Type"]).toBe("text/plain");
    });

    it.each([ "html", "markdown" ])("exports a subtree as a real %s zip", async (format) => {
        const res = await api.get(exportPath("subtree", format));
        expect(res.status).toBe(200);
        expect(res.headers["Content-Type"]).toBe("application/zip");
        expect(isZip(res.body)).toBe(true);
    });

    it("exports a single note as markdown with the real content", async () => {
        const res = await api.get<string>(exportPath("single", "markdown"));
        expect(res.status).toBe(200);
        expect(res.headers["Content-Type"]).toContain("markdown");
        expect(String(res.body)).toContain("hello world");
    });

    it("exports a single note as html with the real content", async () => {
        const res = await api.get<string>(exportPath("single", "html"));
        expect(res.status).toBe(200);
        expect(String(res.body)).toContain("hello world");
    });

    it("returns 500 for an invalid single-export format (ValidationError caught)", async () => {
        const res = await api.get<string>(exportPath("single", "pdf"));
        expect(res.status).toBe(500);
        expect(res.headers["Content-Type"]).toBe("text/plain");
    });

    it("exports as real opml", async () => {
        const res = await api.get(exportPath("subtree", "opml"));
        expect(res.status).toBe(200);
        expect(res.headers["Content-Type"]).toBe("text/x-opml");
        expect(res.body?.toString()).toContain("outline");
    });

    it("returns 500 for an unrecognized format (NotFoundError caught)", async () => {
        const res = await api.get<string>(exportPath("tree", "bogus"));
        expect(res.status).toBe(500);
        expect(res.headers["Content-Type"]).toBe("text/plain");
    });
});
