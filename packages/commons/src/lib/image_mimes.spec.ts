import { describe, expect, it } from "vitest";

import { IMAGE_MIMES, IMAGE_UPLOAD_SUBTYPES, imageExtensionForMime, imageMimeForExtension, isAcceptedImageMime } from "./image_mimes.js";

describe("isAcceptedImageMime", () => {
    it("accepts every listed type and nothing else", () => {
        for (const mime of IMAGE_MIMES) {
            expect(isAcceptedImageMime(mime), mime).toBe(true);
        }

        // TIFF is deliberately absent: an <img> cannot draw one outside Safari, so it is stored as
        // a file and gets a working reference link rather than a picture that never appears.
        for (const mime of [ "image/tiff", "application/pdf", "text/plain", "image/", "png" ]) {
            expect(isAcceptedImageMime(mime), mime).toBe(false);
        }

        expect(isAcceptedImageMime(undefined)).toBe(false);
        expect(isAcceptedImageMime(null)).toBe(false);
        expect(isAcceptedImageMime("")).toBe(false);
    });

    it("recognises both spellings of an icon, and both of an SVG", () => {
        // Servers send either icon spelling, and `image/svg` turns up in place of the registered
        // `image/svg+xml` often enough to be worth recognising.
        for (const mime of [ "image/x-icon", "image/vnd.microsoft.icon", "image/svg", "image/svg+xml" ]) {
            expect(isAcceptedImageMime(mime), mime).toBe(true);
        }
    });
});

describe("imageExtensionForMime", () => {
    it("names a format the way people write it, not the way its subtype reads", () => {
        // The whole reason this exists: stripping the punctuation out of a subtype turns an icon
        // into ".xicon" and an SVG into ".svgxml", which is what a favicon attachment used to be
        // called.
        expect(imageExtensionForMime("image/x-icon")).toBe("ico");
        expect(imageExtensionForMime("image/vnd.microsoft.icon")).toBe("ico");
        expect(imageExtensionForMime("image/svg+xml")).toBe("svg");
    });

    it("takes the subtype where the subtype is the name", () => {
        expect(imageExtensionForMime("image/png")).toBe("png");
        expect(imageExtensionForMime("image/jpeg")).toBe("jpeg");
        expect(imageExtensionForMime("image/webp")).toBe("webp");
        expect(imageExtensionForMime("image/avif")).toBe("avif");
        expect(imageExtensionForMime("image/bmp")).toBe("bmp");
    });

    it("reads a media type however it was written, and falls back where it cannot", () => {
        expect(imageExtensionForMime("IMAGE/X-ICON")).toBe("ico");
        expect(imageExtensionForMime("  image/x-icon  ")).toBe("ico");
        expect(imageExtensionForMime("nonsense")).toBe("png");
        expect(imageExtensionForMime(undefined)).toBe("png");
        expect(imageExtensionForMime("", "bin")).toBe("bin");
    });

    it("gives every accepted media type a usable extension", () => {
        for (const mime of IMAGE_MIMES) {
            expect(imageExtensionForMime(mime), mime).toMatch(/^[a-z0-9]+$/);
        }
    });
});

describe("imageMimeForExtension", () => {
    it("reverses the overrides, naming an icon the way servers do", () => {
        // Two media types share ".ico"; the one a reader will recognise wins.
        expect(imageMimeForExtension("ico")).toBe("image/x-icon");
        expect(imageMimeForExtension("svg")).toBe("image/svg+xml");
    });

    it("builds the media type from the extension otherwise", () => {
        expect(imageMimeForExtension("png")).toBe("image/png");
        expect(imageMimeForExtension("webp")).toBe("image/webp");
        expect(imageMimeForExtension(".PNG")).toBe("image/png");
        expect(imageMimeForExtension(undefined)).toBe("image/png");
    });

    it("round-trips every extension it produces back to an accepted media type", () => {
        // What the two are for: an upload is named by its media type on the way out and stored
        // under a media type derived from its format on the way back in, so a format that survives
        // one direction but not the other would be stored as something the endpoints reject.
        for (const mime of IMAGE_MIMES) {
            const roundTripped = imageMimeForExtension(imageExtensionForMime(mime));
            expect(isAcceptedImageMime(roundTripped), `${mime} -> ${roundTripped}`).toBe(true);
        }
    });
});

describe("IMAGE_UPLOAD_SUBTYPES", () => {
    it("is the same list with the type stripped, in the same order", () => {
        expect(IMAGE_UPLOAD_SUBTYPES).toStrictEqual(IMAGE_MIMES.map((mime) => mime.replace("image/", "")));
        // The editor builds `^image/(<joined>)$` out of these, so a subtype carrying the prefix
        // would silently match nothing.
        for (const subtype of IMAGE_UPLOAD_SUBTYPES) {
            expect(subtype, subtype).not.toContain("/");
        }
    });
});
