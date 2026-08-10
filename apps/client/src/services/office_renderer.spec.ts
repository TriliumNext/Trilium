import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mock collaborators before importing the SUT. ---
const serverGet = vi.fn(async (_url: string) => ({ html: "<h1>Doc</h1>" }));
vi.mock("./server.js", () => ({ default: { get: (url: string) => serverGet(url) } }));

const sanitizeNoteContentHtml = vi.fn((s: string) => `SANITIZED:${s}`);
vi.mock("./sanitize_content.js", () => ({ sanitizeNoteContentHtml: (s: string) => sanitizeNoteContentHtml(s) }));

import { renderOfficeToHtml } from "./office_renderer.js";

beforeEach(() => vi.clearAllMocks());

describe("renderOfficeToHtml", () => {
    it("fetches the server-rendered note preview and returns sanitized output", async () => {
        const html = await renderOfficeToHtml("notes", "n1");

        expect(serverGet).toHaveBeenCalledWith("notes/n1/office-preview");
        expect(sanitizeNoteContentHtml).toHaveBeenCalledWith("<h1>Doc</h1>");
        expect(html).toBe("SANITIZED:<h1>Doc</h1>");
    });

    it("builds the attachment URL variant", async () => {
        await renderOfficeToHtml("attachments", "a9");
        expect(serverGet).toHaveBeenCalledWith("attachments/a9/office-preview");
    });

    it("strips default hyperlink colors so the theme's link color applies, keeping other styling", async () => {
        serverGet.mockResolvedValueOnce({
            html: '<p><a href="https://example.com"><span style="color: #000080; font-family: Arial"><u>x</u></span></a>'
                + '<a href="#b" style="color: #0563C1">y</a>'
                + '<span style="color: #000080">keep</span></p>'
        });

        const html = await renderOfficeToHtml("notes", "n1");

        // The default hyperlink character style's color is gone (both on runs inside the
        // link and on the <a> itself)...
        expect(html).not.toContain("#0563C1");
        // ...while the rest of the run styling and colors outside links survive.
        expect(html).toContain("font-family: Arial");
        expect(html).toContain("<u>x</u>");
        expect(html).toContain('<span style="color: #000080">keep</span>');
        // An emptied style attribute is dropped entirely.
        expect(html).toContain('<a href="#b">y</a>');
    });

    it("keeps a link color the author chose, as text notes do", async () => {
        serverGet.mockResolvedValueOnce({
            html: '<p><a href="https://triliumnotes.org/"><span style="color:#ea7500;">Trilium</span></a></p>'
        });

        const html = await renderOfficeToHtml("notes", "n1");

        expect(html).toContain("#ea7500");
    });

    it("propagates a failed request and never sanitizes", async () => {
        serverGet.mockRejectedValueOnce(new Error("500: conversion failed"));
        await expect(renderOfficeToHtml("notes", "n1")).rejects.toThrow(/conversion failed/);
        expect(sanitizeNoteContentHtml).not.toHaveBeenCalled();
    });
});
