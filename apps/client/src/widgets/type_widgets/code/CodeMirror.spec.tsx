import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderComponent } from "../../../test/render";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// The real `@triliumnext/codemirror` pulls in the entire CodeMirror stack (themes, languages, the
// EditorView DOM machinery) which neither builds nor behaves under happy-dom. We replace it with a
// lightweight fake that records every constructor option and method call so we can assert that the
// component drives the editor correctly through its effects.

interface FakeInstance {
    parent: HTMLElement;
    opts: Record<string, unknown>;
    setText: ReturnType<typeof vi.fn>;
    setMimeType: ReturnType<typeof vi.fn>;
    clearHistory: ReturnType<typeof vi.fn>;
    setLineWrapping: ReturnType<typeof vi.fn>;
    setIndent: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
}

const instances: FakeInstance[] = [];

vi.mock("@triliumnext/codemirror", () => {
    class FakeCodeMirror {
        parent: HTMLElement;
        opts: Record<string, unknown>;
        setText = vi.fn();
        setMimeType = vi.fn();
        clearHistory = vi.fn();
        setLineWrapping = vi.fn();
        setIndent = vi.fn();
        destroy = vi.fn();

        constructor(config: { parent: HTMLElement } & Record<string, unknown>) {
            const { parent, ...opts } = config;
            this.parent = parent;
            this.opts = opts;
            instances.push(this as unknown as FakeInstance);
        }
    }
    return { default: FakeCodeMirror };
});

import { Ref } from "preact";

import CodeMirror, { type CodeMirrorProps } from "./CodeMirror";

// --- Harness -------------------------------------------------------------------------------------

let currentRerender: ((vnode: unknown) => void) | undefined;
let currentUnmount: (() => void) | undefined;

function renderCodeMirror(props: CodeMirrorProps) {
    const { container, rerender, unmount } = renderComponent(<CodeMirror {...props} />);
    currentRerender = rerender;
    currentUnmount = unmount;
    return container;
}

function rerender(props: CodeMirrorProps) {
    if (!currentRerender) throw new Error("renderCodeMirror must be called before rerender");
    currentRerender(<CodeMirror {...props} />);
}

function lastInstance() {
    const inst = instances.at(-1);
    if (!inst) throw new Error("no fake CodeMirror instance was created");
    return inst;
}

beforeEach(() => {
    instances.length = 0;
    currentRerender = undefined;
    currentUnmount = undefined;
});

// --- Tests ---------------------------------------------------------------------------------------

describe("CodeMirror", () => {
    it("renders a <pre> with the given className and creates an editor parented to it", () => {
        const root = renderCodeMirror({ mime: "text/plain", className: "my-code" });
        const pre = root.querySelector("pre");
        expect(pre).not.toBeNull();
        expect(pre?.className).toBe("my-code");

        // The effect ran and constructed exactly one editor parented to the <pre>.
        expect(instances.length).toBe(1);
        expect(lastInstance().parent).toBe(pre);
    });

    it("renders without a className (className attribute absent)", () => {
        const root = renderCodeMirror({ mime: "text/plain" });
        const pre = root.querySelector("pre");
        // Preact leaves the class attribute off entirely when undefined.
        expect(pre?.getAttribute("class")).toBeNull();
        expect(instances.length).toBe(1);
    });

    it("applies initial content/mime and forwards extra editor options to the constructor", () => {
        renderCodeMirror({
            mime: "text/javascript",
            content: "const a = 1;",
            placeholder: "type here",
            readOnly: true,
            tabIndex: 3
        });
        const inst = lastInstance();
        // extraOpts are spread into the constructor config (parent excluded).
        expect(inst.opts).toMatchObject({ placeholder: "type here", readOnly: true, tabIndex: 3 });

        // Content effect: setText + setMimeType + clearHistory on mount.
        expect(inst.setText).toHaveBeenCalledWith("const a = 1;");
        expect(inst.setMimeType).toHaveBeenCalledWith("text/javascript");
        expect(inst.clearHistory).toHaveBeenCalledTimes(1);
    });

    it("defaults content to an empty string when not provided", () => {
        renderCodeMirror({ mime: "text/plain" });
        expect(lastInstance().setText).toHaveBeenCalledWith("");
    });

    it("invokes onInitialized once after the editor is created", () => {
        const onInitialized = vi.fn();
        renderCodeMirror({ mime: "text/plain", onInitialized });
        expect(onInitialized).toHaveBeenCalledTimes(1);
    });

    it("does not throw when onInitialized is omitted", () => {
        expect(() => renderCodeMirror({ mime: "text/plain" })).not.toThrow();
        expect(instances.length).toBe(1);
    });

    it("publishes the editor through an object editorRef", () => {
        const editorRef: Ref<unknown> = { current: null };
        renderCodeMirror({ mime: "text/plain", editorRef: editorRef as CodeMirrorProps["editorRef"] });
        expect(editorRef.current).toBe(lastInstance());
    });

    it("publishes the editor through a function editorRef", () => {
        const editorRef = vi.fn();
        renderCodeMirror({ mime: "text/plain", editorRef: editorRef as unknown as CodeMirrorProps["editorRef"] });
        expect(editorRef).toHaveBeenCalledTimes(1);
        expect(editorRef).toHaveBeenCalledWith(lastInstance());
    });

    it("exposes the <pre> through an object containerRef", () => {
        const containerRef: Ref<unknown> = { current: null };
        const root = renderCodeMirror({ mime: "text/plain", containerRef: containerRef as CodeMirrorProps["containerRef"] });
        expect(containerRef.current).toBe(root.querySelector("pre"));
    });

    it("reacts to content changes by replaying setText/setMimeType/clearHistory", () => {
        renderCodeMirror({ mime: "text/plain", content: "first" });
        const inst = lastInstance();
        inst.setText.mockClear();
        inst.setMimeType.mockClear();
        inst.clearHistory.mockClear();

        rerender({ mime: "text/plain", content: "second" });
        expect(inst.setText).toHaveBeenCalledWith("second");
        expect(inst.setMimeType).toHaveBeenCalledWith("text/plain");
        expect(inst.clearHistory).toHaveBeenCalledTimes(1);

        // No new editor instance should be constructed (effect with [] deps runs once).
        expect(instances.length).toBe(1);
    });

    it("reacts to mime changes independently of content", () => {
        renderCodeMirror({ mime: "text/plain", content: "x" });
        const inst = lastInstance();
        inst.setMimeType.mockClear();
        inst.setText.mockClear();

        rerender({ mime: "application/json", content: "x" });
        // The mime effect fires; content effect does not (content unchanged).
        expect(inst.setMimeType).toHaveBeenCalledWith("application/json");
        expect(inst.setText).not.toHaveBeenCalled();
    });

    it("reacts to line-wrapping changes, coercing to a boolean", () => {
        renderCodeMirror({ mime: "text/plain", lineWrapping: false });
        const inst = lastInstance();
        // Mount call.
        expect(inst.setLineWrapping).toHaveBeenLastCalledWith(false);

        rerender({ mime: "text/plain", lineWrapping: true });
        expect(inst.setLineWrapping).toHaveBeenLastCalledWith(true);
    });

    it("sets indent on mount when indentSize is provided", () => {
        renderCodeMirror({ mime: "text/plain", indentSize: 2 });
        expect(lastInstance().setIndent).toHaveBeenCalledWith(2, false);
    });

    it("sets indent on mount when useTabs is provided, defaulting size to 4", () => {
        renderCodeMirror({ mime: "text/plain", useTabs: true });
        expect(lastInstance().setIndent).toHaveBeenCalledWith(4, true);
    });

    it("does not touch indent when neither indentSize nor useTabs is set", () => {
        renderCodeMirror({ mime: "text/plain" });
        expect(lastInstance().setIndent).not.toHaveBeenCalled();
    });

    it("reacts to indent size / style changes after mount", () => {
        renderCodeMirror({ mime: "text/plain", indentSize: 2, useTabs: false });
        const inst = lastInstance();
        inst.setIndent.mockClear();

        rerender({ mime: "text/plain", indentSize: 8, useTabs: true });
        expect(inst.setIndent).toHaveBeenCalledWith(8, true);
    });

    it("destroys the editor on unmount", () => {
        renderCodeMirror({ mime: "text/plain" });
        const inst = lastInstance();
        currentUnmount?.();
        expect(inst.destroy).toHaveBeenCalledTimes(1);
    });
});
