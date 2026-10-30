import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PresentationModel } from "./model";
import SlideSidebar from "./sidebar";

vi.mock("../../../services/froca", () => ({
    default: { getNoteFromCache: () => ({ getIcon: () => "bx bx-columns" }) }
}));

const presentation: PresentationModel = {
    slides: [
        {
            noteId: "intro",
            type: "text",
            content: { __html: "<h1>Intro</h1>" },
            backgroundColor: "rgb(255, 0, 0)",
            verticalSlides: [
                { noteId: "first", type: "text", content: { __html: "<p>First</p>" } },
                { noteId: "second", type: "text", content: { __html: "<p>Second</p>" } }
            ]
        },
        { noteId: "web", type: "webView", content: { __html: "" }, webViewSrc: "https://example.com/", verticalSlides: undefined },
        { noteId: "board", type: "book", content: { __html: "" }, isCollection: true, verticalSlides: undefined }
    ]
};

describe("SlideSidebar", () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it("lists the slides as thumbnails, with vertical slides nested under their slide", () => {
        const sidebar = renderSidebar();

        const topLevel = sidebar.querySelectorAll(":scope > li");
        expect(topLevel).toHaveLength(3);
        const vertical = topLevel[0].querySelectorAll(".presentation-sidebar-vertical-slides > li .slide-thumbnail");
        expect([ ...vertical ].map(thumbnail => thumbnail.getAttribute("data-note-id"))).toEqual([ "first", "second" ]);
        expect(topLevel[1].querySelector("ol")).toBeNull();
    });

    it("renders text slides in a shadow root that adopts the theme's stylesheets", () => {
        const sidebar = renderSidebar();

        const thumbnail = sidebar.querySelector<HTMLElement>(".slide-thumbnail[data-note-id=intro]");
        const root = thumbnail?.shadowRoot;
        expect(root?.querySelector(".reveal .slides section.present .slide-content")?.innerHTML).toBe("<h1>Intro</h1>");
        expect(root?.querySelector<HTMLElement>(".reveal-viewport")?.style.background).toContain("rgb(255, 0, 0)");
        // The two stylesheets passed in, plus the thumbnail's own.
        expect(root?.adoptedStyleSheets).toHaveLength(3);
        // Every thumbnail shares the same parsed sheets.
        const other = sidebar.querySelector<HTMLElement>(".slide-thumbnail[data-note-id=first]")?.shadowRoot;
        expect(other?.adoptedStyleSheets[0]).toBe(root?.adoptedStyleSheets[0]);
    });

    it("shows an icon instead of loading a web view or a collection again", () => {
        const sidebar = renderSidebar();

        const web = sidebar.querySelector<HTMLElement>(".slide-thumbnail[data-note-id=web]");
        expect(web?.shadowRoot).toBeNull();
        expect(web?.querySelector(".bx-globe")).not.toBeNull();
        expect(sidebar.querySelector(".slide-thumbnail[data-note-id=board] .bx-columns")).not.toBeNull();
    });

    it("shows the content of a slide whose editor just closed", () => {
        const sidebar = renderSidebar({ first: { __html: "<p>Edited</p>" } });

        const root = sidebar.querySelector<HTMLElement>(".slide-thumbnail[data-note-id=first]")?.shadowRoot;
        expect(root?.querySelector(".slide-content")?.innerHTML).toBe("<p>Edited</p>");
    });
});

function renderSidebar(closingContents = {}) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
        render(
            <SlideSidebar
                presentation={presentation}
                stylesheets={[ ":host { --r-main-color: black; }", ".reveal { color: var(--r-main-color); }" ]}
                closingContents={closingContents}
            />,
            container
        );
    });
    const sidebar = container.querySelector<HTMLElement>(".presentation-sidebar");
    if (!sidebar) throw new Error("The sidebar did not render.");
    return sidebar;
}
