import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setFloatingElements } from "./floating_elements";

describe("setFloatingElements", () => {
    beforeEach(() => {
        document.head.innerHTML = `<style>
            .header, .cookies, .backdrop, .gone { position: fixed; }
            .gone { display: none; }
            th { position: sticky; }
        </style>`;
        document.body.innerHTML = `
            <div class="header"></div>
            <div class="cookies" style="display: flex"></div>
            <div class="backdrop"></div>
            <div class="gone"></div>
            <table><tr><th style="top: 10px; color: red"></th></tr></table>
            <p>Text</p>`;
        place(".header", { top: 0, width: 1024, height: 60 });
        place(".cookies", { top: 700, width: 1024, height: 68 });
        place(".backdrop", { top: 0, width: 1024, height: 768 });
    });

    afterEach(() => {
        setFloatingElements("restore");
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("pins sticky elements, hides fixed ones below the top, then the top ones after the first capture", () => {
        setFloatingElements("first");

        expect(styleOf("th")).toBe("top: auto !important; color: red; position: relative !important; "
            + "right: auto !important; bottom: auto !important; left: auto !important;");
        expect(styleOf(".cookies")).toBe("display: none !important;");
        expect(styleOf(".header")).toBeNull();
        expect(styleOf(".backdrop")).toBeNull();
        expect(styleOf(".gone")).toBeNull();
        expect(styleOf("p")).toBeNull();

        setFloatingElements("rest");
        expect(styleOf(".header")).toBe("display: none !important;");
        expect(styleOf(".backdrop")).toBeNull();
        expect(styleOf(".gone")).toBeNull();
    });

    it("hides the scrollbars and turns off scroll snapping until the page is restored", () => {
        const scrollbarStyles = () => [ ...document.querySelectorAll("style") ]
            .filter((style) => style.textContent?.includes("scrollbar-width: none !important"));

        setFloatingElements("first");
        setFloatingElements("first");
        expect(scrollbarStyles()).toHaveLength(1);
        expect(scrollbarStyles()[0]?.textContent).toContain("html::-webkit-scrollbar");
        expect(scrollbarStyles()[0]?.textContent).toContain("scroll-snap-type: none !important");

        setFloatingElements("restore");
        expect(scrollbarStyles()).toHaveLength(0);
    });

    it("puts back every inline style as it was", () => {
        const before = [ ...document.body.querySelectorAll("*") ].map((element) => element.getAttribute("style"));

        setFloatingElements("first");
        setFloatingElements("rest");
        setFloatingElements("rest");
        setFloatingElements("restore");

        expect([ ...document.body.querySelectorAll("*") ].map((element) => element.getAttribute("style")))
            .toEqual(before);
    });

    it("restores values marked important, and keeps what the page changed in the meantime", () => {
        const heading = element("th");
        heading.setAttribute("style", "position: sticky !important; top: 10px");

        setFloatingElements("first");
        heading.style.setProperty("color", "blue");
        element(".header").style.setProperty("opacity", "0.5");
        setFloatingElements("rest");
        setFloatingElements("restore");

        expect(heading.style.getPropertyValue("position")).toBe("sticky");
        expect(heading.style.getPropertyPriority("position")).toBe("important");
        expect(heading.style.getPropertyValue("top")).toBe("10px");
        expect(heading.style.getPropertyValue("color")).toBe("blue");
        expect(styleOf(".header")).toBe("opacity: 0.5;");
    });

    it("starts from the page's own styles when the previous screenshot left changes behind", () => {
        setFloatingElements("first");
        setFloatingElements("rest");
        setFloatingElements("first");
        expect(styleOf(".header")).toBeNull();

        setFloatingElements("restore");
        expect(styleOf(".cookies")).toBe("display: flex");
        expect(styleOf("th")).toBe("top: 10px; color: red");
    });

    it("restores the page on its own when it is not asked to within three minutes", () => {
        vi.useFakeTimers();
        setFloatingElements("first");

        vi.advanceTimersByTime(179_999);
        expect(styleOf(".cookies")).toBe("display: none !important;");

        vi.advanceTimersByTime(1);
        expect(styleOf(".cookies")).toBe("display: flex");
        expect(styleOf("th")).toBe("top: 10px; color: red");
    });
});

function element(selector: string) {
    const found = document.querySelector<HTMLElement>(selector);
    if (!found) throw new Error(`No ${selector} in the fixture.`);
    return found;
}

function styleOf(selector: string) {
    return element(selector).getAttribute("style");
}

/** Gives an element the box it would have in a browser; happy-dom lays nothing out. */
function place(selector: string, { top, width, height }: { top: number, width: number, height: number }) {
    vi.spyOn(element(selector), "getBoundingClientRect")
        .mockReturnValue({ top, width, height } as DOMRect);
}
