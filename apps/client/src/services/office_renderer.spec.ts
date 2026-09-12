import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mock collaborators before importing the SUT. ---
const serverGet = vi.fn(async (_url: string, _componentId?: string, _raw?: boolean) => "<h1>Doc</h1>");
vi.mock("./server.js", () => ({
    default: { get: (url: string, componentId?: string, raw?: boolean) => serverGet(url, componentId, raw) }
}));

const sanitizeNoteContentHtml = vi.fn((s: string) => `SANITIZED:${s}`);
vi.mock("./sanitize_content.js", () => ({ sanitizeNoteContentHtml: (s: string) => sanitizeNoteContentHtml(s) }));

import { renderOfficeToHtml } from "./office_renderer.js";

beforeEach(() => vi.clearAllMocks());

describe("renderOfficeToHtml", () => {
    it("fetches the server-rendered note preview and returns sanitized output", async () => {
        const { html } = await renderOfficeToHtml("notes", "n1");

        expect(serverGet).toHaveBeenCalledWith("notes/n1/office-preview", undefined, true);
        expect(sanitizeNoteContentHtml).toHaveBeenCalledWith("<h1>Doc</h1>");
        expect(html).toBe("SANITIZED:<h1>Doc</h1>");
    });

    it("builds the attachment URL variant", async () => {
        await renderOfficeToHtml("attachments", "a9");
        expect(serverGet).toHaveBeenCalledWith("attachments/a9/office-preview", undefined, true);
    });

    it("strips default hyperlink colors so the theme's link color applies, keeping other styling", async () => {
        serverGet.mockResolvedValueOnce(
            '<p><a href="https://example.com"><span style="color: #000080; font-family: Arial"><u>x</u></span></a>'
                + '<a href="#b" style="color: #0563C1">y</a>'
                + '<span style="color: #000080">keep</span></p>'
        );

        const { html } = await renderOfficeToHtml("notes", "n1");

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
        serverGet.mockResolvedValueOnce(
            '<p><a href="https://triliumnotes.org/"><span style="color:#ea7500;">Trilium</span></a></p>'
        );

        const { html } = await renderOfficeToHtml("notes", "n1");

        expect(html).toContain("#ea7500");
    });

    it("propagates a failed request and never sanitizes", async () => {
        serverGet.mockRejectedValueOnce(new Error("500: conversion failed"));
        await expect(renderOfficeToHtml("notes", "n1")).rejects.toThrow(/conversion failed/);
        expect(sanitizeNoteContentHtml).not.toHaveBeenCalled();
    });

    it("splits a leading stylesheet off the fragment, keeping it clear of the sanitizer", async () => {
        // The renderer writes one rule per line, with the tags on their own.
        serverGet.mockResolvedValueOnce(
            '<style>\n.spreadsheet-table .sst-1{font-weight:bold}\n.spreadsheet-table .sst-2{color:red}\n</style>\n'
            + '<table><td class="sst-1">x</td></table>');

        const { css, html } = await renderOfficeToHtml("notes", "n1");

        expect(css).toBe(".spreadsheet-table .sst-1{font-weight:bold}\n.spreadsheet-table .sst-2{color:red}");
        expect(sanitizeNoteContentHtml).toHaveBeenCalledWith('<table><td class="sst-1">x</td></table>');
        expect(html).not.toContain("<style>");
    });

    it("returns no stylesheet for a fragment that carries none, or an unterminated one", async () => {
        serverGet.mockResolvedValueOnce("<p>plain</p>");
        expect((await renderOfficeToHtml("notes", "n1")).css).toBe("");

        serverGet.mockResolvedValueOnce("<style>.a{b:c}");
        const truncated = await renderOfficeToHtml("notes", "n1");
        expect(truncated.css).toBe("");
        expect(sanitizeNoteContentHtml).toHaveBeenCalledWith("<style>.a{b:c}");
    });

    it("skips the link pass for a spreadsheet, which cannot carry a styled link", async () => {
        // A spreadsheet's anchors are written bare, and the fragment arrives with a stylesheet;
        // running the pass would parse and re-serialize the whole grid to find nothing.
        serverGet.mockResolvedValueOnce(
            '<style>\n.spreadsheet-table .sst-1{text-align:right}\n</style>\n'
            + '<table class="spreadsheet-table"><td><a href="https://x.test">y</a></td></table>');

        const { html } = await renderOfficeToHtml("notes", "n1");

        // Untouched by the pass: what the sanitizer returned is what comes back.
        expect(html).toBe('SANITIZED:<table class="spreadsheet-table"><td><a href="https://x.test">y</a></td></table>');
    });

    it("skips the link pass for a fragment holding no link at all", async () => {
        serverGet.mockResolvedValueOnce('<div class="container"><p style="color: #000080">not a link</p></div>');

        const { html } = await renderOfficeToHtml("notes", "n1");

        expect(html).toBe('SANITIZED:<div class="container"><p style="color: #000080">not a link</p></div>');
    });

    it("still runs the link pass for a converted document that has one", async () => {
        // No stylesheet, and an anchor: the officeparser path, where the word processor's own
        // hyperlink color is what has to go.
        serverGet.mockResolvedValueOnce(
            '<div class="container"><a href="#a" style="color: #000080">x</a></div>');

        const { html } = await renderOfficeToHtml("notes", "n1");

        expect(html).not.toContain("#000080");
        expect(html).toContain('<a href="#a">x</a>');
    });

    it("asks the route to trim when the caller wants a card-sized preview", async () => {
        await renderOfficeToHtml("notes", "n1", { trim: true });
        expect(serverGet).toHaveBeenCalledWith("notes/n1/office-preview?trim=1", undefined, true);

        // Left off otherwise, so the whole document and the corner never share a cache entry.
        await renderOfficeToHtml("notes", "n1");
        expect(serverGet).toHaveBeenLastCalledWith("notes/n1/office-preview", undefined, true);
    });
});
