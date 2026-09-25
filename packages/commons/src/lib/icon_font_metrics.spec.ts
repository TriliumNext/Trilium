import { describe, expect, it } from "vitest";

import { iconFontFaceOverrides, measureIconFont } from "./icon_font_metrics.js";

/** Ink centres for a pack drawn `offset` units above the baseline, with a little scatter. */
function pack(offset: number, count = 20) {
    return Array.from({ length: count }, (_, index) => offset + (index % 5) - 2);
}

describe("measureIconFont", () => {
    it("splits the em around the middle of the ink", () => {
        // Boxicons 2: 1024 units to the em, drawn 448 of them above the baseline.
        expect(measureIconFont(1024, pack(448))).toEqual({ ascent: 0.9375, descent: 0.0625 });

        // Boxicons 3: the em sits on the baseline, so the box is all ascent.
        expect(measureIconFont(300, pack(150))).toEqual({ ascent: 1, descent: 0 });

        // Material Design Icons: 512 units to the em, 192 above the baseline.
        expect(measureIconFont(512, pack(192))).toEqual({ ascent: 0.875, descent: 0.125 });

        // A pack of an odd number of glyphs, where the middle one is the median outright.
        expect(measureIconFont(1024, pack(448, 21))).toEqual({ ascent: 0.9375, descent: 0.0625 });
    });

    it("takes the middle of the pack, not the icons drawn off centre on purpose", () => {
        const centres = [ ...pack(448), 0, 12, 1000, 1010 ];

        expect(measureIconFont(1024, centres)).toEqual({ ascent: 0.9375, descent: 0.0625 });
    });

    it("declines a font it cannot read a box out of", () => {
        expect(measureIconFont(0, pack(448))).toBeNull();
        expect(measureIconFont(-1024, pack(448))).toBeNull();
        expect(measureIconFont(1024, [])).toBeNull();
        expect(measureIconFont(1024, pack(448, 7))).toBeNull();

        // Ink so far from the em that the overrides would come out negative.
        expect(measureIconFont(1024, pack(-900))).toBeNull();
        expect(measureIconFont(1024, pack(2600))).toBeNull();
    });
});

describe("iconFontFaceOverrides", () => {
    it("writes the descriptors a font face carries", () => {
        expect(iconFontFaceOverrides({ ascent: 0.9375, descent: 0.0625 })).toEqual([
            "ascent-override: 93.75%;",
            "descent-override: 6.25%;",
            "line-gap-override: 0%;"
        ]);
    });

    it("declares nothing for a pack that gave no usable metrics", () => {
        expect(iconFontFaceOverrides(undefined)).toEqual([]);
        expect(iconFontFaceOverrides({ ascent: 0.9, descent: NaN })).toEqual([]);
        expect(iconFontFaceOverrides({ ascent: -0.1, descent: 0.1 })).toEqual([]);
        expect(iconFontFaceOverrides({ ascent: 4, descent: 0.1 })).toEqual([]);
    });

    it("drops a manifest value that is not a number, which a pack's author writes by hand", () => {
        const evil = { ascent: "0%; } body { display: none } @font-face { x: 1", descent: 0.1 };

        expect(iconFontFaceOverrides(evil as never)).toEqual([]);
    });
});
