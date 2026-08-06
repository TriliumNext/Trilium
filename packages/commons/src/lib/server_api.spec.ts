import { describe, expect, it } from "vitest";

import { IMAGE_COMPRESSIBLE_FORMATS, IMAGE_JPEG_HANDLINGS, IMAGE_PNG_HANDLINGS } from "./server_api.js";

/**
 * The vocabularies image compression is spoken in.
 *
 * They read like internal enums and are not: each of these strings is written into a user's
 * `imageCompressionToolOptions` and `cleanupToolOptions` settings, sent across the API, and
 * validated against on the way back in. Renaming one does not break a build — the type is derived
 * from the array, so everything still compiles — it silently invalidates every choice already
 * stored, which then falls back to a default the user did not pick.
 */
describe("image compression vocabularies", () => {
    it("names what can become of each kind of image, in the order the choice is offered", () => {
        // The order is user-visible: the dialog lays its segmented buttons out in it, and both
        // lists open on leaving the image alone — the one choice that can never cost anything.
        expect([ ...IMAGE_PNG_HANDLINGS ]).toEqual([ "keep", "optimize", "jpeg" ]);
        expect([ ...IMAGE_JPEG_HANDLINGS ]).toEqual([ "keep", "compress" ]);
    });

    it("lists the formats a run can act on", () => {
        // "jpg" rather than "jpeg", these being the extensions image detection reports rather than
        // mime types — the distinction that had every JPEG note, stored as the invented mime
        // `image/jpg`, reported as a format that could not be compressed.
        expect([ ...IMAGE_COMPRESSIBLE_FORMATS ]).toEqual([ "jpg", "png" ]);
    });

    it("offers each choice once, so nothing can be picked two ways", () => {
        for (const vocabulary of [ IMAGE_PNG_HANDLINGS, IMAGE_JPEG_HANDLINGS, IMAGE_COMPRESSIBLE_FORMATS ]) {
            expect(new Set(vocabulary).size).toBe(vocabulary.length);
        }
    });
});
