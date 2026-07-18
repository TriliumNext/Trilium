import { describe, expect, it } from "vitest";
import $ from "jquery";

import cssClassManager, { getHue, getReadableTextColor, parseColor } from "./css_class_manager";
import Color from "color";

describe("getReadableTextColor", () => {
    it("doesn't crash for invalid color", () => {
        expect(getReadableTextColor("RandomColor")).toBe("#000");
    });

    it("tolerates different casing", () => {
        expect(getReadableTextColor("Blue"))
            .toBe(getReadableTextColor("blue"));
    });

    it("returns black text for a light background and white text for a dark one", () => {
        expect(getReadableTextColor("#ffffff")).toBe("#000");
        expect(getReadableTextColor("#000000")).toBe("#fff");
    });
});

describe("parseColor", () => {
    it("parses a valid color", () => {
        const parsed = parseColor("#ff0000");
        expect(parsed).toBeDefined();
        expect(parsed!.hex().toLowerCase()).toBe("#ff0000");
    });

    it("returns undefined for an invalid color (caught exception)", () => {
        expect(parseColor("not-a-color")).toBeUndefined();
    });
});

describe("getHue", () => {
    it("returns a hue for a saturated color", () => {
        const hue = getHue(Color("#ff0000"));
        expect(hue).toBeDefined();
        // Red sits at hue 0.
        expect(hue).toBe(0);
    });

    it("returns undefined for a grayscale color (no saturation)", () => {
        expect(getHue(Color("#808080"))).toBeUndefined();
    });
});

describe("createClassForColor", () => {
    function styleCount() {
        return $("head").find("style").length;
    }

    it("returns empty string for null, empty and whitespace-only input", () => {
        expect(cssClassManager.createClassForColor(null)).toBe("");
        expect(cssClassManager.createClassForColor("")).toBe("");
        expect(cssClassManager.createClassForColor("   ")).toBe("");
    });

    it("returns empty string for an unparseable color", () => {
        expect(cssClassManager.createClassForColor("definitely-not-a-color")).toBe("");
    });

    it("registers a saturated color, injects a <style>, and adds the with-hue class", () => {
        const before = styleCount();
        const result = cssClassManager.createClassForColor("#123456");

        expect(result).toContain("use-note-color");
        expect(result).toContain("color-123456");
        expect(result).toContain("with-hue");
        // A new <style> element was appended for this freshly-registered color.
        expect(styleCount()).toBe(before + 1);

        // The injected style references the registered class and the custom-color CSS vars.
        const html = $("head").find("style").last().html() ?? "";
        expect(html).toContain(".color-123456");
        expect(html).toContain("--original-custom-color: #123456");
        // The emitted hue must be the actual numeric value (not "unset"), since #123456 is saturated.
        const expectedHue = getHue(Color("#123456"));
        expect(expectedHue).toBe(210);
        expect(html).toContain(`--custom-color-hue: ${expectedHue};`);
        expect(html).not.toContain("--custom-color-hue: unset");
    });

    it("does not re-inject a <style> for an already-registered color", () => {
        // First registration. Color#hex() upper-cases hex digits, so the class follows suit.
        cssClassManager.createClassForColor("#abcdef");
        const after = styleCount();

        // Second call with the same color must reuse the existing registration.
        const result = cssClassManager.createClassForColor("#abcdef");
        expect(result).toContain("color-ABCDEF");
        expect(styleCount()).toBe(after);
    });

    it("registers a grayscale color without the with-hue class and emits an unset hue", () => {
        const result = cssClassManager.createClassForColor("#777777");

        expect(result).toContain("use-note-color");
        expect(result).toContain("color-777777");
        expect(result).not.toContain("with-hue");

        const styleForGray = $("head")
            .find("style")
            .filter((_, el) => ($(el).html() ?? "").includes(".color-777777"))
            .first()
            .html() ?? "";
        expect(styleForGray).toContain("--custom-color-hue: unset");
    });

    it("adjusts lightness for both a very light and a very dark color", () => {
        // Helper to read the registered style block for a given class fragment.
        function styleFor(classFragment: string) {
            return $("head")
                .find("style")
                .filter((_, el) => ($(el).html() ?? "").includes(classFragment))
                .first()
                .html() ?? "";
        }

        // Very light color (lab L ~= 99.65). Under happy-dom the theme CSS vars are unset, so
        // the source falls back to lightThemeColorMaxLightness=70 / darkThemeColorMinLightness=50.
        // The light-theme color is clamped down to L=70 (a mid-gray, distinct from the original),
        // while the dark-theme color stays at the original (Math.max keeps the higher lightness).
        const light = cssClassManager.createClassForColor("#fefefe");
        expect(light).toContain("color-FEFEFE");

        const lightHtml = styleFor(".color-FEFEFE");
        expect(lightHtml).toContain("--original-custom-color: #FEFEFE");
        expect(lightHtml).toContain("--light-theme-custom-color: #ABABAB");
        expect(lightHtml).toContain("--dark-theme-custom-color: #FEFEFE");
        // The clamp actually moved the light-theme color away from the original.
        expect(lightHtml).not.toContain("--light-theme-custom-color: #FEFEFE");

        // Very dark color (lab L ~= 0.27). The dark-theme color is clamped up to L=50 (a mid-gray),
        // while the light-theme color stays at the original (Math.min keeps the lower lightness).
        const dark = cssClassManager.createClassForColor("#010101");
        expect(dark).toContain("color-010101");

        const darkHtml = styleFor(".color-010101");
        expect(darkHtml).toContain("--original-custom-color: #010101");
        expect(darkHtml).toContain("--light-theme-custom-color: #010101");
        expect(darkHtml).toContain("--dark-theme-custom-color: #777777");
        // The clamp actually moved the dark-theme color away from the original.
        expect(darkHtml).not.toContain("--dark-theme-custom-color: #010101");
    });
});
