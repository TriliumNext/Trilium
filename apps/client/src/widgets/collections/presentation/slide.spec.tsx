import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PresentationSlideBaseModel } from "./model";

const webViewSlide: PresentationSlideBaseModel = {
    noteId: "web",
    type: "webView",
    content: { __html: "" },
    webViewSrc: "https://example.com/"
};

describe("Slide", () => {
    afterEach(() => {
        vi.doUnmock("../../../services/utils");
        vi.resetModules();
    });

    it("shows a web view in a partitioned <webview> on desktop", async () => {
        const section = await renderSlide({ isElectron: true });

        const webview = section.querySelector("webview");
        expect(webview?.getAttribute("src")).toBe("https://example.com/");
        expect(webview?.getAttribute("partition")).toBe("persist:webview");
        expect(section.classList.contains("web-view-slide")).toBe(true);
        expect(section.hasAttribute("data-background-iframe")).toBe(false);
        expect(section.querySelector(".slide-content")).toBeNull();
    });

    it("lets Reveal.js frame a web view in the slide background in the browser", async () => {
        const section = await renderSlide({ isElectron: false });

        expect(section.getAttribute("data-background-iframe")).toBe("https://example.com/");
        expect(section.hasAttribute("data-background-interactive")).toBe(true);
        expect(section.querySelector("webview")).toBeNull();
        expect(section.classList.contains("web-view-slide")).toBe(false);
    });
});

async function renderSlide({ isElectron }: { isElectron: boolean }) {
    vi.doMock("../../../services/utils", async (importOriginal) => {
        const actual = await importOriginal<typeof import("../../../services/utils")>();
        return { ...actual, default: { ...actual.default, isElectron: () => isElectron }, isElectron: () => isElectron };
    });
    const { Slide } = await import("./index");

    const container = document.createElement("div");
    render(<Slide slide={webViewSlide} ntxId={undefined} />, container);
    const section = container.querySelector("section");
    if (!section) throw new Error("The slide did not render a <section>.");
    return section;
}
