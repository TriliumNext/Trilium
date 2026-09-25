import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function freshOverlay(): Promise<typeof import("./error-overlay.js")> {
    // The module carries a "first failure wins" flag, so each test needs a
    // fresh copy to start from a clean slate.
    vi.resetModules();
    return import("./error-overlay.js");
}

beforeEach(() => {
    document.body.innerHTML = "";
});

afterEach(() => {
    document.getElementById("trilium-error-overlay")?.remove();
});

describe("showErrorOverlay", () => {
    it("renders title, message, detail and a reload button, and removes the splash", async () => {
        const { showErrorOverlay } = await freshOverlay();
        document.body.innerHTML = `<div id="splash"></div>`;

        showErrorOverlay("Trilium couldn't start", "MIME type wrong", "at worker.js:1");

        const overlay = document.getElementById("trilium-error-overlay");
        expect(overlay).not.toBeNull();
        expect(overlay?.textContent).toContain("Trilium couldn't start");
        expect(overlay?.textContent).toContain("MIME type wrong");
        expect(overlay?.querySelector("pre")?.textContent).toBe("at worker.js:1");
        expect(overlay?.querySelector("button")?.textContent).toBe("Reload");
        // The startup splash sits above everything and would cover the overlay.
        expect(document.getElementById("splash")).toBeNull();
    });

    it("omits the detail block when no detail is given", async () => {
        const { showErrorOverlay } = await freshOverlay();
        showErrorOverlay("Title", "Message");
        expect(document.getElementById("trilium-error-overlay")?.querySelector("pre")).toBeNull();
    });

    it("shows only the first failure — a hung worker can report twice", async () => {
        const { showErrorOverlay } = await freshOverlay();
        showErrorOverlay("First", "the informative one");
        showErrorOverlay("Second", "the noise after");

        const overlays = document.querySelectorAll("#trilium-error-overlay");
        expect(overlays).toHaveLength(1);
        expect(overlays[0]?.textContent).toContain("the informative one");
        expect(overlays[0]?.textContent).not.toContain("the noise after");
    });

    it("inserts message text rather than interpreting it as markup", async () => {
        const { showErrorOverlay } = await freshOverlay();
        showErrorOverlay("Title", "<img src=x onerror=alert(1)>");
        const overlay = document.getElementById("trilium-error-overlay");
        expect(overlay?.querySelector("img")).toBeNull();
        expect(overlay?.textContent).toContain("<img src=x onerror=alert(1)>");
    });

    it("reloads the page when the button is clicked", async () => {
        const { showErrorOverlay } = await freshOverlay();
        const reload = vi.fn();
        // happy-dom's location.reload is not configurable to spy directly, so
        // replace the whole accessor for the duration of the test.
        const original = window.location;
        Object.defineProperty(window, "location", {
            value: { ...original, reload },
            configurable: true
        });

        showErrorOverlay("Title", "Message");
        document.getElementById("trilium-error-overlay")?.querySelector("button")?.click();
        expect(reload).toHaveBeenCalled();

        Object.defineProperty(window, "location", { value: original, configurable: true });
    });
});
