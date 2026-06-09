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

    it("propagates a failed request and never sanitizes", async () => {
        serverGet.mockRejectedValueOnce(new Error("500: conversion failed"));
        await expect(renderOfficeToHtml("notes", "n1")).rejects.toThrow(/conversion failed/);
        expect(sanitizeNoteContentHtml).not.toHaveBeenCalled();
    });
});
