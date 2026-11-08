import { h, render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";
import SlideEditor, { adoptEditorStyleSheet, collectEditorStylesheet, whenEditorHoldsContent } from "./slide_editor";

vi.mock("../../type_widgets/text/TextEmbedEditor", () => ({
    default: () => h("div", { className: "text-embed-editor" })
}));

describe("whenEditorHoldsContent", () => {
    function setUp(noteContent: string) {
        const root = document.createElement("div");
        const note = { getContent: async () => noteContent } as unknown as FNote;
        const onReady = vi.fn();
        const focus = vi.fn();
        const stop = whenEditorHoldsContent(root, note, onReady);

        /** Mounts an editor root as CKEditor does, holding `data`. */
        function mountEditor(data: string, { hidden = false } = {}) {
            const editable = document.createElement("div");
            editable.className = "ck-editor__editable";
            editable.style.visibility = hidden ? "hidden" : "";
            Object.assign(editable, {
                ckeditorInstance: {
                    getData: () => data,
                    editing: { view: { focus, getDomRoot: () => editable } }
                }
            });
            root.replaceChildren(editable);
            document.body.append(root);
            return editable;
        }
        return { onReady, focus, stop, mountEditor };
    }

    it("focuses the editor only once it is shown", async () => {
        const { onReady, focus, mountEditor } = setUp("<p>Slide</p>");
        const editable = mountEditor("<p>Slide</p>", { hidden: true });
        await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce());
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(focus).not.toHaveBeenCalled();

        editable.style.visibility = "";
        await vi.waitFor(() => expect(focus).toHaveBeenCalledOnce());
    });

    it("waits for the note's content before reporting the editor ready, then focuses it", async () => {
        const { onReady, focus, mountEditor } = setUp("<p>Slide</p>");
        mountEditor("");
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(onReady).not.toHaveBeenCalled();

        mountEditor("<p>Slide</p>");
        await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(focus).toHaveBeenCalledOnce());
    });

    it("reports an empty note ready once its editor exists, and nothing after stopping", async () => {
        const empty = setUp("");
        empty.mountEditor("");
        await vi.waitFor(() => expect(empty.onReady).toHaveBeenCalledOnce());

        const stopped = setUp("<p>Slide</p>");
        stopped.stop();
        stopped.mountEditor("<p>Slide</p>");
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(stopped.onReady).not.toHaveBeenCalled();
    });

    it("shows the editor anyway when it takes too long to load", async () => {
        vi.useFakeTimers();
        try {
            const { onReady } = setUp("<p>Slide</p>");
            await vi.advanceTimersByTimeAsync(2999);
            expect(onReady).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(onReady).toHaveBeenCalledOnce();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("adoptEditorStyleSheet", () => {
    it("shares one stylesheet between edits and removes only its own", () => {
        const first = document.createElement("div").attachShadow({ mode: "open" });
        const second = document.createElement("div").attachShadow({ mode: "open" });
        const other = new CSSStyleSheet();
        first.adoptedStyleSheets = [ other ];

        const removeFirst = adoptEditorStyleSheet(first);
        const removeSecond = adoptEditorStyleSheet(second);
        const [ , sheet ] = first.adoptedStyleSheets;
        expect(sheet).toBeInstanceOf(CSSStyleSheet);
        expect(second.adoptedStyleSheets).toHaveLength(1);
        expect(second.adoptedStyleSheets[0]).toBe(sheet);

        removeFirst();
        expect(first.adoptedStyleSheets).toHaveLength(1);
        expect(first.adoptedStyleSheets[0]).toBe(other);
        expect(second.adoptedStyleSheets[0]).toBe(sheet);
        removeSecond();
        expect(second.adoptedStyleSheets).toHaveLength(0);
    });
});

describe("collectEditorStylesheet", () => {
    it("copies the editor's UI rules and leaves out the content rules", () => {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(`
            .ck.ck-toolbar { color: red; }
            .ck-editor__editable .ck-code-block__type-around__button svg { width: 10px; }
            .ck-content h2 { font-size: 3em; }
            .note-detail-editable-text h3 { font-size: 2em; }
            :root, :host { --ck-color-text: black; }
            @media (max-width: 600px) {
                .ck-balloon-panel { max-width: 90vw; }
                .ck-content p { margin: 0; }
            }
            @media print {
                .ck-content table { border: 0; }
            }
            @keyframes ck-highlight { from { opacity: 0; } }
        `);

        const css = collectEditorStylesheet([ sheet ]);

        expect(css).toContain(".ck.ck-toolbar");
        expect(css).toContain(".ck-code-block__type-around__button svg");
        expect(css).toContain("@media (max-width: 600px)");
        expect(css).toContain(".ck-balloon-panel");
        expect(css).toContain("@keyframes ck-highlight");
        expect(css).not.toContain(".ck-content");
        expect(css).not.toContain(".note-detail-editable-text");
        expect(css).not.toContain("--ck-color-text");
        expect(css).not.toContain("@media print");
    });

    it("skips a stylesheet whose rules cannot be read", () => {
        const crossOrigin = {
            get cssRules(): CSSRuleList {
                throw new DOMException("cross-origin", "SecurityError");
            }
        } as CSSStyleSheet;
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(".ck-toolbar { color: red; }");

        expect(collectEditorStylesheet([ crossOrigin, sheet ])).toContain(".ck-toolbar");
    });
});

describe("SlideEditor", () => {
    it("styles the editor in the slide's shadow root, and finishes on an Escape the editor left alone", async () => {
        const host = document.createElement("div");
        document.body.append(host);
        const shadowRoot = host.attachShadow({ mode: "open" });
        const note = { noteId: "slide", getContent: async () => "" } as unknown as FNote;
        const onFinish = vi.fn();
        await act(async () => render(
            h(SlideEditor, { note, onReady: vi.fn(), onFinish, onClose: vi.fn() }),
            shadowRoot
        ));
        expect(shadowRoot.adoptedStyleSheets).toHaveLength(1);
        const root = shadowRoot.querySelector(".slide-editor-root");
        expect(root?.querySelector(".text-embed-editor")).not.toBeNull();

        const press = (key: string, isHandled = false) => {
            const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
            if (isHandled) event.preventDefault();
            root?.dispatchEvent(event);
            return event.defaultPrevented;
        };
        expect(press("Escape", true)).toBe(true);
        expect(press("a")).toBe(false);
        expect(onFinish).not.toHaveBeenCalled();
        expect(press("Escape")).toBe(true);
        expect(onFinish).toHaveBeenCalledOnce();

        await act(async () => render(null, shadowRoot));
        expect(shadowRoot.adoptedStyleSheets).toHaveLength(0);
        host.remove();
    });
});
