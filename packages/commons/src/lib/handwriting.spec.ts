import { describe, expect, it } from "vitest";

import { HANDWRITING_FORMAT_VERSION, serializeImportedHandwriting } from "./handwriting.js";

describe("serializeImportedHandwriting", () => {
    it("lists the images, the strokes and the text boxes as objects, in the order they are drawn", () => {
        const url = "api/attachments/abc/image/a.png";
        const content = serializeImportedHandwriting({
            paper: "grid",
            strokes: [ JSON.stringify({ w: 3, p: [ 1, 2, 128 ] }), JSON.stringify({ t: "h", w: 20, p: [ 3, 4, 128 ] }) ],
            images: [ { url, x: 10.04, y: 20, w: 300.26, h: 150 } ],
            texts: [ { id: "box", x: 1.04, y: 2, w: 100, s: 12.04, html: "<p>a</p>" }, { id: "plain", x: 0, y: 0, w: 50, html: "" } ]
        });
        expect(JSON.parse(content)).toEqual({
            version: HANDWRITING_FORMAT_VERSION, paper: "grid", layout: "infinite",
            objects: [
                { o: "image", id: "i1", url, x: 10, y: 20, w: 300.3, h: 150 },
                { id: "s1", w: 3, p: [ 1, 2, 128 ] },
                { id: "s2", t: "h", w: 20, p: [ 3, 4, 128 ] },
                { o: "text", id: "box", x: 1, y: 2, w: 100, s: 12, html: "<p>a</p>" },
                { o: "text", id: "plain", x: 0, y: 0, w: 50, html: "" }
            ]
        });
        expect(JSON.parse(serializeImportedHandwriting({ paper: "blank", strokes: [] })).objects).toEqual([]);
    });
});
