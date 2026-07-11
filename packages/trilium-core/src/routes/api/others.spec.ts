import { beforeAll, describe, expect, it } from "vitest";

import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core "other" routes through {@link CoreApiTester} (no Express),
 * so this spec runs under both the node and standalone (WASM) suites.
 */
let api: CoreApiTester;

describe("Others API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    describe("icon usage", () => {
        it("returns a map of user-set icon classes to counts", async () => {
            const res = await api.get<{ iconClassToCountMap: Record<string, number> }>(
                "/api/other/icon-usage"
            );
            expect(res.status).toBe(200);
            expect(res.body.iconClassToCountMap).toBeTypeOf("object");
        });

        it("counts an iconClass label added to a user note", async () => {
            const { noteId } = await createTextNote(api, { title: "Icon note" });
            const add = await api.post(`/api/notes/${noteId}/attributes`, {
                body: { type: "label", name: "iconClass", value: "bx bx-test-icon-usage" }
            });
            expect(add.status).toBe(204);

            const res = await api.get<{ iconClassToCountMap: Record<string, number> }>(
                "/api/other/icon-usage"
            );
            expect(res.status).toBe(200);
            // The "bx" prefix is stripped; the specific class is counted.
            expect(res.body.iconClassToCountMap["bx-test-icon-usage"]).toBeGreaterThanOrEqual(1);
            expect(res.body.iconClassToCountMap).not.toHaveProperty("bx");
        });

        it("ignores blank iconClass labels and system-note icons", async () => {
            // A whitespace-only iconClass exercises the empty-value `continue`.
            const { noteId } = await createTextNote(api, { title: "Blank icon note" });
            const add = await api.post(`/api/notes/${noteId}/attributes`, {
                body: { type: "label", name: "iconClass", value: "   " }
            });
            expect(add.status).toBe(204);

            const res = await api.get<{ iconClassToCountMap: Record<string, number> }>(
                "/api/other/icon-usage"
            );
            expect(res.status).toBe(200);
            // The blank value is skipped, so no empty-string key is added.
            expect(Object.keys(res.body.iconClassToCountMap)).not.toContain("");
        });
    });

    describe("render markdown", () => {
        it("renders markdown content to HTML", async () => {
            const res = await api.post<{ htmlContent: string }>("/api/other/render-markdown", {
                body: { markdownContent: "# Heading\n\nSome **bold** text." }
            });
            expect(res.status).toBe(200);
            expect(typeof res.body.htmlContent).toBe("string");
            expect(res.body.htmlContent).toContain("Heading");
            expect(res.body.htmlContent).toContain("bold");
        });

        it("400s when markdownContent is missing", async () => {
            const res = await api.post("/api/other/render-markdown", { body: {} });
            expect(res.status).toBe(400);
        });

        it("400s when markdownContent is not a string", async () => {
            const res = await api.post("/api/other/render-markdown", {
                body: { markdownContent: 123 }
            });
            expect(res.status).toBe(400);
        });
    });

    describe("to markdown", () => {
        it("converts HTML content to markdown", async () => {
            const res = await api.post<{ markdownContent: string }>("/api/other/to-markdown", {
                body: { htmlContent: "<h1>Heading</h1><p>Some <strong>bold</strong> text.</p>" }
            });
            expect(res.status).toBe(200);
            expect(typeof res.body.markdownContent).toBe("string");
            expect(res.body.markdownContent).toContain("Heading");
            expect(res.body.markdownContent).toContain("bold");
        });

        it("400s when htmlContent is missing", async () => {
            const res = await api.post("/api/other/to-markdown", { body: {} });
            expect(res.status).toBe(400);
        });

        it("400s when htmlContent is not a string", async () => {
            const res = await api.post("/api/other/to-markdown", {
                body: { htmlContent: 123 }
            });
            expect(res.status).toBe(400);
        });
    });
});
