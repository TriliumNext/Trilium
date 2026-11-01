import { afterEach, describe, expect, it } from "vitest";

import {
    applyNoteImageVersions, getAttachmentImageUrl, getNoteImageSourceToLoad, getNoteImageUrl,
    invalidateNoteImages, resolveContentImageUrls, setImageUrlResolver, stripNoteImageVersion
} from "./image_urls.js";

describe("image URLs", () => {
    afterEach(() => {
        setImageUrlResolver(undefined);
    });

    it("points at the API, unless the resolver finds the image elsewhere", () => {
        expect(getNoteImageUrl("note1", "A b/c", "v=1")).toBe("api/images/note1/A%20b%2Fc?v=1");
        expect(getAttachmentImageUrl("att1", "x.png")).toBe("api/attachments/att1/image/x.png");

        setImageUrlResolver((target) => ("noteId" in target
            ? (target.noteId === "note1" ? "../files/note1.png" : null)
            : `../files/${target.attachmentId}.svg`));
        expect(getNoteImageUrl("note1", "A", "v=1")).toBe("../files/note1.png");
        expect(getNoteImageUrl("note2", "B")).toBe("api/images/note2/B");
        expect(getAttachmentImageUrl("att1", "x.png", "1")).toBe("../files/att1.svg");
    });

    it("points the images a note's HTML embeds where the resolver finds them", () => {
        const html = `<img src="api/images/note1/A?123"><img src="api/images/note2/B">`
            + `<section data-image="api/attachments/att1/image/x.png" data-favicon="https://a/b.ico">`
            + `<img src="../../api/attachments/att2/image/y.svg"><a href="api/images/note1/A">`;
        expect(resolveContentImageUrls(html)).toBe(html);

        setImageUrlResolver((target) => ("noteId" in target
            ? (target.noteId === "note1" ? "files/note1.png" : null)
            : `files/${target.attachmentId}`));
        expect(resolveContentImageUrls(html)).toBe(`<img src="files/note1.png">`
            + `<img src="api/images/note2/B">`
            + `<section data-image="files/att1" data-favicon="https://a/b.ico">`
            + `<img src="files/att2"><a href="api/images/note1/A">`);
    });

    it("adds a new version to the URL of a note image each time the note changes", () => {
        expect(getNoteImageSourceToLoad("api/images/fresh1/A")).toBe("api/images/fresh1/A");

        invalidateNoteImages([ "canvas1" ]);
        const first = getNoteImageSourceToLoad("api/images/canvas1/A%20b");
        expect(first).toMatch(/^api\/images\/canvas1\/A%20b\?v=\d+$/);
        expect(getNoteImageSourceToLoad("api/images/other1/A")).toBe("api/images/other1/A");
        expect(getNoteImageSourceToLoad("api/attachments/canvas1/image/x.png"))
            .toBe("api/attachments/canvas1/image/x.png");

        invalidateNoteImages([ "canvas1" ]);
        const second = getNoteImageSourceToLoad(first);
        expect(second).not.toBe(first);
        expect(second).toMatch(/^api\/images\/canvas1\/A%20b\?v=\d+$/);
        expect(stripNoteImageVersion(second)).toBe("api/images/canvas1/A%20b");
        expect(getNoteImageSourceToLoad("../api/images/canvas1/A?x=1")).toMatch(/\?x=1&v=\d+$/);
    });

    it("points the note images of rendered content at their current version", () => {
        invalidateNoteImages([ "rendered1" ]);
        const container = document.createElement("div");
        container.innerHTML = `<img src="api/images/rendered1/A"><img src="api/images/still1/B">`
            + `<img src="https://example.com/c.png">`;

        applyNoteImageVersions(container);

        const sources = [ ...container.querySelectorAll("img") ]
            .map((img) => img.getAttribute("src"));
        expect(sources[0]).toMatch(/^api\/images\/rendered1\/A\?v=\d+$/);
        expect(sources.slice(1)).toEqual([ "api/images/still1/B", "https://example.com/c.png" ]);
    });
});
