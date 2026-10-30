import { render } from "preact";
import { act } from "preact/test-utils";
import type { RevealApi } from "reveal.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PresentationModel } from "./model";
import SlideSidebar from "./sidebar";

vi.mock("../../../services/froca", () => ({
    default: { getNoteFromCache: (noteId: string) => ({ title: `Title of ${noteId}`, getIcon: () => "bx bx-columns" }) }
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
        const sidebar = renderSidebar({ closingContents: { first: { __html: "<p>Edited</p>" } } });

        const root = sidebar.querySelector<HTMLElement>(".slide-thumbnail[data-note-id=first]")?.shadowRoot;
        expect(root?.querySelector(".slide-content")?.innerHTML).toBe("<p>Edited</p>");
    });

    it("marks the active slide and scrolls it into view as it changes", () => {
        const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
        const sidebar = renderSidebar({ activeNoteId: "intro" });
        const getActive = () => [ ...sidebar.querySelectorAll(".slide-thumbnail.active") ]
            .map(thumbnail => thumbnail.getAttribute("data-note-id"));

        expect(getActive()).toEqual([ "intro" ]);
        expect(getButton(sidebar, "intro").getAttribute("aria-current")).toBe("true");
        expect(scrollIntoView.mock.contexts.at(-1)).toBe(sidebar.querySelector("[data-note-id=intro]"));

        const container = sidebar.parentElement ?? undefined;
        renderSidebar({ activeNoteId: "second", container });
        expect(getActive()).toEqual([ "second" ]);
        expect(getButton(sidebar, "intro").hasAttribute("aria-current")).toBe(false);
        expect(scrollIntoView.mock.contexts.at(-1)).toBe(sidebar.querySelector("[data-note-id=second]"));

        renderSidebar({ activeNoteId: "board", container });
        expect(getActive()).toEqual([ "board" ]);
        scrollIntoView.mockRestore();
    });

    it("selects the slide of a clicked thumbnail, without taking the keyboard from the slides", () => {
        const onSelectSlide = vi.fn();
        const sidebar = renderSidebar({ onSelectSlide });

        const button = getButton(sidebar, "second");
        expect(button.getAttribute("type")).toBe("button");
        expect(button.getAttribute("aria-label")).toBe("Title of second");
        button.click();
        getButton(sidebar, "web").click();
        expect(onSelectSlide.mock.calls).toEqual([ [ "second" ], [ "web" ] ]);

        const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        button.dispatchEvent(mouseDown);
        expect(mouseDown.defaultPrevented).toBe(true);
    });
});

function getButton(sidebar: HTMLElement, noteId: string) {
    const button = sidebar.querySelector(`[data-note-id=${noteId}]`)?.closest("button");
    if (!button) throw new Error(`The thumbnail of ${noteId} is not in a button.`);
    return button;
}

describe("useActiveSlideNoteId", () => {
    it("follows the slide that Reveal.js shows", async () => {
        const { useActiveSlideNoteId } = await import("./index");
        const listeners: (() => void)[] = [];
        let current = buildSection("intro");
        const api = {
            getCurrentSlide: () => current,
            on: (_event: string, listener: () => void) => listeners.push(listener),
            off: (_event: string, listener: () => void) => listeners.splice(listeners.indexOf(listener), 1)
        } as unknown as RevealApi;

        let activeNoteId: string | undefined;
        function Probe() {
            activeNoteId = useActiveSlideNoteId(api);
            return null;
        }
        const container = document.createElement("div");
        act(() => render(<Probe />, container));
        expect(activeNoteId).toBe("intro");

        current = buildSection("second");
        act(() => {
            for (const listener of listeners) listener();
        });
        expect(activeNoteId).toBe("second");

        act(() => render(null, container));
        expect(listeners).toHaveLength(0);
    });
});

function buildSection(noteId: string) {
    const section = document.createElement("section");
    section.dataset.noteId = noteId;
    return section;
}

const stylesheets = [ ":host { --r-main-color: black; }", ".reveal { color: var(--r-main-color); }" ];

interface RenderOptions {
    closingContents?: Record<string, { __html: string }>;
    activeNoteId?: string;
    onSelectSlide?: (noteId: string) => void;
    /** Renders again into the container of an earlier render. */
    container?: HTMLElement;
}

function renderSidebar({
    closingContents = {}, activeNoteId, onSelectSlide = () => {}, container = document.createElement("div")
}: RenderOptions = {}) {
    if (!container.isConnected) document.body.appendChild(container);
    act(() => {
        render(
            <SlideSidebar
                presentation={presentation}
                stylesheets={stylesheets}
                closingContents={closingContents}
                activeNoteId={activeNoteId}
                onSelectSlide={onSelectSlide}
            />,
            container
        );
    });
    const sidebar = container.querySelector<HTMLElement>(".presentation-sidebar");
    if (!sidebar) throw new Error("The sidebar did not render.");
    return sidebar;
}
