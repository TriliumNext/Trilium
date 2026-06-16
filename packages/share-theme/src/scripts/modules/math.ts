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
    renderMathInElement(contentEl, { throwOnError: false });
    document.body.classList.add("math-loaded");
}
