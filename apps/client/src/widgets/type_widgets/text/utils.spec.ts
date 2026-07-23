import { beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";

import { ATTACHMENT_API_RE, IMAGE_API_RE } from "./image_url_patterns.js";
import { loadIncludedNote } from "./utils";

import content_renderer from "../../../services/content_renderer";
import froca from "../../../services/froca";
import link from "../../../services/link";

vi.mock("../../../services/froca", () => ({
    default: { getNote: vi.fn() }
}));
vi.mock("../../../services/link", () => ({
    default: { createLink: vi.fn() }
}));
vi.mock("../../../services/content_renderer", () => ({
    default: { getRenderedContent: vi.fn(), disposeInteractiveContent: vi.fn() }
}));

const note = { noteId: "noteY" } as unknown as FNote;

describe("IMAGE_API_RE", () => {
    it("matches a root-relative image URL", () => {
        expect(IMAGE_API_RE.test("/api/images/abc123XYZ_/note.png")).toBe(true);
    });

    it("matches an image URL without a leading slash", () => {
        expect(IMAGE_API_RE.test("api/images/abc123/note.png")).toBe(true);
    });

    it("captures the note ID", () => {
        const m = "/api/images/myNote01/image.png".match(IMAGE_API_RE);
        expect(m?.[1]).toBe("myNote01");
    });

    it("does not match attachment URLs", () => {
        expect(IMAGE_API_RE.test("/api/attachments/abc123/image/file.png")).toBe(false);
    });

    it("does not match unrelated URLs", () => {
        expect(IMAGE_API_RE.test("https://example.com/images/photo.png")).toBe(false);
    });
});

describe("ATTACHMENT_API_RE", () => {
    it("matches a root-relative attachment image URL", () => {
        expect(ATTACHMENT_API_RE.test("/api/attachments/att001/image/file.png")).toBe(true);
    });

    it("matches an attachment URL without a leading slash", () => {
        expect(ATTACHMENT_API_RE.test("api/attachments/att001/image/file.png")).toBe(true);
    });

    it("captures the attachment ID", () => {
        const m = "/api/attachments/att_XYZ/image/file.png".match(ATTACHMENT_API_RE);
        expect(m?.[1]).toBe("att_XYZ");
    });

    it("does not match note image URLs", () => {
        expect(ATTACHMENT_API_RE.test("/api/images/abc123/note.png")).toBe(false);
    });

    it("does not match unrelated URLs", () => {
        expect(ATTACHMENT_API_RE.test("https://example.com/attachments/foo")).toBe(false);
    });
});

describe("loadIncludedNote", () => {
    beforeEach(() => {
        vi.mocked(froca.getNote).mockResolvedValue(note);
        vi.mocked(link.createLink).mockResolvedValue($('<span class="link"><a href="#">noteY</a></span>'));
        vi.mocked(content_renderer.getRenderedContent).mockResolvedValue({ $renderedContent: $("<p>body</p>"), type: "text" } as never);
        vi.mocked(content_renderer.disposeInteractiveContent).mockReset();
    });

    it("reuses the wrapper element without nesting a second one (editing-view path)", async () => {
        const $el = $('<div class="include-note-wrapper">');

        await loadIncludedNote("noteY", $el, "small");

        const wrappers = $el.find(".include-note-wrapper");
        expect(wrappers.length).toBe(0);
        expect($el.children(".include-note-title").length).toBe(1);
        expect($el.children(".include-note-content").length).toBe(1);
    });

    it("builds a single wrapper inside the section (read-only / refresh path)", async () => {
        const $el = $('<section class="include-note" data-note-id="noteY">');

        await loadIncludedNote("noteY", $el, "small");

        const wrappers = $el.find(".include-note-wrapper");
        expect(wrappers.length).toBe(1);
        expect(wrappers.children(".include-note-title").length).toBe(1);
        expect(wrappers.children(".include-note-content").length).toBe(1);
    });

    it("builds an expandable include (toggle) and degrades the note's own includes to reference links", async () => {
        const $el = $('<div class="include-note-wrapper">');

        await loadIncludedNote("noteY", $el, "expandable");

        // The expandable branch adds a title row with a toggle button.
        expect($el.children(".include-note-title-row").length).toBe(1);
        expect($el.find("button.include-note-toggle").length).toBe(1);
        // The included note is rendered with its own includes reduced to reference links.
        expect(content_renderer.getRenderedContent).toHaveBeenCalledWith(note, { interactive: true, includesAsReferenceLinks: true, mediaEnvironment: "embedded" });
    });

    it("disposes interactive content of a previous render before replacing it", async () => {
        const $el = $('<div class="include-note-wrapper">');

        await loadIncludedNote("noteY", $el, "small");

        expect(content_renderer.disposeInteractiveContent).toHaveBeenCalledWith($el);
    });
});