import type { AttributeEditor, CKTextEditor, EditorConfig, ModelPosition } from "@triliumnext/ckeditor5";
import { render } from "preact";
import { act } from "preact/test-utils";
import type { MutableRef } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CKEditor, { type CKEditorApi } from "./CKEditor";

// --- Fake CKEditor implementation -----------------------------------------------------------------
//
// The component receives `editor` (a class with a static `create()`) and `config` as props, and only
// imports the ckeditor5 package for *types* (erased at runtime). We build a minimal fake editor that
// records the calls the component makes so each branch can be exercised without the heavy real editor.

interface DocEventHandler {
    event: string;
    handler: (...args: unknown[]) => void;
    options?: unknown;
}

class FakeWriter {
    setSelectionCalls: { root: unknown; position: unknown }[] = [];
    setAttributeCalls: { key: string; value: string; element: unknown }[] = [];

    createPositionAt(root: unknown, offset: unknown) {
        return { root, offset };
    }
    setSelection(position: unknown) {
        this.setSelectionCalls.push({ root: null, position });
    }
    setAttribute(key: string, value: string, element: unknown) {
        this.setAttributeCalls.push({ key, value, element });
    }
}

class FakeEditor {
    /** The instance produced by the most recent create() call (so tests can drive it). */
    static lastInstance: FakeEditor | undefined;
    /** When set, create() rejects (to verify the component swallows / never resolves). */
    static createImpl: ((el: HTMLElement, config: EditorConfig) => Promise<FakeEditor>) | undefined;

    container: HTMLElement;
    config: EditorConfig;
    data = "";
    focusCalls = 0;
    rootElement: unknown;
    viewDocEvents: DocEventHandler[] = [];
    modelDocEvents: DocEventHandler[] = [];
    viewWriter = new FakeWriter();
    modelWriter = new FakeWriter();
    firstPosition: ModelPosition | null = { kind: "first" } as unknown as ModelPosition;

    constructor(container: HTMLElement, config: EditorConfig) {
        this.container = container;
        this.config = config;
        this.rootElement = { name: "$root" };
    }

    static async create(el: HTMLElement, config: EditorConfig): Promise<FakeEditor> {
        if (FakeEditor.createImpl) {
            return FakeEditor.createImpl(el, config);
        }
        const instance = new FakeEditor(el, config);
        FakeEditor.lastInstance = instance;
        return instance;
    }

    // --- Shape the component reads ----------------------------------------------------------------
    get editing() {
        return {
            view: {
                focus: () => { this.focusCalls++; },
                document: {
                    on: (event: string, handler: (...args: unknown[]) => void, options?: unknown) => {
                        this.viewDocEvents.push({ event, handler, options });
                    },
                    getRoot: () => this.rootElement
                },
                change: (cb: (writer: FakeWriter) => void) => cb(this.viewWriter)
            },
            model: {
                document: {
                    getRoot: () => this.rootElement
                }
            }
        };
    }

    get model() {
        return {
            change: (cb: (writer: FakeWriter) => void) => cb(this.modelWriter),
            document: {
                on: (event: string, handler: (...args: unknown[]) => void) => {
                    this.modelDocEvents.push({ event, handler });
                },
                selection: {
                    getFirstPosition: () => this.firstPosition
                }
            }
        };
    }

    getData() {
        return this.data;
    }
    setData(text: string) {
        this.data = text;
    }

    /** Fire a previously-registered "change:data" handler (simulates a user edit). */
    triggerDataChange(newData: string) {
        this.data = newData;
        for (const { event, handler } of this.modelDocEvents) {
            if (event === "change:data") {
                handler();
            }
        }
    }

    /** Fire a previously-registered view-document "enter" handler. */
    triggerEnter() {
        const event = { stop: vi.fn() };
        const data = { preventDefault: vi.fn() };
        for (const reg of this.viewDocEvents) {
            if (reg.event === "enter") {
                reg.handler(event, data);
            }
        }
        return { event, data };
    }
}

const fakeEditor = FakeEditor as unknown as typeof AttributeEditor;
const fakeConfig = { toolbar: { items: [] } } as unknown as EditorConfig;

// --- Render harness --------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;

function renderInto(vnode: preact.ComponentChild) {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => { render(vnode, container ?? document.createElement("div")); });
    return container;
}

/** Wait for the create() promise + the .then() callback chain to settle and re-render. */
async function flushCreate() {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function makeApiRef(): MutableRef<CKEditorApi | undefined> {
    return { current: undefined };
}

beforeEach(() => {
    FakeEditor.lastInstance = undefined;
    FakeEditor.createImpl = undefined;
    vi.clearAllMocks();
});

afterEach(() => {
    if (container) {
        act(() => { render(null, container ?? document.createElement("div")); });
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- Tests -----------------------------------------------------------------------------------------

describe("CKEditor", () => {
    it("renders the container div and forwards restProps (className, tabIndex)", async () => {
        const apiRef = makeApiRef();
        const el = renderInto(
            <CKEditor apiRef={apiRef} editor={fakeEditor} config={fakeConfig} className="my-editor" tabIndex={3} />
        );
        const div = el.querySelector("div");
        expect(div).not.toBeNull();
        expect(div?.className).toBe("my-editor");
        expect(div?.getAttribute("tabindex")).toBe("3");
        // The create() call resolves asynchronously; settle it so no unhandled work leaks.
        await flushCreate();
        expect(FakeEditor.lastInstance).toBeDefined();
        expect(FakeEditor.lastInstance?.container).toBe(div);
        expect(FakeEditor.lastInstance?.config).toBe(fakeConfig);
    });

    it("registers a change:data handler and propagates getData() via onChange", async () => {
        const onChange = vi.fn();
        const apiRef = makeApiRef();
        renderInto(
            <CKEditor apiRef={apiRef} editor={fakeEditor} config={fakeConfig} className="c" onChange={onChange} />
        );
        await flushCreate();
        const instance = FakeEditor.lastInstance;
        expect(instance?.modelDocEvents.some((e) => e.event === "change:data")).toBe(true);
        instance?.triggerDataChange("<p>hi</p>");
        expect(onChange).toHaveBeenCalledWith("<p>hi</p>");
    });

    it("does NOT register a change:data handler when onChange is absent", async () => {
        const apiRef = makeApiRef();
        renderInto(<CKEditor apiRef={apiRef} editor={fakeEditor} config={fakeConfig} className="c" />);
        await flushCreate();
        expect(FakeEditor.lastInstance?.modelDocEvents.length).toBe(0);
    });

    it("sets initial data when currentValue is provided on init", async () => {
        const apiRef = makeApiRef();
        renderInto(
            <CKEditor apiRef={apiRef} editor={fakeEditor} config={fakeConfig} className="c" currentValue="<p>seed</p>" />
        );
        await flushCreate();
        expect(FakeEditor.lastInstance?.getData()).toBe("<p>seed</p>");
    });

    it("registers a high-priority enter handler that stops the event when disableNewlines is set", async () => {
        const apiRef = makeApiRef();
        renderInto(
            <CKEditor apiRef={apiRef} editor={fakeEditor} config={fakeConfig} className="c" disableNewlines />
        );
        await flushCreate();
        const instance = FakeEditor.lastInstance;
        const enterReg = instance?.viewDocEvents.find((e) => e.event === "enter");
        expect(enterReg).toBeDefined();
        expect(enterReg?.options).toEqual({ priority: "high" });
        const fired = instance?.triggerEnter();
        expect(fired?.data.preventDefault).toHaveBeenCalledTimes(1);
        expect(fired?.event.stop).toHaveBeenCalledTimes(1);
    });

    it("does not register an enter handler when disableNewlines is unset", async () => {
        const apiRef = makeApiRef();
        renderInto(<CKEditor apiRef={apiRef} editor={fakeEditor} config={fakeConfig} className="c" />);
        await flushCreate();
        expect(FakeEditor.lastInstance?.viewDocEvents.some((e) => e.event === "enter")).toBe(false);
    });

    it("sets spellcheck=false on the root when disableSpellcheck is set and a root exists", async () => {
        const apiRef = makeApiRef();
        renderInto(
            <CKEditor apiRef={apiRef} editor={fakeEditor} config={fakeConfig} className="c" disableSpellcheck />
        );
        await flushCreate();
        const calls = FakeEditor.lastInstance?.viewWriter.setAttributeCalls ?? [];
        expect(calls).toContainEqual(
            expect.objectContaining({ key: "spellcheck", value: "false" })
        );
    });

    it("skips spellcheck attribute writing when the root is null", async () => {
        const apiRef = makeApiRef();
        // Make create() return an instance whose view document has no root.
        FakeEditor.createImpl = async (el, config) => {
            const instance = new FakeEditor(el, config);
            instance.rootElement = null;
            FakeEditor.lastInstance = instance;
            return instance;
        };
        renderInto(
            <CKEditor apiRef={apiRef} editor={fakeEditor} config={fakeConfig} className="c" disableSpellcheck />
        );
        await flushCreate();
        expect(FakeEditor.lastInstance?.viewWriter.setAttributeCalls.length).toBe(0);
    });

    it("calls onInitialized with the created editor instance", async () => {
        const onInitialized = vi.fn();
        const apiRef = makeApiRef();
        renderInto(
            <CKEditor apiRef={apiRef} editor={fakeEditor} config={fakeConfig} className="c" onInitialized={onInitialized} />
        );
        await flushCreate();
        expect(onInitialized).toHaveBeenCalledTimes(1);
        expect(onInitialized).toHaveBeenCalledWith(FakeEditor.lastInstance);
    });

    it("exposes setText() on the apiRef that delegates to the editor", async () => {
        const apiRef = makeApiRef();
        renderInto(<CKEditor apiRef={apiRef} editor={fakeEditor} config={fakeConfig} className="c" />);
        await flushCreate();
        expect(apiRef.current).toBeDefined();
        apiRef.current?.setText("<p>typed</p>");
        expect(FakeEditor.lastInstance?.getData()).toBe("<p>typed</p>");
    });

    it("exposes focus() that focuses the view and moves the selection to the end", async () => {
        const apiRef = makeApiRef();
        renderInto(<CKEditor apiRef={apiRef} editor={fakeEditor} config={fakeConfig} className="c" />);
        await flushCreate();
        apiRef.current?.focus();
        const instance = FakeEditor.lastInstance;
        expect(instance?.focusCalls).toBe(1);
        expect(instance?.modelWriter.setSelectionCalls.length).toBe(1);
    });

    it("focus() skips moving the selection when the model has no document root", async () => {
        const apiRef = makeApiRef();
        renderInto(<CKEditor apiRef={apiRef} editor={fakeEditor} config={fakeConfig} className="c" />);
        await flushCreate();
        const instance = FakeEditor.lastInstance;
        // getRoot() now returns null → the `if (documentRoot)` guard is false.
        if (instance) {
            instance.rootElement = null;
        }
        apiRef.current?.focus();
        expect(instance?.focusCalls).toBe(1);
        expect(instance?.modelWriter.setSelectionCalls.length).toBe(0);
    });

    it("re-applies data via the currentValue effect when the prop changes after init", async () => {
        const apiRef = makeApiRef();
        const baseProps = { apiRef, editor: fakeEditor, config: fakeConfig, className: "c" };
        renderInto(<CKEditor {...baseProps} currentValue="first" />);
        await flushCreate();
        const instance = FakeEditor.lastInstance;
        expect(instance?.getData()).toBe("first");
        // Re-render with a changed currentValue → second useEffect fires setData(newValue).
        act(() => { render(<CKEditor {...baseProps} currentValue="second" />, container ?? document.createElement("div")); });
        await flushCreate();
        expect(instance?.getData()).toBe("second");
    });

    it("re-applies empty string when currentValue becomes undefined", async () => {
        const apiRef = makeApiRef();
        const baseProps = { apiRef, editor: fakeEditor, config: fakeConfig, className: "c" };
        renderInto(<CKEditor {...baseProps} currentValue="something" />);
        await flushCreate();
        const instance = FakeEditor.lastInstance;
        instance?.setData("dirty");
        act(() => { render(<CKEditor {...baseProps} currentValue={undefined} />, container ?? document.createElement("div")); });
        await flushCreate();
        expect(instance?.getData()).toBe("");
    });

    it("fires onClick with the event and the first selection position when clicked", async () => {
        const onClick = vi.fn();
        const apiRef = makeApiRef();
        const el = renderInto(
            <CKEditor apiRef={apiRef} editor={fakeEditor} config={fakeConfig} className="c" onClick={onClick} />
        );
        await flushCreate();
        const div = el.querySelector("div");
        act(() => { div?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        expect(onClick).toHaveBeenCalledTimes(1);
        const [ evtArg, posArg ] = onClick.mock.calls[0] ?? [];
        expect(evtArg).toBeInstanceOf(MouseEvent);
        expect(posArg).toEqual({ kind: "first" });
    });

    it("does nothing on click when onClick is not provided", async () => {
        const apiRef = makeApiRef();
        const el = renderInto(<CKEditor apiRef={apiRef} editor={fakeEditor} config={fakeConfig} className="c" />);
        await flushCreate();
        const div = el.querySelector("div");
        // Should not throw even though no handler is wired.
        expect(() => act(() => { div?.dispatchEvent(new MouseEvent("click", { bubbles: true })); })).not.toThrow();
    });

    it("supplies a null position to onClick when there is no selection yet (textEditor unset)", async () => {
        const onClick = vi.fn();
        const apiRef = makeApiRef();
        // create() never resolves → textEditorRef stays null when the click happens.
        FakeEditor.createImpl = () => new Promise<FakeEditor>(() => { /* never resolves */ });
        const el = renderInto(
            <CKEditor apiRef={apiRef} editor={fakeEditor} config={fakeConfig} className="c" onClick={onClick} />
        );
        const div = el.querySelector("div");
        act(() => { div?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        expect(onClick).toHaveBeenCalledTimes(1);
        const [ , posArg ] = onClick.mock.calls[0] ?? [];
        expect(posArg).toBeUndefined();
    });
});
