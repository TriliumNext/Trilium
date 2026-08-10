import { render } from "preact";
import { describe, expect, it } from "vitest";

import { formatDateNumeric } from "../../utils/formatters";
import { applyLinkScheme, asLabelValues, formatLabelDate, LabelValueChips, renderLabelValue } from "./label_value_display";

/** Renders what {@link renderLabelValue} hands back, JSX and bare string alike, and reads the DOM. */
function draw(value: string, labelType: Parameters<typeof renderLabelValue>[1]) {
    const container = document.createElement("div");
    render(<span>{renderLabelValue(value, labelType)}</span>, container);
    const drawn = container.firstElementChild as HTMLElement;
    render(null, container);
    return drawn;
}

describe("renderLabelValue", () => {
    it("reads a date or datetime through the user's locale, and echoes what is no date at all", () => {
        expect(renderLabelValue("2025-05-05", "date")).toBe(formatDateNumeric("2025-05-05", false));
        expect(renderLabelValue("2025-05-05 14:30", "datetime")).toBe(formatDateNumeric("2025-05-05 14:30", true));
        // Free text left behind by retyping a label stays readable rather than crashing the formatter.
        expect(renderLabelValue("someday", "date")).toBe("someday");
    });

    it("reads a colour as its swatch, with the stored text kept to the tooltip", () => {
        const swatch = draw("#3d5a80", "color").querySelector<HTMLElement>(".label-color-swatch");
        expect(swatch?.title).toBe("#3d5a80");
        expect(swatch?.style.backgroundColor).toBeTruthy();
    });

    it("reads a flag as its mark, either answer marked as itself", () => {
        expect(draw("true", "boolean").querySelector(".label-flag-set")).not.toBeNull();
        expect(draw("false", "boolean").querySelector(".label-flag-unset")).not.toBeNull();
    });

    it("links a url through the scheme guard rather than as stored", () => {
        expect(draw("https://example.com", "url").querySelector("a")?.getAttribute("href"))
            .toBe("https://example.com");
        // The guard is the whole point: a script url must not reach the href.
        expect(draw("javascript:alert(1)", "url").querySelector("a")?.getAttribute("href"))
            .toBe("about:blank");
    });

    it("makes an email and a phone clickable by their schemes, shown as the bare value", () => {
        const email = draw("a@b.c", "email").querySelector("a");
        expect(email?.getAttribute("href")).toBe("mailto:a@b.c");
        expect(email?.textContent).toBe("a@b.c");
        expect(draw("+40123", "phone").querySelector("a")?.getAttribute("href")).toBe("tel:+40123");
    });

    it("leaves any other value as the text it is stored as", () => {
        expect(renderLabelValue("plain", "text")).toBe("plain");
        expect(renderLabelValue("42", "number")).toBe("42");
        expect(renderLabelValue("anything", undefined)).toBe("anything");
    });
});

describe("applyLinkScheme", () => {
    it("adds the scheme once, keeps one already stored, and yields nothing for no value", () => {
        expect(applyLinkScheme("a@b.c", "mailto:")).toBe("mailto:a@b.c");
        // An older value stored as a url already carries it.
        expect(applyLinkScheme("mailto:a@b.c", "mailto:")).toBe("mailto:a@b.c");
        expect(applyLinkScheme("", "mailto:")).toBe("");
        expect(applyLinkScheme(42, "tel:")).toBe("");
    });
});

describe("formatLabelDate", () => {
    it("formats what parses, echoes what does not, and yields nothing for what is no string", () => {
        expect(formatLabelDate("2025-05-05", false)).toBe(formatDateNumeric("2025-05-05", false));
        expect(formatLabelDate("not a date", false)).toBe("not a date");
        expect(formatLabelDate("", true)).toBe("");
        expect(formatLabelDate(42, true)).toBe("");
    });
});

describe("asLabelValues", () => {
    it("reads a set from whatever a multi-valued label left behind", () => {
        expect(asLabelValues([ "a", "b" ])).toEqual([ "a", "b" ]);
        // A retyped single-valued definition leaves a bare string; an unset field leaves nothing.
        expect(asLabelValues("lone")).toEqual([ "lone" ]);
        expect(asLabelValues("")).toEqual([]);
        expect(asLabelValues(undefined)).toEqual([]);
        // Anything unreadable within a stored array is left out rather than shown as a chip.
        expect(asLabelValues([ "a", 42, null ])).toEqual([ "a" ]);
    });
});

describe("LabelValueChips", () => {
    function drawChips(values: string[], labelType: Parameters<typeof renderLabelValue>[1]) {
        const container = document.createElement("div");
        render(<LabelValueChips values={values} labelType={labelType} />, container);
        const chips = [ ...container.querySelectorAll<HTMLElement>(".tn-chip") ];
        render(null, container);
        return chips;
    }

    it("washes a flag's chip with its answer, and reads a colour as a chip of the colour itself", () => {
        const flags = drawChips([ "true", "false" ], "boolean");
        expect(flags.map((chip) => chip.className.includes("label-flag-chip-set"))).toEqual([ true, false ]);
        expect(flags.map((chip) => chip.className.includes("label-flag-chip-unset"))).toEqual([ false, true ]);

        const [ colour ] = drawChips([ "#3d5a80" ], "color");
        expect(colour?.className).toContain("label-color-chip");
        expect(colour?.title).toBe("#3d5a80");
    });

    it("shows a plain set as one unwashed chip per value", () => {
        const chips = drawChips([ "a", "b" ], "text");
        expect(chips.map((chip) => chip.textContent)).toEqual([ "a", "b" ]);
        expect(chips.every((chip) => !chip.className.includes("label-flag-chip"))).toBe(true);
    });
});
