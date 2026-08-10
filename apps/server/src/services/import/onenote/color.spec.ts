import { describe, expect, it } from "vitest";

import { parseColor, reflectLightness } from "./color.js";

/** reflectLightness on a raw CSS color string, for terser cases below. */
function reflect(value: string): string | null {
    const parsed = parseColor(value);
    return parsed ? reflectLightness(parsed) : null;
}

describe("parseColor", () => {
    it("parses the color forms OneNote emits: #rrggbb, #rgb, named and rgb()", () => {
        expect(parseColor("#1353BA")?.hex()).toBe("#1353BA");
        expect(parseColor("#333")?.hex()).toBe("#333333");
        expect(parseColor("black")?.hex()).toBe("#000000");
        expect(parseColor("rgb(54, 86, 35)")?.hex()).toBe("#365623");
    });

    it("returns null for anything that isn't a CSS color", () => {
        for (const value of ["", "not-a-color", "#33", "#33g333", "url(x)"]) {
            expect(parseColor(value)).toBeNull();
        }
    });
});

describe("reflectLightness", () => {
    it("lightness-reflects grays exactly (the near-black ink correction)", () => {
        // #333333 -> #cccccc is the OneNote near-black case; pure black reflects to pure white.
        expect(reflect("#333333")).toBe("#cccccc");
        expect(reflect("#404040")).toBe("#bfbfbf");
        expect(reflect("#000000")).toBe("#ffffff");
        expect(reflect("#ffffff")).toBe("#000000");
    });

    it("preserves hue and saturation when reflecting chromatic colors", () => {
        // One color per hue region, both lightness directions.
        expect(reflect("#800000")).toBe("#ff7f7f"); // dark red
        expect(reflect("#008000")).toBe("#7fff7f"); // dark green
        expect(reflect("#000080")).toBe("#7f7fff"); // navy
        expect(reflect("#800080")).toBe("#ff7fff"); // dark magenta (hue wraps past the top of the wheel)
        expect(reflect("#ffe6e6")).toBe("#190000"); // near-white pink -> dark red
    });
});
