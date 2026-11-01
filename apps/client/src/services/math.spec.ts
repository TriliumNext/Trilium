import { describe, expect, it, vi } from "vitest";

import math, { renderMathInElement } from "./math";

// KaTeX checks for standards mode when it loads, and happy-dom has no `document.compatMode`.
vi.hoisted(() => {
    Object.defineProperty(document, "compatMode", { value: "CSS1Compat", configurable: true });
});

describe("math", () => {
    it("renders formulas as HTML without MathML, labelled with their TeX", () => {
        const container = document.createElement("div");
        container.innerHTML = '<p><span class="math-tex">\\(x^2\\)</span> and '
            + '<span class="math-tex">\\[\\frac{a}{b}\\]</span></p>';
        const formula = document.createElement("span");
        formula.className = "math-tex";
        formula.textContent = "\\(z\\)";
        const element = document.createElement("span");

        renderMathInElement(container);
        renderMathInElement(formula);
        math.render("y_1", element, { displayMode: true });

        for (const root of [ container, formula, element ]) {
            expect(root.querySelector(".katex-html")).not.toBeNull();
            expect(root.querySelector("math")).toBeNull();
        }
        expect(labels(container)).toEqual([ "img x^2", "img \\frac{a}{b}" ]);
        expect(labels(formula)).toEqual([ "img z" ]);
        expect(labels(element)).toEqual([ "img y_1" ]);

        renderMathInElement(container);
        expect(labels(container)).toEqual([ "img x^2", "img \\frac{a}{b}" ]);
    });
});

function labels(root: Element) {
    return [ ...root.querySelectorAll(".katex") ]
        .map((formula) => `${formula.getAttribute("role")} ${formula.getAttribute("aria-label")}`);
}
