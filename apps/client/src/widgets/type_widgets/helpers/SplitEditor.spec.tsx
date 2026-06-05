import type { ComponentChildren, VNode } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) ---------------------------------------------

// Capture the Split.js calls so the desktop "split" effect can be asserted without a real layout.
// These collectors are referenced inside hoisted vi.mock factories, so they must be hoisted too.
const { splitCalls, splitInstances, editableProps, readonlyProps } = vi.hoisted(() => ({
    splitCalls: [] as Array<{ elements: unknown; options: Record<string, unknown> }>,
    splitInstances: [] as Array<{ destroy: ReturnType<typeof vi.fn> }>,
    editableProps: [] as Array<Record<string, unknown>>,
    readonlyProps: [] as Array<Record<string, unknown>>
}));
vi.mock("@triliumnext/split.js", () => {
    const Split = vi.fn((elements: unknown, options: Record<string, unknown>) => {
        splitCalls.push({ elements, options });
        const instance = { destroy: vi.fn() };
        splitInstances.push(instance);
        return instance;
    });
    return { default: Split };
});

// Replace the heavy CodeMirror-backed editors with lightweight markers that record their props.
vi.mock("../code/Code", () => ({
    EditableCode: (props: Record<string, unknown>) => {
        editableProps.push(props);
        return <div className="mock-editable-code" />;
    },
    ReadOnlyCode: (props: Record<string, unknown>) => {
        readonlyProps.push(props);
        return <div className="mock-readonly-code" />;
    }
}));

// `utils.isDesktop()` drives the split effect; `isMobile()` drives the orientation hook. Default to a
// desktop, non-mobile environment; individual tests override via the captured spies. Hoisted so the
// (also-hoisted) factory below can reference them.
const { isMobileSpy, isDesktopSpy } = vi.hoisted(() => ({
    isMobileSpy: vi.fn(() => false),
    isDesktopSpy: vi.fn(() => true)
}));
vi.mock("../../../services/utils", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../../services/utils")>();
    return {
        ...original,
        default: { ...original.default, isDesktop: isDesktopSpy },
        isMobile: isMobileSpy
    };
});

// ActionButton (used by PreviewButton) pulls in bootstrap tooltips + the keyboard-actions service.
vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    return { Tooltip, default: { Tooltip } };
});
vi.mock("../../../services/keyboard_actions", () => ({
    default: { getAction: vi.fn(async () => ({ effectiveShortcuts: [] })) }
}));

import type FNote from "../../../entities/fnote";
import Component from "../../../components/component";
import froca from "../../../services/froca";
import noteAttributeCache from "../../../services/note_attribute_cache";
import options from "../../../services/options";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import SplitEditor, { PreviewButton } from "./SplitEditor";

// --- Render harness --------------------------------------------------------------------------------

let container: HTMLDivElement;
let parent: Component;

/** The base {@link TypeWidgetProps} every SplitEditor render needs; tests supply the interesting ones. */
function baseProps(note: FNote) {
    return {
        note,
        viewScope: undefined,
        ntxId: "ntx1",
        parentComponent: undefined,
        noteContext: undefined
    };
}

function renderInto(vnode: VNode) {
    parent = new Component();
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
        render(<ParentComponent.Provider value={parent}>{vnode}</ParentComponent.Provider>, container);
    });
    return container;
}

async function flush() {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function setOptions(values: Record<string, string>) {
    options.load(values as Parameters<typeof options.load>[0]);
}

beforeEach(() => {
    splitCalls.length = 0;
    splitInstances.length = 0;
    editableProps.length = 0;
    readonlyProps.length = 0;
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    for (const key of Object.keys(noteAttributeCache.attributes)) delete noteAttributeCache.attributes[key];
    vi.clearAllMocks();
    isMobileSpy.mockReturnValue(false);
    isDesktopSpy.mockReturnValue(true);
    setOptions({});
});

afterEach(() => {
    if (container) {
        act(() => { render(null, container); });
        container.remove();
    }
    vi.restoreAllMocks();
});

// --- Tests -----------------------------------------------------------------------------------------

describe("SplitEditor — display modes", () => {
    it("defaults to split: mounts both panes, editable editor, and horizontal layout", async () => {
        const note = buildNote({ id: "s1", title: "S" });
        const root = renderInto(<SplitEditor {...baseProps(note)} previewContent={<div className="pv" />} />);
        await flush();

        const splitDiv = root.querySelector(".note-detail-split");
        expect(splitDiv?.className).toContain("split-horizontal");
        // Both panes mounted; editor is the EditableCode (not read-only).
        expect(root.querySelector(".note-detail-split-editor-col")).toBeTruthy();
        expect(root.querySelector(".note-detail-split-preview-col")).toBeTruthy();
        expect(root.querySelector(".mock-editable-code")).toBeTruthy();
        expect(root.querySelector(".mock-readonly-code")).toBeNull();
        expect(root.querySelector(".pv")).toBeTruthy();

        // Horizontal orientation renders the editor before the preview.
        const cols = Array.from(splitDiv?.children ?? []).map((c) => c.className);
        expect(cols[0]).toContain("note-detail-split-editor-col");
        expect(cols[1]).toContain("note-detail-split-preview-col");

        // Desktop + split → a Split instance is created over the visible panes.
        expect(splitCalls.length).toBe(1);
        expect(splitCalls[0].options.direction).toBe("horizontal");
        expect(splitCalls[0].options.gutterSize).toBeDefined();
    });

    it("source mode: only the editor pane mounts, preview stays unmounted, no split", async () => {
        const note = buildNote({ id: "s2", title: "S", "#displayMode": "source" });
        const root = renderInto(<SplitEditor {...baseProps(note)} previewContent={<div className="pv" />} />);
        await flush();

        expect(root.querySelector(".note-detail-split")?.className).toContain("split-source-only");
        expect(root.querySelector(".note-detail-split-editor-col")).toBeTruthy();
        expect(root.querySelector(".note-detail-split-preview-col")).toBeNull();
        // mode !== "split" → no Split instance.
        expect(splitCalls.length).toBe(0);
    });

    it("preview mode (explicit label): only preview mounts, editor stays unmounted", async () => {
        const note = buildNote({ id: "s3", title: "S", "#displayMode": "preview" });
        const root = renderInto(<SplitEditor {...baseProps(note)} previewContent={<div className="pv" />} />);
        await flush();

        expect(root.querySelector(".note-detail-split")?.className).toContain("split-read-only");
        expect(root.querySelector(".note-detail-split-editor-col")).toBeNull();
        expect(root.querySelector(".note-detail-split-preview-col")).toBeTruthy();
        expect(splitCalls.length).toBe(0);
    });

    it("readOnly label falls back to preview when displayMode is unset", async () => {
        const note = buildNote({ id: "s4", title: "S", "#readOnly": "true" });
        const root = renderInto(<SplitEditor {...baseProps(note)} previewContent={<div className="pv" />} />);
        await flush();

        expect(root.querySelector(".note-detail-split")?.className).toContain("split-read-only");
        expect(root.querySelector(".note-detail-split-editor-col")).toBeNull();
    });

    it("readOnly + explicit split displayMode renders the read-only editor (displayMode wins)", async () => {
        const note = buildNote({ id: "s5", title: "S", "#readOnly": "true", "#displayMode": "split" });
        const root = renderInto(<SplitEditor {...baseProps(note)} previewContent={<div className="pv" />} />);
        await flush();

        // displayMode=split keeps both panes; readOnly=true selects ReadOnlyCode for the editor.
        expect(root.querySelector(".note-detail-split")?.className).toContain("split-horizontal");
        expect(root.querySelector(".mock-readonly-code")).toBeTruthy();
        expect(root.querySelector(".mock-editable-code")).toBeNull();
    });
});

describe("SplitEditor — split lifecycle & desktop guard", () => {
    it("does not create a Split instance off the desktop", async () => {
        isDesktopSpy.mockReturnValue(false);
        const note = buildNote({ id: "d1", title: "S" });
        renderInto(<SplitEditor {...baseProps(note)} previewContent={<div />} />);
        await flush();
        expect(splitCalls.length).toBe(0);
    });

    it("merges custom splitOptions over the defaults", async () => {
        const note = buildNote({ id: "d2", title: "S" });
        renderInto(<SplitEditor {...baseProps(note)} previewContent={<div />} splitOptions={{ sizes: [ 30, 70 ] }} />);
        await flush();
        expect(splitCalls.length).toBe(1);
        expect(splitCalls[0].options.sizes).toEqual([ 30, 70 ]);
    });

    it("destroys the Split instance on unmount", async () => {
        const note = buildNote({ id: "d3", title: "S" });
        renderInto(<SplitEditor {...baseProps(note)} previewContent={<div />} />);
        await flush();
        const instance = splitInstances[splitInstances.length - 1];
        act(() => { render(null, container); });
        expect(instance.destroy).toHaveBeenCalledTimes(1);
    });
});

describe("SplitEditor — orientation", () => {
    it("forceOrientation=vertical renders preview before editor and a vertical split", async () => {
        const note = buildNote({ id: "o1", title: "S" });
        const root = renderInto(<SplitEditor {...baseProps(note)} previewContent={<div className="pv" />} forceOrientation="vertical" />);
        await flush();

        const splitDiv = root.querySelector(".note-detail-split");
        expect(splitDiv?.className).toContain("split-vertical");
        const cols = Array.from(splitDiv?.children ?? []).map((c) => c.className);
        expect(cols[0]).toContain("note-detail-split-preview-col");
        expect(cols[1]).toContain("note-detail-split-editor-col");
        expect(splitCalls[0].options.direction).toBe("vertical");
    });

    it("mobile defaults to vertical orientation", async () => {
        isMobileSpy.mockReturnValue(true);
        const note = buildNote({ id: "o2", title: "S" });
        const root = renderInto(<SplitEditor {...baseProps(note)} previewContent={<div />} />);
        await flush();
        expect(root.querySelector(".note-detail-split")?.className).toContain("split-vertical");
    });

    it("honors the splitEditorOrientation option when no force/mobile applies", async () => {
        setOptions({ splitEditorOrientation: "vertical" });
        const note = buildNote({ id: "o3", title: "S" });
        const root = renderInto(<SplitEditor {...baseProps(note)} previewContent={<div />} />);
        await flush();
        expect(root.querySelector(".note-detail-split")?.className).toContain("split-vertical");
    });
});

describe("SplitEditor — extra content & errors", () => {
    it("renders editorBefore, extraContent, the error admonition, and applies the className", async () => {
        const note = buildNote({ id: "e1", title: "S" });
        const root = renderInto(
            <SplitEditor
                {...baseProps(note)}
                className="custom-editor"
                error="something went wrong"
                editorBefore={<div className="before" />}
                extraContent={<div className="extra" />}
                previewContent={<div className="pv" />}
            />
        );
        await flush();

        expect(root.querySelector(".note-detail-split")?.className).toContain("custom-editor");
        expect(root.querySelector(".before")).toBeTruthy();
        expect(root.querySelector(".extra")).toBeTruthy();
        // The error admonition appears in the editor column...
        expect(root.querySelector(".note-detail-error-container")).toBeTruthy();
        // ...and the preview gets the on-error class.
        expect(root.querySelector(".note-detail-split-preview")?.className).toContain("on-error");
    });

    it("omits the error admonition and on-error class when there is no error", async () => {
        const note = buildNote({ id: "e2", title: "S" });
        const root = renderInto(<SplitEditor {...baseProps(note)} previewContent={<div />} />);
        await flush();
        expect(root.querySelector(".note-detail-error-container")).toBeNull();
        expect(root.querySelector(".note-detail-split-preview")?.className).not.toContain("on-error");
    });

    it("renders preview buttons inside the floating button group", async () => {
        const note = buildNote({ id: "e3", title: "S" });
        const root = renderInto(
            <SplitEditor
                {...baseProps(note)}
                previewContent={<div />}
                previewButtons={<button className="my-preview-btn" />}
            />
        );
        await flush();
        expect(root.querySelector(".preview-buttons .my-preview-btn")).toBeTruthy();
    });
});

describe("SplitEditor — preview fallback content propagation", () => {
    it("feeds blob content to onContentChanged in preview-only mode (editor not mounted)", async () => {
        const note = buildNote({ id: "f1", title: "S", "#displayMode": "preview", content: "hello world" });
        const onContentChanged = vi.fn();
        renderInto(<SplitEditor {...baseProps(note)} previewContent={<div />} onContentChanged={onContentChanged} />);
        await flush();
        // editorPropagatesContent is false (preview-only) → fallback blob drives onContentChanged.
        expect(onContentChanged).toHaveBeenCalledWith("hello world");
    });

    it("does NOT use the fallback blob when an editable editor is mounted", async () => {
        const note = buildNote({ id: "f2", title: "S", content: "ignored" });
        const onContentChanged = vi.fn();
        renderInto(<SplitEditor {...baseProps(note)} previewContent={<div />} onContentChanged={onContentChanged} />);
        await flush();
        // editorPropagatesContent is true (split + editable) → fallback effect short-circuits.
        expect(onContentChanged).not.toHaveBeenCalled();
        // The onContentChanged prop is forwarded down to the EditableCode instead.
        expect(editableProps[editableProps.length - 1]?.onContentChanged).toBe(onContentChanged);
    });

    it("uses the fallback blob in read-only split mode (read-only editor mounted)", async () => {
        const note = buildNote({ id: "f3", title: "S", "#readOnly": "true", "#displayMode": "split", content: "ro content" });
        const onContentChanged = vi.fn();
        renderInto(<SplitEditor {...baseProps(note)} previewContent={<div />} onContentChanged={onContentChanged} />);
        await flush();
        // editor is mounted but readOnly → editorPropagatesContent false → fallback drives the preview.
        expect(onContentChanged).toHaveBeenCalledWith("ro content");
    });

    it("falls back to an empty string when the blob has no content, and no-ops without a handler", async () => {
        // A blob whose `content` is null exercises the `?? ""` branch of the fallback effect.
        const note = buildNote({ id: "f4", title: "S", "#displayMode": "preview", content: "x" });
        const blob = await note.getBlob();
        if (blob) blob.content = null as unknown as string;
        const onContentChanged = vi.fn();
        renderInto(<SplitEditor {...baseProps(note)} previewContent={<div />} onContentChanged={onContentChanged} />);
        await flush();
        expect(onContentChanged).toHaveBeenCalledWith("");

        // Same preview-only path but with no handler → the optional chain short-circuits without throwing.
        const note2 = buildNote({ id: "f5", title: "S", "#displayMode": "preview", content: "y" });
        expect(() => renderInto(<SplitEditor {...baseProps(note2)} previewContent={<div />} />)).not.toThrow();
        await flush();
    });
});

describe("PreviewButton", () => {
    it("renders an action button with the tool-button class and top title position", async () => {
        const onClick = vi.fn();
        const root = renderInto(<PreviewButton icon="bx bx-zoom-in" text="Zoom" onClick={onClick} />);
        await flush();
        const button = root.querySelector("button");
        expect(button?.className).toContain("tn-tool-button");
        expect(button?.className).toContain("bx-zoom-in");
        button?.click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
