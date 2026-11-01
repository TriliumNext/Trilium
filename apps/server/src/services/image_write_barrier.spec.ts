import { becca, cls, getSql, imageService, options } from "@triliumnext/core";
import { awaitPendingImageWrites } from "@triliumnext/core/src/services/image.js";
import { CoreApiTester } from "@triliumnext/core/src/test/api_tester.js";
import { Jimp } from "jimp";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * What "the import has finished" is worth.
 *
 * An image note is created at once and empty, and filled in when the compression it was handed to
 * answers — which is what stops an upload blocking on a decode. Between the two the note exists
 * holding nothing, and for a few hundred images that gap is minutes long. An import that reports
 * success in the middle of it is reporting something untrue, and a process stopped there leaves
 * those notes empty for good, since nothing anywhere records that they are owed anything.
 *
 * So the debt is written down as it is incurred, and the barrier below is what an importer waits on.
 */
let photo: Uint8Array;

beforeAll(async () => {
    CoreApiTester.build();

    // Large enough that compressing it is real work rather than something that could finish within
    // the same turn by accident — the gap this is about has to actually be open.
    const image = new Jimp({ width: 900, height: 700, color: 0x3366ccff });

    for (let x = 0; x < 900; x++) {
        for (let y = 0; y < 700; y++) {
            image.setPixelColor((((x * 7919 + y * 104729) & 0xffffff) << 8 | 0xff) >>> 0, x, y);
        }
    }

    photo = new Uint8Array(await image.getBuffer("image/png"));

    cls.init(() => {
        options.setOption("compressImages", "true");
        options.setOption("imageResize", "true");
        options.setOption("imageMaxWidthHeight", "200");
    });
}, 120000);

describe("waiting for the images an import is owed", () => {
    it("holds until every note handed over has its content, however many are in flight", async () => {
        const noteIds = cls.init(() => getSql().transactional(() =>
            // As an import does it: one call per image, none of them awaited, all still going when
            // the last returns.
            Array.from({ length: 12 }, (_, index) =>
                imageService.saveImage("root", photo, `photo${index}.png`, true).noteId)));

        // The notes exist and are empty, which is exactly the state an import used to report as
        // success — and which a restart here would make permanent.
        expect(noteIds).toHaveLength(12);
        expect(sizes(noteIds).filter((size) => size === 0).length).toBeGreaterThan(0);

        await awaitPendingImageWrites();

        // Every one of them stored, and stored smaller: 900x700 against a bound of 200.
        expect(sizes(noteIds).filter((size) => size === 0)).toEqual([]);
        sizes(noteIds).forEach((size) => expect(size).toBeLessThan(photo.byteLength));
    }, 120000);

    it("comes straight back when nothing is owed", async () => {
        await awaitPendingImageWrites();
        await expect(awaitPendingImageWrites()).resolves.toBeUndefined();
    });
});

function sizes(noteIds: string[]): number[] {
    return cls.init(() => noteIds.map((noteId) => becca.getNoteOrThrow(noteId).getContent().length));
}
