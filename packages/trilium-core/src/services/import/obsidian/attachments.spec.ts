import { beforeEach, describe, expect, it, vi } from "vitest";

import type BNote from "../../../becca/entities/bnote.js";
import imageService from "../../image.js";
import { applyAttachments, type AttachmentIndex, buildAttachmentIndex, isImageMime, resolveAttachment } from "./attachments.js";

/** Spy on the shared imageService object the importer imports — `saveImageToAttachment` would otherwise hit the DB. */
const saveImageToAttachment = vi.spyOn(imageService, "saveImageToAttachment");

/** A stub note that records `saveAttachment` calls and hands back a deterministic attachment id per title. */
function fakeNote() {
    const saveAttachment = vi.fn(({ title }: { title: string }) => ({ attachmentId: `att-${title}` }));
    const note = { noteId: "note1", saveAttachment } as unknown as BNote;
    return { note, saveAttachment };
}

/** Builds an attachment index from a `path -> placeholder bytes` map (bytes content is irrelevant to resolution). */
function indexOf(...paths: string[]): AttachmentIndex {
    return buildAttachmentIndex(new Map(paths.map((p) => [p, new Uint8Array([1])])));
}

beforeEach(() => {
    saveImageToAttachment.mockReset();
    saveImageToAttachment.mockReturnValue({ attachmentId: "img1", title: "picture.png" } as ReturnType<typeof imageService.saveImageToAttachment>);
});

describe("buildAttachmentIndex", () => {
    it("groups paths under their lower-cased base name", () => {
        const index = indexOf("Folder/Picture.PNG", "Other/picture.png", "doc.pdf");
        expect(index.byBasename.get("picture.png")).toEqual(["Folder/Picture.PNG", "Other/picture.png"]);
        expect(index.byBasename.get("doc.pdf")).toEqual(["doc.pdf"]);
    });
});

describe("resolveAttachment", () => {
    it("resolves an exact vault path first", () => {
        const resolved = resolveAttachment(indexOf("Folder/doc.pdf"), "Folder/doc.pdf");
        expect(resolved).toMatchObject({ path: "Folder/doc.pdf", mime: "application/pdf" });
    });

    it("falls back to a unique base-name match (Obsidian shortest-path rule)", () => {
        const resolved = resolveAttachment(indexOf("Folder/picture.png"), "picture.png");
        expect(resolved?.path).toBe("Folder/picture.png");
    });

    it("returns null for an ambiguous base name shared by two files", () => {
        expect(resolveAttachment(indexOf("a/pic.png", "b/pic.png"), "pic.png")).toBeNull();
    });

    it("returns null when nothing matches", () => {
        expect(resolveAttachment(indexOf("doc.pdf"), "missing.png")).toBeNull();
    });

    it("falls back to application/octet-stream for an unknown extension", () => {
        expect(resolveAttachment(indexOf("data.unknownext"), "data.unknownext")?.mime).toBe("application/octet-stream");
    });
});

describe("isImageMime", () => {
    it("is true only for image/* mimes", () => {
        expect(isImageMime("image/png")).toBe(true);
        expect(isImageMime("application/pdf")).toBe(false);
    });
});

describe("applyAttachments", () => {
    it("returns the html untouched when the index is empty or there are no img/a elements", () => {
        const html = `<p><img src="/picture.png"></p>`;
        expect(applyAttachments(fakeNote().note, html, buildAttachmentIndex(new Map()), false)).toBe(html);
        expect(applyAttachments(fakeNote().note, "<p>plain text</p>", indexOf("picture.png"), false)).toBe("<p>plain text</p>");
    });

    it("saves a resolved image embed as an inline image attachment and rewrites its src", () => {
        const { note } = fakeNote();
        const consumed = new Set<string>();
        const html = applyAttachments(note, `<p><img src="/picture.png"></p>`, indexOf("picture.png"), true, consumed);

        expect(saveImageToAttachment).toHaveBeenCalledWith("note1", expect.any(Uint8Array), "picture.png", true);
        expect(html).toBe(`<p><img src="api/attachments/img1/image/picture.png"></p>`);
        expect([...consumed]).toEqual(["picture.png"]);
    });

    it("carries an Obsidian |size suffix over as the image width", () => {
        const { note } = fakeNote();
        const html = applyAttachments(note, `<p><img src="/picture.png|120"></p>`, indexOf("picture.png"), false);
        expect(html).toContain(`width="120"`);
    });

    it("falls back to a file link when saving the image attachment throws", () => {
        const { note, saveAttachment } = fakeNote();
        saveImageToAttachment.mockImplementationOnce(() => {
            throw new Error("image save failed");
        });
        const html = applyAttachments(note, `<p><img src="/picture.png"></p>`, indexOf("picture.png"), false);

        expect(saveAttachment).toHaveBeenCalledWith(expect.objectContaining({ role: "file", title: "picture.png" }));
        expect(html).toContain(`class="reference-link"`);
        expect(html).not.toContain("<img");
    });

    it("turns an embedded non-image file into a file-reference link", () => {
        const { note, saveAttachment } = fakeNote();
        const html = applyAttachments(note, `<p><img src="/report.pdf"></p>`, indexOf("report.pdf"), false);

        expect(saveAttachment).toHaveBeenCalledWith(expect.objectContaining({ role: "file", mime: "application/pdf", title: "report.pdf" }));
        expect(html).toContain(`<a class="reference-link" href="#root/note1?viewMode=attachments&attachmentId=att-report.pdf">report.pdf</a>`);
        expect(html).not.toContain("<img");
    });

    it("rewrites a link that resolves to a bundled file into a file-reference link", () => {
        const { note } = fakeNote();
        const consumed = new Set<string>();
        const html = applyAttachments(note, `<p><a href="/report.pdf">report</a></p>`, indexOf("report.pdf"), false, consumed);

        expect(html).toContain(`href="#root/note1?viewMode=attachments&attachmentId=att-report.pdf"`);
        expect(html).toContain(`class="reference-link"`);
        expect([...consumed]).toEqual(["report.pdf"]);
    });

    it("leaves img/a references that don't resolve to a bundled file untouched", () => {
        const { note, saveAttachment } = fakeNote();
        const html = `<p><img src="/missing.png"><a href="/missing.pdf">x</a></p>`;
        expect(applyAttachments(note, html, indexOf("report.pdf"), false)).toBe(html);
        expect(saveAttachment).not.toHaveBeenCalled();
        expect(saveImageToAttachment).not.toHaveBeenCalled();
    });

    it("never touches external URLs, data/mailto schemes or in-note anchors", () => {
        const { note } = fakeNote();
        const html =
            `<p><img src="https://x/y.png"><img src="data:image/png;base64,AAAA">` +
            `<a href="mailto:a@b.com">m</a><a href="#section">anchor</a></p>`;
        expect(applyAttachments(note, html, indexOf("y.png"), false)).toBe(html);
    });

    it("strips a #heading suffix, normalizes backslashes and url-decodes the reference", () => {
        const { note } = fakeNote();
        // `Sub Folder\pic.png#frag` — backslashes become slashes, the fragment is dropped, %20 decoded.
        applyAttachments(note, `<p><img src="/Sub%20Folder\\pic.png#frag"></p>`, indexOf("Sub Folder/pic.png"), false);
        expect(saveImageToAttachment).toHaveBeenCalledWith("note1", expect.any(Uint8Array), "pic.png", false);
    });

    it("ignores a non-numeric |suffix (it carries no width) and skips an empty reference", () => {
        const { note } = fakeNote();
        // `picture.png|caption` — the alias isn't a size, so no width attribute is added.
        const sized = applyAttachments(note, `<p><img src="/picture.png|caption"></p>`, indexOf("picture.png"), false);
        expect(sized).toContain(`src="api/attachments/img1/image/picture.png"`);
        expect(sized).not.toContain("width");

        // `/|100` reduces to an empty reference once the |size is peeled off, so the img is left untouched.
        const empty = `<p><img src="/|100"></p>`;
        expect(applyAttachments(fakeNote().note, empty, indexOf("picture.png"), false)).toBe(empty);
    });

    it("keeps the original value when the reference cannot be url-decoded", () => {
        const { note } = fakeNote();
        // A malformed percent-escape makes decodeURIComponent throw; the raw name is used and resolves directly.
        applyAttachments(note, `<p><img src="/%E0%A4.png"></p>`, indexOf("%E0%A4.png"), false);
        expect(saveImageToAttachment).toHaveBeenCalled();
    });
});
