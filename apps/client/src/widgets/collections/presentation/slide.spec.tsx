import { render } from "preact";
import { act } from "preact/test-utils";
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
    const { Slide } = await import("./slides");

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

    it("shows each collection slide through its slot, read-only unless it is the edited slide", async () => {
        const listProps = new Map<string, { isReadOnly?: boolean, onOpenNote?: (noteId: string) => void }>();
        vi.doMock("../NoteList", () => ({
            EmbeddedNoteList: (props: { note: { noteId: string }, isReadOnly?: boolean, onOpenNote?: (noteId: string) => void }) => {
                listProps.set(props.note.noteId, props);
                return <div className="mock-note-list">{props.note.noteId}</div>;
            }
        }));
        const { buildNote } = await import("../../../test/easy-froca");
        const { CollectionSlides, Slide } = await import("./slides");
        buildNote({ id: "board", title: "Board", type: "book", "#viewType": "board" });
        buildNote({ id: "table", title: "Table", type: "book", "#viewType": "table" });
        const boardSlide: PresentationSlideBaseModel = { noteId: "board", type: "book", content: { __html: "" }, isCollection: true };
        const tableSlide: PresentationSlideBaseModel = { noteId: "table", type: "book", content: { __html: "" }, isCollection: true };
        const textSlide: PresentationSlideBaseModel = { noteId: "text", type: "text", content: { __html: "<p>Text</p>" } };

        const onOpenNote = vi.fn();
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
            editedNoteId="table"
            onOpenNote={onOpenNote}
        />, host);
        await vi.waitFor(() => expect(host.querySelectorAll(".mock-note-list")).toHaveLength(2));
        expect([ ...host.querySelectorAll(".presentation-collection-slide") ].map(wrapper => ({
            slot: wrapper.getAttribute("slot"),
            list: wrapper.textContent
        }))).toStrictEqual([
            { slot: "collection-board", list: "board" },
            { slot: "collection-table", list: "table" }
        ]);

        // Only the edited slide's collection can be changed, and only it opens the notes it selects.
        expect(listProps.get("board")?.isReadOnly).toBe(true);
        expect(listProps.get("table")?.isReadOnly).toBe(false);
        listProps.get("board")?.onOpenNote?.("card");
        expect(onOpenNote).not.toHaveBeenCalled();
        listProps.get("table")?.onOpenNote?.("row");
        expect(onOpenNote).toHaveBeenCalledWith("row");
        expect(host.querySelector('[slot="collection-table"]')?.classList.contains("is-edited")).toBe(true);
        expect(host.querySelector('[slot="collection-board"]')?.classList.contains("is-edited")).toBe(false);
    });

    it("leaves the keys of a field being typed in to the field", async () => {
        const { isTypingIn } = await import("./reveal");
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

describe("Presentation keys", () => {
    afterEach(() => {
        vi.doUnmock("reveal.js");
        vi.resetModules();
        document.body.replaceChildren();
    });

    it("starts the presentation on F, but leaves F to a field being typed in", async () => {
        let config: { keyboard?: Record<number, () => void>; keyboardCondition?: (e: KeyboardEvent) => boolean } = {};
        vi.doMock("reveal.js", () => ({
            default: class {
                constructor(_element: HTMLElement, options: typeof config) { config = options; }
                initialize() { return new Promise(() => {}); }
                destroy() {}
                isReady() { return false; }
            }
        }));
        const { Presentation } = await import("./slides");
        const onStartPresentation = vi.fn();
        const container = document.createElement("div");
        document.body.append(container);
        act(() => render(
            <Presentation
                presentation={{ slides: [] }}
                setApi={() => {}}
                ntxId={undefined}
                editedNoteId={undefined}
                isEditorReady={false}
                closingContents={{}}
                onEditSlide={undefined}
                onEditorHost={() => {}}
                pendingNoteId={undefined}
                onPendingSlideShown={() => {}}
                onStartPresentation={onStartPresentation}
            />,
            container
        ));

        config.keyboard?.[70]();
        expect(onStartPresentation).toHaveBeenCalledTimes(1);

        const press = (target: HTMLElement) => {
            let allowed: boolean | undefined;
            target.addEventListener("keydown", (e) => { allowed = config.keyboardCondition?.(e); });
            target.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true, composed: true }));
            return allowed;
        };
        const slides = document.createElement("div");
        const field = document.createElement("input");
        document.body.append(slides, field);
        expect(press(slides)).toBe(true);
        expect(press(field)).toBe(false);
    });
});
