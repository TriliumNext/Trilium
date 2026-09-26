import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import LightboxDialog, { type LightboxOptions } from "./lightbox";

vi.mock("../../services/i18n", () => ({
    t: (key: string) => key
}));
vi.mock("../react/ImageViewer", () => ({
    default: ({ src, alt }: { src: string; alt: string }) => <img className="image-viewer-stub" src={src} alt={alt} />
}));
vi.mock("../type_widgets/file/PdfViewer", () => ({
    default: ({ pdfUrl }: { pdfUrl: string }) => <div className="pdf-viewer-stub" data-url={pdfUrl} />
}));

let host: Component;

beforeEach(() => {
    host = new Component();
    renderInto(
        <ParentComponent.Provider value={host}>
            <LightboxDialog />
        </ParentComponent.Provider>
    );
});

afterEach(() => {
    vi.restoreAllMocks();
});

async function show(opts: LightboxOptions) {
    await act(async () => {
        await host.handleEvent("showLightbox", opts);
    });
    return document.querySelector(".lightbox-dialog");
}

describe("LightboxDialog", () => {
    it("shows an image under its title, and opens the original in a new window", async () => {
        const open = vi.spyOn(window, "open").mockReturnValue(null);
        const dialog = await show({ src: "api/attachments/a1/image/cat.png", title: "cat.png" });

        expect(dialog?.querySelector(".modal-title")?.textContent).toBe("cat.png");
        const image = dialog?.querySelector(".image-viewer-stub");
        expect(image?.getAttribute("src")).toBe("api/attachments/a1/image/cat.png");
        expect(image?.getAttribute("alt")).toBe("cat.png");
        expect(dialog?.querySelector(".pdf-viewer-stub")).toBeNull();

        const openOriginal = dialog?.querySelector<HTMLButtonElement>(".custom-title-bar-button.bx-link-external");
        expect(openOriginal).not.toBeNull();
        act(() => openOriginal?.click());
        expect(open).toHaveBeenCalledExactlyOnceWith("api/attachments/a1/image/cat.png", "_blank", "noopener,noreferrer");
    });

    it("shows a PDF in the viewer, titled by its kind when it has no title", async () => {
        const dialog = await show({ src: "/api/attachments/p1/open", kind: "pdf" });

        expect(dialog?.querySelector(".modal-title")?.textContent).toBe("lightbox.pdf");
        expect(dialog?.querySelector(".pdf-viewer-stub")?.getAttribute("data-url")).toBe("/api/attachments/p1/open");
        expect(dialog?.querySelector(".image-viewer-stub")).toBeNull();
    });
});
