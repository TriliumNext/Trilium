// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import setupMath from "./math.js";

const renderMathInElement = vi.hoisted(() => vi.fn());
vi.mock("katex/contrib/auto-render", () => ({ default: renderMathInElement }));
vi.mock("katex/contrib/mhchem", () => ({}));

describe("setupMath", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        document.body.className = "";
        renderMathInElement.mockClear();
    });

    it("renders the formulas of the content, showing an invalid one as an error", async () => {
        document.body.innerHTML = `<div id="content"><span class="math-tex">\\(x^2\\)</span></div>`;

        await setupMath();

        expect(renderMathInElement).toHaveBeenCalledWith(document.getElementById("content"),
            expect.objectContaining({ throwOnError: false, macros: expect.any(Object) }));
        expect(document.body.classList.contains("math-loaded")).toBe(true);
    });

    it("loads nothing for content without formulas", async () => {
        document.body.innerHTML = `<div id="content"><p>x^2</p></div>`
            + `<span class="math-tex"></span>`;

        await setupMath();

        expect(renderMathInElement).not.toHaveBeenCalled();
        expect(document.body.classList.contains("math-loaded")).toBe(false);
    });
});
