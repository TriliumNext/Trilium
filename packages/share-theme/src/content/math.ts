import { KATEX_MACROS } from "@triliumnext/commons/src/lib/katex_macros.js";
import "./katex.scss";

export default async function setupMath() {
    const contentEl = document.getElementById("content");
    if (!contentEl?.querySelector(".math-tex")) {
        return;
    }

    const renderMathInElement = (await import("katex/contrib/auto-render")).default;
    await import("katex/contrib/mhchem");

    // throwOnError: false renders invalid formulas as an inline red error instead of
    // throwing and leaving raw `$…$` text plus a console error (matches the editor).
    // macros map MathLive-only commands (e.g. \differentialD) onto KaTeX equivalents.
    // Spread into a fresh object: KaTeX may mutate it (e.g. via `\gdef`).
    renderMathInElement(contentEl, { throwOnError: false, macros: { ...KATEX_MACROS } });
    document.body.classList.add("math-loaded");
}
