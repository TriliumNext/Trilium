import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
import LightboxLink from "./LightboxLink";

describe("LightboxLink", () => {
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
        const lightbox = { src: "/api/attachments/abc/open", kind: "pdf" as const, title: "report.pdf" };
        act(() => render(
            <LightboxLink lightbox={lightbox} href="#root/n1?viewMode=attachments&attachmentId=abc">
                report.pdf
            </LightboxLink>, container));

        const link = container.querySelector("a");
        expect(link?.getAttribute("href")).toBe("#root/n1?viewMode=attachments&attachmentId=abc");
        expect(link?.getAttribute("target")).toBe("_blank");
        expect(link?.getAttribute("title")).toBe("report.pdf");

        // `goToLink` in `services/link.ts` listens on the document and opens links in a new tab.
        const reachedDocument: string[] = [];
        const onDocumentEvent = (e: Event) => reachedDocument.push(e.type);
        document.addEventListener("click", onDocumentEvent);
        document.addEventListener("dblclick", onDocumentEvent);

        try {
            act(() => { link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })); });
            act(() => { link?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, button: 0 })); });
            expect(triggerEvent).toHaveBeenCalledExactlyOnceWith("showLightbox", lightbox);
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

    it("links to the file itself when no href is given", () => {
        act(() => render(
            <LightboxLink lightbox={{ src: "api/attachments/abc/image/cat.png" }}>
                <img alt="cat.png" />
            </LightboxLink>, container));

        expect(container.querySelector("a")?.getAttribute("href")).toBe("api/attachments/abc/image/cat.png");
    });
});
