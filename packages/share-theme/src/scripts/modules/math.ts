import { KATEX_MACROS } from "@triliumnext/commons/src/lib/katex_macros.js";
import "katex/dist/katex.min.css";

export default async function setupMath() {
    const anyMathBlock = document.querySelector("#content .math-tex");
    if (!anyMathBlock) {
        return;
    }

    const renderMathInElement = (await import("katex/contrib/auto-render")).default;
    await import("katex/contrib/mhchem");

    const contentEl = document.getElementById("content");
    if (!contentEl) return;
    // throwOnError: false renders invalid formulas as an inline red error instead of
    // throwing and leaving raw `$…$` text plus a console error (matches the editor).
    // macros map MathLive-only commands (e.g. \differentialD) onto KaTeX equivalents.
    // Spread into a fresh object: KaTeX may mutate it (e.g. via `\gdef`).
    renderMathInElement(contentEl, { throwOnError: false, macros: { ...KATEX_MACROS } });
    document.body.classList.add("math-loaded");
}
