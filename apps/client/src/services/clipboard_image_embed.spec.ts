import { TRILIUM_SRC_ATTRIBUTE } from "@triliumnext/commons";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { setupClipboardImageEmbed } from "./clipboard_image_embed.js";
import { embedReferenceImageAsDataUrl, resetImageEmbedBudget } from "./image.js";
import options from "./options.js";

vi.mock("./image.js", () => ({
    embedReferenceImageAsDataUrl: vi.fn(),
    resetImageEmbedBudget: vi.fn()
}));

vi.mock("./options.js", () => ({
    default: { get: vi.fn() }
}));

/** A representative internal image reference and the data: URI the canvas resolver hands back. */
const REFERENCE = "api/images/noteId123/photo.png";
const DATA_URI = "data:image/png;base64,AAAA";

describe("clipboard image embed", () => {

    beforeAll(() => {
        // Registered once: the listeners live on `document` for the lifetime of the app, and
        // re-registering per test would serve each payload several times over.
        setupClipboardImageEmbed();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(options.get).mockReturnValue("true");
        vi.mocked(embedReferenceImageAsDataUrl).mockReturnValue(DATA_URI);
    });

    afterEach(() => {
        // Restores any spy a single test installed (e.g. on `getSelection`) without touching the
        // module mocks above, which are not spies.
        vi.restoreAllMocks();
    });

    describe("on copy", () => {
        it("embeds an internal image, stashes the reference and takes over the payload", () => {
            renderAndSelect(`<div class="ck-content"><p>before <img src="${REFERENCE}"> after</p></div>`);

            const { store, defaultPrevented } = fireClipboardEvent("copy");

            expect(store["text/html"]).toContain(`src="${DATA_URI}"`);
            expect(store["text/html"]).toContain(`${TRILIUM_SRC_ATTRIBUTE}="${REFERENCE}"`);
            // The plain-text flavor still carries what the browser would have written.
            expect(store["text/plain"]).toBe("before  after");
            expect(defaultPrevented).toBe(true);
            expect(embedReferenceImageAsDataUrl).toHaveBeenCalledWith(REFERENCE);
        });

        it("re-wraps the ancestor context so a selection inside a list still pastes as a list", () => {
            const container = render(`<div class="ck-content"><ul><li><p>item <img src="${REFERENCE}"></p></li></ul></div>`);
            selectContentsOf(container.querySelector("p") as HTMLElement);

            const { store } = fireClipboardEvent("copy");

            // cloneContents() alone would yield the bare paragraph contents, losing <ul>/<li>.
            expect(store["text/html"]).toBe(`<ul><li><p>item <img src="${DATA_URI}" ${TRILIUM_SRC_ATTRIBUTE}="${REFERENCE}"></p></li></ul>`);
        });

        it("leaves the event alone when nothing in the selection can be embedded", () => {
            vi.mocked(embedReferenceImageAsDataUrl).mockReturnValue(null);
            renderAndSelect(`<div class="ck-content"><p>text <img src="https://example.com/x.png"></p></div>`);

            const { store, defaultPrevented } = fireClipboardEvent("copy");

            // Falling through to the browser's own (higher-fidelity) serialization.
            expect(store).toEqual({});
            expect(defaultPrevented).toBe(false);
        });

        it("stays out of the text editor, which serves its own payload", () => {
            renderAndSelect(`<div class="ck-editor__editable ck-content"><p>text <img src="${REFERENCE}"></p></div>`);

            const { store, defaultPrevented } = fireClipboardEvent("copy");

            expect(store).toEqual({});
            expect(defaultPrevented).toBe(false);
            expect(embedReferenceImageAsDataUrl).not.toHaveBeenCalled();
        });

        it("embeds across several containers, as an LLM chat answer renders one per markdown block", () => {
            // Each block is its own ReadOnlyTextContent, so selecting a whole reply anchors on the
            // wrapper above them rather than inside any single one.
            renderAndSelect(`<div class="llm-chat-message">
                <div class="ck-content llm-chat-markdown"><p>first <img src="${REFERENCE}"></p></div>
                <div class="ck-content llm-chat-markdown"><p>second</p></div>
            </div>`);

            const { store, defaultPrevented } = fireClipboardEvent("copy");

            expect(store["text/html"]).toContain(`src="${DATA_URI}"`);
            expect(store["text/html"]).toContain("second");
            expect(defaultPrevented).toBe(true);
        });

        it("keeps out of a multi-container selection that takes the text editor in with it", () => {
            renderAndSelect(`<div class="pane">
                <div class="ck-content"><p><img src="${REFERENCE}"></p></div>
                <div class="ck-editor__editable ck-content"><p>editable</p></div>
            </div>`);

            const { store, defaultPrevented } = fireClipboardEvent("copy");

            expect(store).toEqual({});
            expect(defaultPrevented).toBe(false);
        });

        it("ignores a selection outside rendered note content", () => {
            renderAndSelect(`<div class="tree"><p>a tree item <img src="${REFERENCE}"></p></div>`);

            const { store } = fireClipboardEvent("copy");

            expect(store).toEqual({});
            expect(embedReferenceImageAsDataUrl).not.toHaveBeenCalled();
        });

        it("does nothing when the kill-switch option is disabled", () => {
            vi.mocked(options.get).mockReturnValue("false");
            renderAndSelect(`<div class="ck-content"><p>text <img src="${REFERENCE}"></p></div>`);

            const { store } = fireClipboardEvent("copy");

            expect(store).toEqual({});
            expect(embedReferenceImageAsDataUrl).not.toHaveBeenCalled();
        });

        it("skips an image that already carries the marker, so the pass is idempotent", () => {
            renderAndSelect(`<div class="ck-content"><p><img src="${DATA_URI}" ${TRILIUM_SRC_ATTRIBUTE}="${REFERENCE}"></p></div>`);

            const { store, defaultPrevented } = fireClipboardEvent("copy");

            expect(embedReferenceImageAsDataUrl).not.toHaveBeenCalled();
            expect(store).toEqual({});
            expect(defaultPrevented).toBe(false);
        });
    });

    describe("on dragstart", () => {
        it("embeds a dragged image without cancelling the drag", () => {
            const container = render(`<div class="ck-content"><p><img src="${REFERENCE}"></p></div>`);
            const image = container.querySelector("img") as HTMLImageElement;

            const { store, defaultPrevented } = fireDragStart(image);

            expect(store["text/html"]).toContain(`src="${DATA_URI}"`);
            expect(store["text/html"]).toContain(`${TRILIUM_SRC_ATTRIBUTE}="${REFERENCE}"`);
            // preventDefault() here would abort the drag outright.
            expect(defaultPrevented).toBe(false);
        });

        it("does not embed an image dragged from outside note content", () => {
            const container = render(`<div class="tree"><img src="${REFERENCE}"></div>`);

            const { store } = fireDragStart(container.querySelector("img") as HTMLImageElement);

            expect(store).toEqual({});
        });

        it("never substitutes the current selection for an image it declined to embed", () => {
            // An image dragged out of the editor is the editor's business. The selection live at
            // that moment belongs to unrelated content, so falling back to it would put the wrong
            // note's content into the drag.
            document.body.innerHTML = `
                <div class="ck-content"><p>unrelated <img src="${REFERENCE}"></p></div>
                <div class="ck-editor__editable ck-content"><p><img src="${REFERENCE}" id="dragged"></p></div>`;
            selectContentsOf(document.querySelector(".ck-content") as HTMLElement);

            const { store } = fireDragStart(document.querySelector("#dragged") as HTMLImageElement);

            expect(store).toEqual({});
        });
    });

    it("hands a multi-range selection back to the browser rather than copying only part of it", () => {
        const container = render(`<div class="ck-content"><p id="a">one <img src="${REFERENCE}"></p><p id="b">two</p></div>`);
        selectContentsOf(container.querySelector("#a") as HTMLElement);
        // Only Firefox actually builds these (Ctrl+drag); Chrome — and happy-dom with it — keeps a
        // single range, so the second one has to be simulated to exercise the guard at all. The
        // guard returns before reading anything else off the selection.
        vi.spyOn(window, "getSelection").mockReturnValue({ isCollapsed: false, rangeCount: 2 } as unknown as Selection);

        const { store, defaultPrevented } = fireClipboardEvent("copy");

        expect(store).toEqual({});
        expect(defaultPrevented).toBe(false);
    });

    it("resets the shared embed budget for every copy, cut and drag, including ones it does not serve", () => {
        // The editor consumes the same budget, so the reset has to happen even when this listener
        // hands the payload back — otherwise a previous copy's spend would carry over into it.
        renderAndSelect(`<div class="ck-editor__editable ck-content"><p><img src="${REFERENCE}"></p></div>`);

        fireClipboardEvent("copy");
        fireClipboardEvent("cut");
        fireDragStart(document.querySelector("img") as HTMLImageElement);

        expect(resetImageEmbedBudget).toHaveBeenCalledTimes(3);
    });
});

function render(html: string) {
    document.body.innerHTML = html;
    return document.body.firstElementChild as HTMLElement;
}

function renderAndSelect(html: string) {
    selectContentsOf(render(html));
}

function selectContentsOf(node: Node) {
    const range = document.createRange();
    range.selectNodeContents(node);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}

/** Dispatch a copy/cut carrying a recording `clipboardData`, and report what was written to it. */
function fireClipboardEvent(type: "copy" | "cut") {
    const store: Record<string, string> = {};
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
        value: { setData: (name: string, data: string) => { store[name] = data; } }
    });

    document.dispatchEvent(event);

    return { store, defaultPrevented: event.defaultPrevented };
}

/** Dispatch a dragstart from `target` carrying a recording `dataTransfer`. */
function fireDragStart(target: HTMLElement) {
    const store: Record<string, string> = {};
    const event = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
        value: { setData: (name: string, data: string) => { store[name] = data; } }
    });

    target.dispatchEvent(event);

    return { store, defaultPrevented: event.defaultPrevented };
}
