import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
import ImageLightboxLink from "./ImageLightboxLink";

describe("ImageLightboxLink", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        vi.restoreAllMocks();
    });

    it("opens the lightbox on a plain click and passes modified clicks on to the link handler", () => {
        const triggerEvent = vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined);
        act(() => render(
            <ImageLightboxLink src="api/attachments/abc/image/cat.png" title="cat.png">
                <img alt="cat.png" />
            </ImageLightboxLink>, container));

        const link = container.querySelector("a");
        expect(link?.getAttribute("href")).toBe("api/attachments/abc/image/cat.png");
        expect(link?.getAttribute("target")).toBe("_blank");

        // `goToLink` in `services/link.ts` listens on the document and opens `api/` links in a new tab.
        const reachedDocument: string[] = [];
        const onDocumentEvent = (e: Event) => reachedDocument.push(e.type);
        document.addEventListener("click", onDocumentEvent);
        document.addEventListener("dblclick", onDocumentEvent);

        try {
            act(() => { link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })); });
            act(() => { link?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, button: 0 })); });
            expect(triggerEvent).toHaveBeenCalledExactlyOnceWith("showImageLightbox", {
                src: "api/attachments/abc/image/cat.png",
                title: "cat.png"
            });
            expect(reachedDocument).toEqual([]);

            act(() => {
                link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ctrlKey: true }));
            });
            expect(triggerEvent).toHaveBeenCalledOnce();
            expect(reachedDocument).toEqual([ "click" ]);
        } finally {
            document.removeEventListener("click", onDocumentEvent);
            document.removeEventListener("dblclick", onDocumentEvent);
        }
    });
});
