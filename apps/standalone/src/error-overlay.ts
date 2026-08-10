/**
 * Full-screen error overlay for fatal standalone startup failures.
 *
 * The SQLite worker initialises asynchronously, so a failure there surfaces as a
 * `WORKER_ERROR` message or the worker's `onerror` event — long after main.ts's
 * bootstrap try/catch has already returned. With nowhere to show it, the page
 * just sits on a blank white screen. This renders the failure straight into the
 * DOM from wherever it is caught instead.
 *
 * Deliberately framework-free: it renders straight into the DOM with no client
 * runtime, since it has to work in exactly the cases where the client bundle
 * never came up. Styles live in `error-overlay.css`, whose `<link>` sits in the
 * static HTML and so loads independently of any of this running; each colour
 * reads a Trilium Next theme variable (matching the user's actual theme when
 * that CSS loaded) behind a hard-coded fallback (so it still looks right when it
 * didn't). The card, gradient backdrop and caution accent mirror the standalone
 * setup screen (`setup.css`).
 */

import "./error-overlay.css";

const OVERLAY_ID = "trilium-error-overlay";

/** First failure wins — a hung worker can emit both `onerror` and `WORKER_ERROR`,
 *  and the first message is the one that names the actual cause. */
let shown = false;

export function showErrorOverlay(title: string, message: string, detail?: string): void {
    if (shown) {
        return;
    }
    shown = true;

    // The pre-client shell may still be hiding the body; reveal it so the
    // overlay is actually visible (mirrors main.ts's bootstrap catch).
    document.body.style.display = "block";

    // Defensive: never stack two overlays if one was somehow left behind.
    document.getElementById(OVERLAY_ID)?.remove();

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("role", "alert");

    const card = document.createElement("div");
    card.className = "tn-eo-card";

    const illustration = document.createElement("div");
    illustration.className = "tn-eo-illustration";
    // Static markup, no user data — safe to set as innerHTML.
    illustration.innerHTML = WARNING_SVG;

    const heading = document.createElement("h1");
    heading.className = "tn-eo-title";
    heading.textContent = title;

    const body = document.createElement("p");
    body.className = "tn-eo-message";
    body.textContent = message;

    card.append(illustration, heading, body);

    if (detail) {
        const pre = document.createElement("pre");
        pre.className = "tn-eo-detail";
        pre.textContent = detail;
        card.append(pre);
    }

    const reload = document.createElement("button");
    reload.type = "button";
    reload.className = "tn-eo-button";
    reload.textContent = "Reload";
    reload.addEventListener("click", () => location.reload());

    card.append(reload);
    overlay.append(card);
    document.body.append(overlay);
}

const WARNING_SVG = `
<svg viewBox="0 0 24 24" width="56" height="56" fill="none" aria-hidden="true" focusable="false">
    <path d="M12 3.4 22.2 20.4H1.8L12 3.4Z" fill="currentColor" fill-opacity="0.14"/>
    <path d="M12 3.4 22.2 20.4H1.8L12 3.4Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M12 9.6v4.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="12" cy="16.9" r="1.05" fill="currentColor"/>
</svg>`;
