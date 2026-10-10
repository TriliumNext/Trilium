import { afterEach, describe, expect, it } from "vitest";

import {
    getAttachmentImageUrl, getNoteImageUrl, resolveContentImageUrls, setImageUrlResolver
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
});
