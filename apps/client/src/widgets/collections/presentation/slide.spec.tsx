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

describe("collection slides", () => {
    afterEach(() => {
        vi.doUnmock("../NoteList");
        vi.resetModules();
        document.body.replaceChildren();
    });

    it("shows each collection slide through its slot, with the app's note list", async () => {
        vi.doMock("../NoteList", () => ({
            EmbeddedNoteList: ({ note }: { note: { noteId: string } }) => <div className="mock-note-list">{note.noteId}</div>
        }));
        const { buildNote } = await import("../../../test/easy-froca");
        const { CollectionSlides, Slide } = await import("./index");
        buildNote({ id: "board", title: "Board", type: "book", "#viewType": "board" });
        buildNote({ id: "table", title: "Table", type: "book", "#viewType": "table" });
        const boardSlide: PresentationSlideBaseModel = { noteId: "board", type: "book", content: { __html: "" }, isCollection: true };
        const tableSlide: PresentationSlideBaseModel = { noteId: "table", type: "book", content: { __html: "" }, isCollection: true };
        const textSlide: PresentationSlideBaseModel = { noteId: "text", type: "text", content: { __html: "<p>Text</p>" } };

        const slideContainer = document.createElement("div");
        render(<Slide slide={boardSlide} ntxId={undefined} />, slideContainer);
        const section = slideContainer.querySelector("section");
        expect(section?.classList.contains("collection-slide")).toBe(true);
        expect(section?.querySelector("slot")?.getAttribute("name")).toBe("collection-board");
        expect(section?.querySelector(".slide-content")).toBeNull();

        // A collection slide can also be a vertical slide; the text slide gets no note list.
        const host = document.createElement("div");
        document.body.append(host);
        render(<CollectionSlides
            presentation={{ slides: [ { ...textSlide, verticalSlides: [ boardSlide ] }, { ...tableSlide, verticalSlides: undefined } ] }}
            ntxId={undefined}
            onOpenNote={undefined}
        />, host);
        await vi.waitFor(() => expect(host.querySelectorAll(".mock-note-list")).toHaveLength(2));
        expect([ ...host.querySelectorAll(".presentation-collection-slide") ].map(wrapper => ({
            slot: wrapper.getAttribute("slot"),
            list: wrapper.textContent
        }))).toStrictEqual([
            { slot: "collection-board", list: "board" },
            { slot: "collection-table", list: "table" }
        ]);
    });

    it("leaves the keys of a field being typed in to the field", async () => {
        const { isTypingIn } = await import("./index");
        const keyFrom = (element: HTMLElement) => {
            let typing: boolean | undefined;
            element.addEventListener("keydown", (e) => { typing = isTypingIn(e); });
            document.body.append(element);
            element.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
            return typing;
        };

        const editable = document.createElement("div");
        editable.contentEditable = "true";
        expect([ "input", "textarea", "select" ].map(tag => keyFrom(document.createElement(tag)))).toStrictEqual([ true, true, true ]);
        expect(keyFrom(editable)).toBe(true);
        expect(keyFrom(document.createElement("div"))).toBe(false);
    });
});
