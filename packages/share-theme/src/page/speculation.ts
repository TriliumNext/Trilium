/**
 * Lets Chromium prerender the page behind a link of the site once the visitor holds the pointer on
 * it or presses it (`moderate` eagerness), so the click shows a page already drawn. Links to files
 * (`./api/…`), the login and links opening elsewhere are left out. A static export has no server
 * to prerender from.
 */
export default function setupSpeculation() {
    if (window.glob?.isStatic || !HTMLScriptElement.supports?.("speculationrules")) {
        return;
    }

    const script = document.createElement("script");
    script.type = "speculationrules";
    script.textContent = JSON.stringify({
        prerender: [ {
            where: {
                and: [
                    { href_matches: "./*", relative_to: "document" },
                    { not: { href_matches: "./api/*", relative_to: "document" } },
                    { not: { selector_matches: "[target], [download], .login-link" } }
                ]
            },
            eagerness: "moderate"
        } ]
    });
    document.head.append(script);
}

/**
 * Runs `callback` once the page is shown: at once, or on activation for a prerendered page, whose
 * scripts otherwise run while the visitor is still on the previous page and read its state too
 * early.
 */
export function whenActivated(callback: () => void) {
    if (document.prerendering) {
        document.addEventListener("prerenderingchange", callback, { once: true });
    } else {
        callback();
    }
}
