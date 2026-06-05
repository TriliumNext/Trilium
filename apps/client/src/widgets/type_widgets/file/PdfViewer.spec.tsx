import { OptionNames } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import options from "../../../services/options";
import { ParentComponent } from "../../react/react_utils";
import PdfViewer from "./PdfViewer";

// --- Render helpers -------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;

function renderViewer(props: Parameters<typeof PdfViewer>[0]) {
    container = document.createElement("div");
    document.body.appendChild(container);
    const parent = new Component();
    act(() => render((
        <ParentComponent.Provider value={parent}>
            <PdfViewer {...props} />
        </ParentComponent.Provider>
    ), container as HTMLDivElement));
    return getIframe(container);
}

function getIframe(root: HTMLElement): HTMLIFrameElement {
    const iframe = root.querySelector("iframe.pdf-preview");
    if (!iframe) throw new Error("pdf iframe not rendered");
    return iframe as HTMLIFrameElement;
}

/** Attach a real, isolated HTML document as the iframe's contentDocument (happy-dom leaves it null). */
function stubContentDocument(iframe: HTMLIFrameElement) {
    const doc = document.implementation.createHTMLDocument("pdf");
    Object.defineProperty(iframe, "contentDocument", { value: doc, configurable: true });
    return doc;
}

/** Replace window.matchMedia with a capturing stub; returns the registered "change" listeners. */
function stubMatchMedia() {
    const listeners: Array<() => void> = [];
    const removed: Array<() => void> = [];
    const original = window.matchMedia;
    const mql = {
        matches: false,
        media: "(prefers-color-scheme: dark)",
        addEventListener: (_type: string, cb: () => void) => listeners.push(cb),
        removeEventListener: (_type: string, cb: () => void) => removed.push(cb)
    };
    Object.defineProperty(window, "matchMedia", { value: () => mql, configurable: true });
    const restore = () => Object.defineProperty(window, "matchMedia", { value: original, configurable: true });
    return { listeners, removed, restore };
}

function setOptions(values: Record<string, string>) {
    options.load(values as Record<OptionNames, string>);
}

beforeEach(() => {
    setOptions({ locale: "en", newLayout: "false" });
    (globalThis as unknown as { glob: Record<string, unknown> }).glob = { triliumVersion: "9.9.9" };
});

afterEach(() => {
    if (container) { act(() => render(null, container as HTMLDivElement)); container.remove(); container = undefined; }
    vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------------------------------

describe("PdfViewer - src construction", () => {
    it("builds the viewer URL with defaults (toolbar on, sidebar on, not editable)", () => {
        const iframe = renderViewer({ pdfUrl: "/notes/n1/open" });
        const src = iframe.getAttribute("src") ?? "";
        expect(iframe.className).toBe("pdf-preview");
        expect(src).toContain("pdfjs/web/viewer.html?v=9.9.9");
        expect(src).toContain("file=/notes/n1/open");
        expect(src).toContain("locale=en");
        // newLayout=false -> sidebar=1
        expect(src).toContain("sidebar=1");
        expect(src).toContain("editable=0");
        expect(src).toContain("toolbar=1");
    });

    it("reflects editable, hidden toolbar and newLayout in the URL", () => {
        setOptions({ locale: "de", newLayout: "true" });
        const iframe = renderViewer({ pdfUrl: "/notes/n2/open", editable: true, toolbar: false });
        const src = iframe.getAttribute("src") ?? "";
        expect(src).toContain("locale=de");
        // newLayout=true -> sidebar=0
        expect(src).toContain("sidebar=0");
        expect(src).toContain("editable=1");
        expect(src).toContain("toolbar=0");
    });

    it("syncs an external iframeRef to the rendered iframe via useSyncedRef", () => {
        const externalRef = { current: null as HTMLIFrameElement | null };
        const iframe = renderViewer({ pdfUrl: "/x", iframeRef: externalRef });
        expect(externalRef.current).toBe(iframe);
    });
});

describe("PdfViewer - style injection on load", () => {
    it("injects root vars + font styles into the iframe document and invokes onLoad", () => {
        const onLoad = vi.fn();
        const iframe = renderViewer({ pdfUrl: "/x", onLoad });
        const doc = stubContentDocument(iframe);

        act(() => { iframe.dispatchEvent(new Event("load")); });

        const styles = doc.head.querySelectorAll("style");
        // First style: client-root-vars; second: fonts. No selection style without disableSelection.
        expect(styles.length).toBe(2);
        const rootVars = doc.getElementById("client-root-vars");
        expect(rootVars).not.toBeNull();
        expect(rootVars?.textContent).toContain(":root {");
        expect(styles[1].textContent).toContain("@font-face");
        expect(styles[1].textContent).toContain("font-family: 'Inter'");
        expect(onLoad).toHaveBeenCalledTimes(1);
    });

    it("rewrites root --vars into prefixed --tn- vars inside the injected stylesheet", () => {
        document.documentElement.style.setProperty("--accent", "red");
        try {
            const iframe = renderViewer({ pdfUrl: "/x" });
            const doc = stubContentDocument(iframe);
            act(() => { iframe.dispatchEvent(new Event("load")); });

            const rootVars = doc.getElementById("client-root-vars");
            expect(rootVars?.textContent).toContain("--tn-accent: red;");
        } finally {
            document.documentElement.style.removeProperty("--accent");
        }
    });

    it("adds a selection-disabling style when disableSelection is set", () => {
        const iframe = renderViewer({ pdfUrl: "/x", disableSelection: true });
        const doc = stubContentDocument(iframe);

        act(() => { iframe.dispatchEvent(new Event("load")); });

        const styles = Array.from(doc.head.querySelectorAll("style"));
        expect(styles.length).toBe(3);
        expect(styles.some((s) => s.textContent?.includes("user-select: none"))).toBe(true);
    });

    it("tolerates a load event when the iframe has no contentDocument", () => {
        const onLoad = vi.fn();
        const iframe = renderViewer({ pdfUrl: "/x", onLoad });
        Object.defineProperty(iframe, "contentDocument", { value: null, configurable: true });

        expect(() => act(() => { iframe.dispatchEvent(new Event("load")); })).not.toThrow();
        // onLoad prop still fires even though style injection bailed out.
        expect(onLoad).toHaveBeenCalledTimes(1);
    });

    it("does not require an onLoad prop", () => {
        const iframe = renderViewer({ pdfUrl: "/x" });
        stubContentDocument(iframe);
        expect(() => act(() => { iframe.dispatchEvent(new Event("load")); })).not.toThrow();
    });
});

describe("PdfViewer - color scheme change listener", () => {
    it("registers a matchMedia listener and refreshes the injected vars on change", () => {
        const media = stubMatchMedia();
        try {
            const iframe = renderViewer({ pdfUrl: "/x" });
            const doc = stubContentDocument(iframe);
            // Populate styleRef.current via the initial load.
            act(() => { iframe.dispatchEvent(new Event("load")); });

            expect(media.listeners.length).toBe(1);
            const styleEl = doc.getElementById("client-root-vars");
            if (styleEl) styleEl.textContent = "STALE";

            act(() => media.listeners.forEach((cb) => cb()));
            expect(styleEl?.textContent).toContain(":root {");
            expect(styleEl?.textContent).not.toBe("STALE");
        } finally {
            media.restore();
        }
    });

    it("removes the matchMedia listener on unmount", () => {
        const media = stubMatchMedia();
        try {
            renderViewer({ pdfUrl: "/x" });
            expect(media.listeners.length).toBe(1);
            if (container) { act(() => render(null, container as HTMLDivElement)); container.remove(); container = undefined; }
            expect(media.removed.length).toBe(1);
            expect(media.removed[0]).toBe(media.listeners[0]);
        } finally {
            media.restore();
        }
    });
});
