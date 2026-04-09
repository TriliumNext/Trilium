import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Split from "../src/split.js";

function calcParts(expr: string) {
    const re = /calc\(([\d]*\.?[\d]*?)%\s?-\s?([\d]+)px\)/;
    const m = re.exec(expr);
    if (!m) throw new Error(`Could not parse calc expression: ${expr}`);

    return {
        percentage: parseFloat(m[1]),
        pixels: parseInt(m[2], 10),
    };
}

describe("Split", () => {
    let a: HTMLDivElement;
    let b: HTMLDivElement;
    let c: HTMLDivElement;

    beforeEach(() => {
        document.body.style.width = "800px";
        document.body.style.height = "600px";

        a = document.createElement("div");
        b = document.createElement("div");
        c = document.createElement("div");

        a.id = "a";
        b.id = "b";
        c.id = "c";

        document.body.appendChild(a);
        document.body.appendChild(b);
        document.body.appendChild(c);
    });

    afterEach(() => {
        document.body.removeChild(a);
        document.body.removeChild(b);
        document.body.removeChild(c);
    });

    it("splits in two when given two elements", () => {
        Split(["#a", "#b"]);

        expect(a.style.width).toContain("calc(50% - 5px)");
        expect(b.style.width).toContain("calc(50% - 5px)");
    });

    it("splits in three when given three elements", () => {
        Split(["#a", "#b", "#c"]);

        expect(calcParts(a.style.width).percentage).toBeCloseTo(33.33);
        expect(calcParts(b.style.width).percentage).toBeCloseTo(33.33);
        expect(calcParts(c.style.width).percentage).toBeCloseTo(33.33);

        expect(calcParts(a.style.width).pixels).toBe(5);
        expect(calcParts(b.style.width).pixels).toBe(10);
        expect(calcParts(c.style.width).pixels).toBe(5);
    });

    it("splits vertically when direction is vertical", () => {
        Split(["#a", "#b"], {
            direction: "vertical",
        });

        expect(a.style.height).toContain("calc(50% - 5px)");
        expect(b.style.height).toContain("calc(50% - 5px)");
    });

    it("splits in percentages when given sizes", () => {
        Split(["#a", "#b"], {
            sizes: [25, 75],
        });

        expect(a.style.width).toContain("calc(25% - 5px)");
        expect(b.style.width).toContain("calc(75% - 5px)");
    });

    it("accounts for gutter size", () => {
        Split(["#a", "#b"], {
            gutterSize: 20,
        });

        expect(a.style.width).toContain("calc(50% - 10px)");
        expect(b.style.width).toContain("calc(50% - 10px)");
    });

    it("accounts for gutter size with more than two elements", () => {
        Split(["#a", "#b", "#c"], {
            gutterSize: 20,
        });

        expect(calcParts(a.style.width).percentage).toBeCloseTo(33.33);
        expect(calcParts(b.style.width).percentage).toBeCloseTo(33.33);
        expect(calcParts(c.style.width).percentage).toBeCloseTo(33.33);

        expect(calcParts(a.style.width).pixels).toBe(10);
        expect(calcParts(b.style.width).pixels).toBe(20);
        expect(calcParts(c.style.width).pixels).toBe(10);
    });

    it("accounts for gutter size when direction is vertical", () => {
        Split(["#a", "#b"], {
            direction: "vertical",
            gutterSize: 20,
        });

        expect(a.style.height).toContain("calc(50% - 10px)");
        expect(b.style.height).toContain("calc(50% - 10px)");
    });

    it("accounts for gutter size with more than two elements when direction is vertical", () => {
        Split(["#a", "#b", "#c"], {
            direction: "vertical",
            gutterSize: 20,
        });

        expect(calcParts(a.style.height).percentage).toBeCloseTo(33.33);
        expect(calcParts(b.style.height).percentage).toBeCloseTo(33.33);
        expect(calcParts(c.style.height).percentage).toBeCloseTo(33.33);

        expect(calcParts(a.style.height).pixels).toBe(10);
        expect(calcParts(b.style.height).pixels).toBe(20);
        expect(calcParts(c.style.height).pixels).toBe(10);
    });

    it("set size directly when given css values", () => {
        Split(["#a", "#b"], {
            sizes: ["150px", "640px"],
        });

        expect(a.style.width).toBe("150px");
        expect(b.style.width).toBe("640px");
    });

    it("adjusts sizes using setSizes", () => {
        const split = Split(["#a", "#b"]);

        split.setSizes([70, 30]);

        expect(a.style.width).toContain("calc(70% - 5px)");
        expect(b.style.width).toContain("calc(30% - 5px)");
    });

    it("returns sizes", () => {
        const split = Split(["#a", "#b"]);
        let sizes = split.getSizes();

        expect(sizes).toEqual([50, 50]);

        split.setSizes([70, 30]);

        sizes = split.getSizes();

        expect(sizes).toEqual([70, 30]);
    });

    it("sets element styles using the elementStyle function", () => {
        Split(["#a", "#b"], {
            elementStyle: (_dimension, size) => {
                return {
                    width: size + "%",
                };
            },
        });

        expect(a.style.width).toBe("50%");
        expect(b.style.width).toBe("50%");
    });
});
