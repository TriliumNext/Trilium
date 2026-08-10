import type { ImageInventoryResponse } from "@triliumnext/commons";
import { becca, cls, getSql, options } from "@triliumnext/core";
import { createTextNote } from "@triliumnext/core/src/test/api_fixtures.js";
import { CoreApiTester } from "@triliumnext/core/src/test/api_tester.js";
import { Jimp } from "jimp";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * Drives the inventory endpoint against real notes and attachments holding real image bytes, so
 * what it reports is read off actual headers rather than anything the test arranged.
 *
 * The service itself is runtime-agnostic — it never decodes — but the fixtures are easiest to build
 * with the image library, which is why the spec lives here.
 */
let api: CoreApiTester;

/** 600x400, comfortably over the bounds these tests measure against. */
let widePng: Uint8Array;
let wideJpeg: Uint8Array;
/** 100x80, comfortably under them. */
let smallPng: Uint8Array;
/** Not a format anything can compress. */
const gif = Uint8Array.from(
    Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")
);
const svg = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`);

beforeAll(async () => {
    widePng = await paint(600, 400, "image/png");
    wideJpeg = await paint(600, 400, "image/jpeg");
    smallPng = await paint(100, 80, "image/png");
}, 60000);

async function paint(width: number, height: number, mime: "image/png" | "image/jpeg"): Promise<Uint8Array> {
    const image = new Jimp({ width, height, color: 0x000000ff });
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            const r = Math.round(128 + 127 * Math.sin(x / 40));
            const g = Math.round(128 + 127 * Math.sin(y / 30));
            const b = Math.round(128 + 127 * Math.sin((x + y) / 50));
            image.setPixelColor((((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0), x, y);
        }
    }

    return new Uint8Array(await image.getBuffer(mime));
}

afterEach(() => {
    cls.init(() => options.setOption("imageMaxWidthHeight", "2000"));
});

const inventoryOf = (noteId: string, query = "") =>
    api.get<ImageInventoryResponse>(`/api/notes/${noteId}/image-inventory${query}`);

describe("image inventory (GET /api/notes/:noteId/image-inventory)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    it("404s for a note that does not exist", async () => {
        expect((await inventoryOf("missingNote123")).status).toBe(404);
    });

    it("reports nothing at all for a note holding no images", async () => {
        const { noteId } = await createTextNote(api);

        const res = await inventoryOf(noteId);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            total: { count: 0, size: 0 },
            compressible: { count: 0, size: 0 },
            oversized: { count: 0, size: 0 },
            formats: [],
            unreadable: 0
        });
    });

    it("counts and weighs the images a note holds, format by format", async () => {
        const { noteId } = await createTextNote(api);
        await addAttachment(noteId, "a.png", widePng);
        await addAttachment(noteId, "b.png", smallPng);
        await addAttachment(noteId, "c.jpg", wideJpeg, "image/jpeg");
        // Not an image at all: attachments of other roles are no part of the reading.
        await addAttachment(noteId, "notes.txt", new Uint8Array([ 1, 2, 3 ]), "text/plain", "file");

        const res = await inventoryOf(noteId);

        expect(res.body.total.count).toBe(3);
        expect(res.body.total.size).toBe(widePng.byteLength + smallPng.byteLength + wideJpeg.byteLength);
        // Every one of them is a format a run could act on.
        expect(res.body.compressible).toEqual(res.body.total);

        expect(res.body.formats).toEqual([
            { format: "png", count: 2, size: widePng.byteLength + smallPng.byteLength },
            { format: "jpg", count: 1, size: wideJpeg.byteLength }
        ]);
    });

    it("orders the formats by what they weigh, the reason for looking at all", async () => {
        const { noteId } = await createTextNote(api);
        await addAttachment(noteId, "small.png", smallPng);
        await addAttachment(noteId, "big.jpg", wideJpeg, "image/jpeg");

        const res = await inventoryOf(noteId);

        expect(res.body.formats.map((entry) => entry.format)).toEqual([ "jpg", "png" ]);
    });

    it("counts a format nothing can compress, without calling it compressible", async () => {
        const { noteId } = await createTextNote(api);
        await addAttachment(noteId, "a.png", widePng);
        await addAttachment(noteId, "b.gif", gif, "image/gif");
        await addAttachment(noteId, "c.svg", svg, "image/svg+xml");

        const res = await inventoryOf(noteId);

        // All three are images the note holds; only one is an image a run could act on.
        expect(res.body.total.count).toBe(3);
        expect(res.body.compressible).toEqual({ count: 1, size: widePng.byteLength });
        expect(res.body.formats.map((entry) => entry.format).sort()).toEqual([ "gif", "png", "svg" ]);
        // What a caller offers settings for: only formats it could actually apply them to.
        expect(res.body.compressibleFormats).toEqual([ "png" ]);
    });

    it("names a format as compressible only where an image of it could actually be acted on", async () => {
        const { noteId } = await createTextNote(api);
        await addAttachment(noteId, "a.jpg", wideJpeg, "image/jpeg");
        // The one PNG here is the picture the note regenerates on save, which a run leaves alone —
        // so a PNG is present, and yet there is nothing a PNG setting could be applied to.
        await addAttachment(noteId, "spreadsheet-export.png", widePng);
        setNoteType(noteId, "spreadsheet");

        const res = await inventoryOf(noteId);

        expect(res.body.formats.map((entry) => entry.format).sort()).toEqual([ "jpg", "png" ]);
        expect(res.body.compressibleFormats).toEqual([ "jpg" ]);
    });

    it("orders the compressible formats as it orders the rest, heaviest first", async () => {
        const { noteId } = await createTextNote(api);
        await addAttachment(noteId, "small.png", smallPng);
        await addAttachment(noteId, "big.jpg", wideJpeg, "image/jpeg");

        expect((await inventoryOf(noteId)).body.compressibleFormats).toEqual([ "jpg", "png" ]);
    });

    describe("what counts as oversized", () => {
        it("measures the longest edge against the given bound", async () => {
            const { noteId } = await createTextNote(api);
            await addAttachment(noteId, "wide.png", widePng);
            await addAttachment(noteId, "small.png", smallPng);

            const res = await inventoryOf(noteId, "?maxWidthHeight=500");

            expect(res.body.oversized).toEqual({ count: 1, size: widePng.byteLength });
            expect(res.body.maxWidthHeight).toBe(500);
        });

        it("counts none once the bound is above them all", async () => {
            const { noteId } = await createTextNote(api);
            await addAttachment(noteId, "wide.png", widePng);

            expect((await inventoryOf(noteId, "?maxWidthHeight=1000")).body.oversized.count).toBe(0);
        });

        it("falls back to the imageMaxWidthHeight option when no bound is given", async () => {
            cls.init(() => options.setOption("imageMaxWidthHeight", "500"));
            const { noteId } = await createTextNote(api);
            await addAttachment(noteId, "wide.png", widePng);

            const res = await inventoryOf(noteId);

            expect(res.body.maxWidthHeight).toBe(500);
            expect(res.body.oversized.count).toBe(1);
        });

        it("never counts an image no bound could reach", async () => {
            const { noteId } = await createTextNote(api);
            // A GIF is never resized, whatever its dimensions, so it is never oversized either.
            await addAttachment(noteId, "a.gif", gif, "image/gif");

            expect((await inventoryOf(noteId, "?maxWidthHeight=1")).body.oversized.count).toBe(0);
        });
    });

    describe("how far the reading reaches", () => {
        it("counts an image note's own image, not its attachments", async () => {
            const noteId = await createImageNote(widePng);

            const res = await inventoryOf(noteId);

            expect(res.body.total).toEqual({ count: 1, size: widePng.byteLength });
        });

        it("stops at the note unless asked to descend", async () => {
            const { noteId } = await createTextNote(api);
            await addAttachment(noteId, "own.png", smallPng);
            await createImageNote(widePng, noteId);

            expect((await inventoryOf(noteId)).body.total.count).toBe(1);
        });

        it("takes in the child notes' own images too, once descending", async () => {
            const { noteId } = await createTextNote(api);
            await addAttachment(noteId, "own.png", smallPng);
            await addAttachment(noteId, "own.jpg", wideJpeg, "image/jpeg");
            const childId = await createImageNote(widePng, noteId);
            await createImageNote(smallPng, childId);

            const res = await inventoryOf(noteId, "?recursive=true");

            // Two attachments here, plus the child image note and the grandchild.
            expect(res.body.total.count).toBe(4);
            expect(res.body.formats.find((entry) => entry.format === "jpg")).toEqual({
                format: "jpg", count: 1, size: wideJpeg.byteLength
            });
        });

        it("reads an image note as its own image alone, attachments hanging off it included", async () => {
            const { noteId } = await createTextNote(api);
            const childId = await createImageNote(widePng, noteId);
            // An image note *is* its image; anything else attached to one is not a second picture
            // of it. Pinned here because a run visits exactly the same set, and would skip this too.
            await addAttachment(childId, "sidecar.jpg", wideJpeg, "image/jpeg");

            const res = await inventoryOf(noteId, "?recursive=true");

            expect(res.body.total).toEqual({ count: 1, size: widePng.byteLength });
        });

        it("counts a clone once, however often it is placed in the subtree", async () => {
            const { noteId } = await createTextNote(api);
            const childId = await createImageNote(widePng, noteId);
            await api.put(`/api/notes/${childId}/clone-to-note/${noteId}`);

            expect((await inventoryOf(noteId, "?recursive=true")).body.total.count).toBe(1);
        });
    });

    it("counts the generated picture of a note, without offering it to be compressed", async () => {
        const { noteId } = await createTextNote(api);
        await addAttachment(noteId, "spreadsheet-export.png", widePng);
        setNoteType(noteId, "spreadsheet");

        const res = await inventoryOf(noteId);

        // It is an image the note holds, so it is counted; a run would leave it alone, so it is not
        // counted as something compressing could reach.
        expect(res.body.total).toEqual({ count: 1, size: widePng.byteLength });
        expect(res.body.compressible).toEqual({ count: 0, size: 0 });
    });

    it("says how many images it could not read rather than weighing them at nothing", async () => {
        const noteId = await createImageNote(widePng);
        cls.init(() => { becca.getNoteOrThrow(noteId).isProtected = true; });

        const res = await inventoryOf(noteId);

        expect(res.body.unreadable).toBe(1);
        expect(res.body.total).toEqual({ count: 0, size: 0 });

        cls.init(() => { becca.getNoteOrThrow(noteId).isProtected = false; });
    });

    it.each([
        [ "a bound that is not a number", "?maxWidthHeight=lots" ],
        [ "a fractional bound", "?maxWidthHeight=10.5" ],
        [ "a bound of zero", "?maxWidthHeight=0" ],
        [ "an empty bound", "?maxWidthHeight=" ],
        [ "a recursive flag that is neither", "?recursive=perhaps" ]
    ])("400s on %s rather than falling back to a default", async (_label, query) => {
        const { noteId } = await createTextNote(api);

        expect((await inventoryOf(noteId, query)).status).toBe(400);
    });
});

/** Creates a real image note holding the given bytes and returns its noteId. */
async function createImageNote(content: Uint8Array, parentNoteId = "root"): Promise<string> {
    const { noteId } = await createTextNote(api, { parentNoteId });

    cls.init(() => getSql().transactional(() => {
        const note = becca.getNoteOrThrow(noteId);
        note.type = "image";
        note.mime = "image/png";
        note.save();
        note.setContent(content, { forceSave: true });
    }));

    return noteId;
}

async function addAttachment(
    noteId: string,
    title: string,
    content: Uint8Array,
    mime = "image/png",
    role = "image"
): Promise<string> {
    return cls.init(() => getSql().transactional(() => {
        const attachment = becca.getNoteOrThrow(noteId).saveAttachment({ role, mime, title, content }, "title");
        return attachment.attachmentId ?? "";
    }));
}

function setNoteType(noteId: string, type: string) {
    cls.init(() => getSql().transactional(() => {
        const note = becca.getNoteOrThrow(noteId);
        note.type = type as never;
        note.mime = "application/json";
        note.save();
    }));
}
