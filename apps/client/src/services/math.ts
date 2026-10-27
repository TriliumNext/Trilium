import "katex/contrib/mhchem";
import "./katex.scss";

import katex, { type KatexOptions } from "katex";
import autoRender, { type RenderMathInElementOptions } from "katex/contrib/auto-render";

/**
 * KaTeX that renders HTML only. A `<math>` element makes Chromium load its MathML stylesheet, and
 * with the sibling rules in it, Chromium restyles the whole note on every inserted block.
 */
const math: typeof katex = { ...katex, render };
export default math;

/** KaTeX's `renderMathInElement()`, with HTML output and each `span.math-tex` labelled. */
export function renderMathInElement(container: HTMLElement, options?: RenderMathInElementOptions) {
    const formulas = [ container, ...container.querySelectorAll<HTMLElement>("span.math-tex") ]
        .filter((element) => element.matches("span.math-tex") && !element.querySelector(".katex"))
        .map((element) => ({ element, tex: stripDelimiters(element.textContent ?? "") }));
    autoRender(container, { ...options, output: "html" });
    for (const { element, tex } of formulas) {
        labelFormula(element, tex);
    }
}

function render(tex: string, element: HTMLElement, options?: KatexOptions) {
    katex.render(tex, element, { ...options, output: "html" });
    labelFormula(element, tex);
}

/** KaTeX marks its HTML output `aria-hidden`, so the formula is labelled with its TeX source. */
function labelFormula(element: Element, tex: string) {
    const formula = element.querySelector(".katex");
    formula?.setAttribute("role", "img");
    formula?.setAttribute("aria-label", tex);
}

/** The TeX of a formula stored as `\(…\)` or `\[…\]`. */
function stripDelimiters(source: string) {
    return source.trim().replace(/^\\[([]|\\[)\]]$/g, "").trim();
}
