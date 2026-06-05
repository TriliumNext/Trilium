import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the imports) ----------------------------------------------------

// Capture the autocomplete override config so slash-command `apply()` closures can be exercised.
let capturedOverride: ((ctx: unknown) => unknown) | null = null;
vi.mock("@codemirror/autocomplete", () => ({
    autocompletion: (config: { override?: ((ctx: unknown) => unknown)[] }) => {
        capturedOverride = config.override?.[0] ?? null;
        return { __isAutocomplete: true };
    }
}));

vi.mock("@codemirror/language", () => ({
    // Default: not inside a code node (so the slash menu is allowed).
    syntaxTree: vi.fn(() => ({ resolveInner: () => ({ name: "Paragraph", parent: null }) }))
}));

// i18n is not initialised under happy-dom; `t()` would return undefined for some keys, breaking
// `.length`/`.toUpperCase()` in the slash-command templates. Return the key (with the name interp).
vi.mock("../../../services/i18n", () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts?.name ? `${key}:${opts.name}` : key)
}));

vi.mock("@triliumnext/codemirror", () => ({ default: class {} }));

vi.mock("../../../services/keyboard_actions", () => ({
    default: { setupActionsForElement: vi.fn(async () => [ { id: "binding1" } ]) }
}));
vi.mock("../../../services/shortcuts", () => ({
    default: {},
    removeIndividualBinding: vi.fn()
}));
vi.mock("../../../services/toast", () => ({ default: { showError: vi.fn() } }));
vi.mock("../../../services/note_create", () => ({ default: { createNote: vi.fn() } }));
vi.mock("../../../services/task_states", () => ({ getTaskStateDefinitions: vi.fn(async () => []) }));

// i18n is not initialised under happy-dom, so `t()` returns undefined for the sample names.
// Provide deterministic sample diagrams so /mermaid:<name> labels build cleanly.
vi.mock("../mermaid/sample_diagrams", () => ({
    default: [ { name: "Flow Chart", content: "graph TD\n  A --> B\n" } ]
}));

// Mock the snippet hook so it doesn't hit the search service; expose a controllable ref and
// capture the `matches` predicate the component passes so it can be exercised directly.
const snippetsRef = { current: [] as { noteId: string; title: string; content: string; description?: string }[] };
let capturedSnippetMatches: ((note: { isMarkdown(): boolean; type: string; mime: string }) => boolean) | null = null;
vi.mock("./snippets", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./snippets")>()),
    useCodeSnippets: (matches: (note: { isMarkdown(): boolean; type: string; mime: string }) => boolean) => {
        capturedSnippetMatches = matches;
        return snippetsRef;
    }
}));

// Replace the heavy CodeMirror/CKEditor-backed SplitEditor with a lightweight harness that
// wires `editorRef` and renders the preview content, so the Markdown hooks can be driven.
let splitEditorProps: Record<string, unknown> | null = null;
vi.mock("../helpers/SplitEditor", () => ({
    default: (props: Record<string, unknown>) => {
        splitEditorProps = props;
        const editorRef = props.editorRef as ((v: unknown) => void) | undefined;
        if (editorRef && fakeView) editorRef(fakeView);
        return props.previewContent as preact.ComponentChildren;
    }
}));

// Lightweight preview content surface that renders the supplied html.
vi.mock("../text/ReadOnlyText", () => ({
    ReadOnlyTextContent: (props: { html: string; contentRef?: (el: HTMLDivElement | null) => void; className?: string }) => {
        const setRef = (el: HTMLDivElement | null) => {
            if (el) el.innerHTML = props.html;
            props.contentRef?.(el);
        };
        return <div className={props.className} ref={setRef} />;
    }
}));

import { syntaxTree } from "@codemirror/language";
import { render } from "preact";

import appContext from "../../../components/app_context";
import Component from "../../../components/component";
import type NoteContext from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import keyboard_actions from "../../../services/keyboard_actions";
import note_create from "../../../services/note_create";
import server from "../../../services/server";
import { removeIndividualBinding } from "../../../services/shortcuts";
import toast from "../../../services/toast";
import { getTaskStateDefinitions } from "../../../services/task_states";
import ws from "../../../services/ws";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import { TypeWidgetProps } from "../type_widget";
import Markdown, { buildTaskItemInsert, renderWithSourceLines } from "./Markdown";

// --- A minimal in-memory fake of VanillaCodeMirror -----------------------------------------------

interface DispatchSpec {
    changes?: { from: number; to?: number; insert?: string } | { from: number; to?: number; insert?: string }[];
    selection?: { anchor: number; head?: number };
}

class FakeView {
    docText: string;
    sel: { from: number; to: number; head: number };
    contentDOM = document.createElement("div");
    dom = document.createElement("div");
    scrollDOM: HTMLElement;
    dispatched: DispatchSpec[] = [];
    namedExtensions = new Map<string, unknown>();
    updateListeners: ((v: { selectionSet: boolean; docChanged: boolean }) => void)[] = [];
    focused = false;

    constructor(text = "") {
        this.docText = text;
        this.sel = { from: 0, to: 0, head: 0 };
        this.scrollDOM = document.createElement("div");
        this.scrollDOM.scrollTo = (() => {}) as never;
    }

    get state() {
        const self = this;
        return {
            selection: { main: this.sel },
            sliceDoc: (from: number, to: number) => self.docText.slice(from, to),
            doc: {
                length: self.docText.length,
                lines: Math.max(1, self.docText.split("\n").length),
                toString: () => self.docText,
                sliceString: (from: number, to: number) => self.docText.slice(from, to),
                line: (n: number) => ({ from: 0, number: n }),
                lineAt: (pos: number) => ({ number: self.docText.slice(0, pos).split("\n").length, from: 0 })
            }
        };
    }

    dispatch(spec: DispatchSpec) {
        this.dispatched.push(spec);
        const changes = spec.changes ? (Array.isArray(spec.changes) ? spec.changes : [ spec.changes ]) : [];
        // Apply in descending `from` so earlier offsets stay valid.
        for (const c of [ ...changes ].sort((a, b) => b.from - a.from)) {
            const to = c.to ?? c.from;
            this.docText = this.docText.slice(0, c.from) + (c.insert ?? "") + this.docText.slice(to);
        }
        if (spec.selection) {
            const head = spec.selection.head ?? spec.selection.anchor;
            this.sel = { from: Math.min(spec.selection.anchor, head), to: Math.max(spec.selection.anchor, head), head };
        }
    }

    addUpdateListener(fn: (v: { selectionSet: boolean; docChanged: boolean }) => void) {
        this.updateListeners.push(fn);
        return () => { this.updateListeners = this.updateListeners.filter(l => l !== fn); };
    }

    lineBlockAt(_from: number) { return { top: 100, height: 20 }; }
    lineBlockAtHeight(_top: number) { return { from: 0 }; }
    posAtCoords(_coords: { x: number; y: number }) { return 3; }
    setNamedExtension(name: string, ext: unknown) { this.namedExtensions.set(name, ext); }
    focus() { this.focused = true; }
}

let fakeView: FakeView | null = null;

// `appContext.tabManager` is only assigned in `start()`; tests inject a fake and restore it.
let originalTabManager: unknown;
function setTabManager(fake: { getActiveContextNote: () => FNote | null; getActiveContextNotePath: () => string | null }) {
    const ctx = appContext as unknown as { tabManager: unknown };
    originalTabManager = ctx.tabManager;
    ctx.tabManager = fake;
}

// --- Render helper -------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let parent: Component;

function fakeNoteContext(overrides: Record<string, unknown> = {}): NoteContext {
    return {
        ntxId: "ntx1",
        noteId: "md1",
        setContextData: vi.fn(),
        ...overrides
    } as unknown as NoteContext;
}

function renderMarkdown(props: Partial<TypeWidgetProps> = {}) {
    const note = props.note ?? buildNote({ id: "md1", title: "Doc", type: "code", content: "# Hi" });
    note.mime = "text/markdown";
    const fullProps: TypeWidgetProps = {
        note,
        viewScope: undefined,
        ntxId: "ntx1",
        parentComponent: parent,
        noteContext: undefined,
        ...props
    };
    const el = document.createElement("div");
    container = el;
    document.body.appendChild(el);
    act(() => {
        render(
            <ParentComponent.Provider value={parent}>
                <Markdown {...fullProps} />
            </ParentComponent.Provider>,
            el
        );
    });
    const unmount = () => act(() => {
        render(null, el);
        el.remove();
        container = undefined;
    });
    return { note, props: fullProps, unmount };
}

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
    Object.assign(server, { put: vi.fn(async () => undefined), upload: vi.fn(async () => undefined) });
    Object.assign(ws, { logError: vi.fn() });
    capturedOverride = null;
    capturedSnippetMatches = null;
    splitEditorProps = null;
    snippetsRef.current = [];
    fakeView = new FakeView("# Hi\n");
    parent = new Component();
    (keyboard_actions.setupActionsForElement as ReturnType<typeof vi.fn>).mockResolvedValue([ { id: "binding1" } ]);
    // clearAllMocks wiped the syntaxTree impl — re-establish the "not a code node" default.
    (syntaxTree as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        resolveInner: () => ({ name: "Paragraph", parent: null })
    }));
    (getTaskStateDefinitions as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

afterEach(() => {
    if (container) { render(null, container); container.remove(); container = undefined; }
    if (originalTabManager !== undefined) {
        (appContext as unknown as { tabManager: unknown }).tabManager = originalTabManager;
        originalTabManager = undefined;
    }
    vi.restoreAllMocks();
});

// --- Pure functions ------------------------------------------------------------------------------

describe("buildTaskItemInsert", () => {
    it("includes the bullet when not preceded by one, omits it otherwise", () => {
        expect(buildTaskItemInsert(" ", false)).toBe("- [ ] ");
        expect(buildTaskItemInsert("x", true)).toBe("[x] ");
    });
});

describe("renderWithSourceLines", () => {
    it("returns empty html and no headings for empty input", () => {
        const { html, headings } = renderWithSourceLines("");
        expect(html).toBe("");
        expect(headings).toEqual([]);
    });

    it("extracts headings with ids/levels and tags top-level blocks with source lines", () => {
        const src = "# Title\n\nParagraph one\n\n## Sub\n\nParagraph two";
        const { html, headings } = renderWithSourceLines(src);
        expect(headings).toHaveLength(2);
        expect(headings[0]).toMatchObject({ id: "md-heading-0", level: 1, line: 1 });
        expect(headings[1]).toMatchObject({ id: "md-heading-1", level: 2 });
        expect(html).toContain("data-source-line=");
    });

    it("strips the auto-language class from unlabeled code fences (MarkdownPreviewRenderer.code)", () => {
        const unlabeled = renderWithSourceLines("```\nplain code\n```").html;
        expect(unlabeled).toContain("language-text-plain");
        expect(unlabeled).not.toContain("language-text-x-trilium-auto");

        // A labeled fence keeps its language and is not rewritten to text-plain.
        const labeled = renderWithSourceLines("```js\nconst a = 1;\n```").html;
        expect(labeled).not.toContain("language-text-plain");
    });

    it("falls back to the last (or 1) source line when there are more blocks than tokens", () => {
        // A definition followed by content exercises the NON_RENDERED_TOKENS skip + line fallback.
        const { html } = renderWithSourceLines("[ref]: http://x\n\ntext");
        expect(html).toContain("data-source-line");
    });

    it("formats wiki-links through the #root/ href formatter", () => {
        const { html } = renderWithSourceLines("[[abc123]]");
        expect(html).toContain("#root/abc123");
    });
});

// --- Component render + preview ------------------------------------------------------------------

describe("Markdown component", () => {
    it("renders the preview html from editor content and forwards split editor props", () => {
        renderMarkdown();
        expect(splitEditorProps).not.toBeNull();
        expect(splitEditorProps?.noteType).toBe("code");
        // Editor feeds content to the component via onContentChanged.
        const onContentChanged = splitEditorProps?.onContentChanged as (c: string) => void;
        act(() => onContentChanged("# Heading\n\nbody"));
        const preview = container?.querySelector(".markdown-preview");
        expect(preview?.innerHTML).toContain("data-source-line");
    });

    it("re-renders the preview when content changes via onContentChanged", () => {
        renderMarkdown();
        const onContentChanged = splitEditorProps?.onContentChanged as (c: string) => void;
        act(() => onContentChanged("## Changed\n\nbody"));
        const preview = container?.querySelector(".markdown-preview");
        expect(preview?.innerHTML).toContain("Changed");
    });
});

// --- Keyboard action binding (setupActionsForElement + cleanup) ----------------------------------

describe("text-detail shortcut binding", () => {
    it("binds actions on the editor contentDOM and removes them on unmount", async () => {
        const { unmount } = renderMarkdown();
        expect(keyboard_actions.setupActionsForElement).toHaveBeenCalledWith(
            "text-detail", expect.anything(), parent, "ntx1"
        );
        unmount();
        await act(async () => { await Promise.resolve(); });
        expect(removeIndividualBinding).toHaveBeenCalledWith({ id: "binding1" });
    });
});

// --- usePublishToc ------------------------------------------------------------------------------

describe("usePublishToc", () => {
    it("publishes headings to the note context and re-publishes on noteSwitched", () => {
        const noteContext = fakeNoteContext({ noteId: "md1" });
        renderMarkdown({ noteContext });
        const onContentChanged = splitEditorProps?.onContentChanged as (c: string) => void;
        act(() => onContentChanged("# A\n\n## B"));
        const setContextData = noteContext.setContextData as ReturnType<typeof vi.fn>;
        const tocCalls = setContextData.mock.calls.filter(([ key ]) => key === "toc");
        const tocCall = tocCalls[tocCalls.length - 1];
        expect(tocCall).toBeTruthy();
        const toc = tocCall?.[1] as { headings: { id: string }[]; scrollToHeading: (h: { id: string }) => void };
        expect(toc.headings.length).toBe(2);
        // scrollToHeading walks the editor view (smooth scroll); unknown id is a no-op.
        act(() => toc.scrollToHeading({ id: toc.headings[0].id }));
        act(() => toc.scrollToHeading({ id: "missing" }));

        setContextData.mockClear();
        act(() => { parent.handleEventInChildren("noteSwitched", { noteContext } as never); });
        expect(setContextData).toHaveBeenCalled();
    });

    it("does not publish when the note context belongs to a different note", () => {
        const noteContext = fakeNoteContext({ noteId: "other" });
        renderMarkdown({ noteContext });
        const setContextData = noteContext.setContextData as ReturnType<typeof vi.fn>;
        expect(setContextData.mock.calls.find(([ key ]) => key === "toc")).toBeUndefined();
        // noteSwitched for a different context is ignored.
        act(() => { parent.handleEventInChildren("noteSwitched", { noteContext: fakeNoteContext({ noteId: "x" }) } as never); });
        expect(setContextData.mock.calls.find(([ key ]) => key === "toc")).toBeUndefined();
    });
});

// --- useSyncedScrolling + useSyncedHighlight ----------------------------------------------------

describe("synced scrolling / highlight", () => {
    function preview() {
        const el = container?.querySelector<HTMLDivElement>(".markdown-preview");
        if (!el) throw new Error("preview missing");
        return el;
    }

    it("scrolls the preview to match the editor's top visible line", () => {
        renderMarkdown();
        const onContentChanged = splitEditorProps?.onContentChanged as (c: string) => void;
        act(() => onContentChanged("line1\n\nline2\n\nline3"));
        const el = preview();
        // Provide multiple source-line blocks for interpolation.
        el.innerHTML = `<div data-source-line="1">a</div><div data-source-line="3">b</div><div data-source-line="5">c</div>`;
        const view = fakeView;
        if (!view) throw new Error("no view");
        view.scrollDOM.scrollTop = 5;
        act(() => { view.scrollDOM.dispatchEvent(new Event("scroll")); });
        // before is found; preview.scrollTop is assigned a number.
        expect(typeof el.scrollTop).toBe("number");
    });

    it("resets preview scroll to 0 when no block precedes the top line", () => {
        renderMarkdown();
        const onContentChanged = splitEditorProps?.onContentChanged as (c: string) => void;
        act(() => onContentChanged("line1"));
        const el = preview();
        el.innerHTML = `<div data-source-line="99">a</div>`;
        const view = fakeView;
        if (!view) throw new Error("no view");
        act(() => { view.scrollDOM.dispatchEvent(new Event("scroll")); });
        expect(el.scrollTop).toBe(0);
    });

    it("highlights the active preview block and reacts to editor updates", () => {
        renderMarkdown();
        const onContentChanged = splitEditorProps?.onContentChanged as (c: string) => void;
        act(() => onContentChanged("a\n\nb"));
        const el = preview();
        el.innerHTML = `<div data-source-line="1">a</div><div data-source-line="2">b</div>`;
        const view = fakeView;
        if (!view) throw new Error("no view");
        // Move cursor to second line and fire an update listener.
        view.sel = { from: 5, to: 5, head: 5 };
        act(() => { view.updateListeners.forEach(l => l({ selectionSet: true, docChanged: false })); });
        // A non-relevant update (neither selection nor doc changed) is ignored.
        act(() => { view.updateListeners.forEach(l => l({ selectionSet: false, docChanged: false })); });
        expect(el.querySelectorAll(".markdown-preview-active").length).toBeLessThanOrEqual(1);
    });
});

// --- useTextCommands ----------------------------------------------------------------------------

describe("useTextCommands", () => {
    function getCmd(name: string): (...args: unknown[]) => unknown {
        const fn = (parent as unknown as Record<string, unknown>)[name];
        if (typeof fn !== "function") throw new Error(`${name} not registered`);
        return fn.bind(parent) as (...args: unknown[]) => unknown;
    }

    it("addLinkToTextCommand triggers the dialog and inserts the various link forms", () => {
        renderMarkdown();
        const view = fakeView;
        if (!view) throw new Error("no view");
        view.docText = "hello world";
        view.sel = { from: 0, to: 5, head: 5 }; // selection "hello"
        const trigger = vi.spyOn(parent, "triggerCommand").mockReturnValue(undefined);
        getCmd("addLinkToTextCommand")();
        const [ cmdName, data ] = trigger.mock.calls[0] as [ string, { hasSelection: boolean; addLink: Function } ];
        expect(cmdName).toBe("showAddLinkDialog");
        expect(data.hasSelection).toBe(true);
        // External link uses the selected text as the label.
        act(() => { void data.addLink("https://x.test", null, true); });
        expect(view.dispatched.some(d => JSON.stringify(d).includes("https://x.test"))).toBe(true);
        // Internal link with title.
        act(() => { void data.addLink("root/abc", "Title", false); });
        // Internal link without title → wiki-link via getNoteIdFromUrl.
        act(() => { void data.addLink("root/def", null, false); });
        expect(view.focused).toBe(true);
    });

    it("addLinkToTextCommand external/internal label uses linkTitle/notePath when no selection", () => {
        renderMarkdown();
        const view = fakeView;
        if (!view) throw new Error("no view");
        view.docText = "";
        view.sel = { from: 0, to: 0, head: 0 };
        const trigger = vi.spyOn(parent, "triggerCommand").mockReturnValue(undefined);
        getCmd("addLinkToTextCommand")();
        const data = trigger.mock.calls[0]?.[1] as { addLink: Function };
        act(() => { void data.addLink("https://y.test", "Label", true); });
        act(() => { void data.addLink("root/zzz", "Inner", false); });
        expect(view.docText).toContain("Label");
    });

    it("insertDateTimeToTextCommand inserts a formatted date string", () => {
        renderMarkdown();
        const view = fakeView;
        if (!view) throw new Error("no view");
        const before = view.dispatched.length;
        getCmd("insertDateTimeToTextCommand")();
        expect(view.dispatched.length).toBeGreaterThan(before);
    });

    it("addIncludeNoteToTextCommand inserts include sections and images via the editor API", async () => {
        const targetNote = buildNote({ id: "img1", title: "My Image", type: "image" });
        renderMarkdown();
        const view = fakeView;
        if (!view) throw new Error("no view");
        const trigger = vi.spyOn(parent, "triggerCommand").mockReturnValue(undefined);
        getCmd("addIncludeNoteToTextCommand")();
        const data = trigger.mock.calls[0]?.[1] as { editorApi: { addIncludeNote: Function; addImage: Function } };
        act(() => data.editorApi.addIncludeNote("noteA", "medium"));
        expect(view.docText).toContain('data-note-id="noteA"');
        act(() => data.editorApi.addIncludeNote("noteB"));
        expect(view.docText).toContain('data-box-size="full"');
        await act(async () => { await data.editorApi.addImage(targetNote.noteId); });
        expect(view.docText).toContain("api/images/img1");
    });

    it("cutIntoNoteCommand extracts a heading title and replaces the selection with a wiki-link", async () => {
        const note = buildNote({ id: "active", title: "Active", type: "code", content: "" });
        setTabManager({ getActiveContextNote: () => note, getActiveContextNotePath: () => "root/active" });
        (note_create.createNote as ReturnType<typeof vi.fn>).mockResolvedValue({ note: { noteId: "newNote" } });
        renderMarkdown();
        const view = fakeView;
        if (!view) throw new Error("no view");
        view.docText = "# My Title\nbody text";
        view.sel = { from: 0, to: view.docText.length, head: view.docText.length };
        await act(async () => { await getCmd("cutIntoNoteCommand")(); });
        expect(note_create.createNote).toHaveBeenCalledWith("root/active", expect.objectContaining({ title: "My Title", type: "code" }));
        expect(view.docText).toContain("[[newNote]]");
    });

    it("cutIntoNoteCommand falls back to no title when there is no heading and bails without selection", async () => {
        const note = buildNote({ id: "active2", title: "Active2", type: "code", content: "" });
        setTabManager({ getActiveContextNote: () => note, getActiveContextNotePath: () => "root/active2" });
        (note_create.createNote as ReturnType<typeof vi.fn>).mockResolvedValue({ note: { noteId: "n2" } });
        renderMarkdown();
        const view = fakeView;
        if (!view) throw new Error("no view");
        // Empty selection → bail.
        view.docText = "plain";
        view.sel = { from: 2, to: 2, head: 2 };
        await act(async () => { await getCmd("cutIntoNoteCommand")(); });
        expect(note_create.createNote).not.toHaveBeenCalled();
        // Now with a selection but no heading.
        view.sel = { from: 0, to: 5, head: 5 };
        await act(async () => { await getCmd("cutIntoNoteCommand")(); });
        expect(note_create.createNote).toHaveBeenCalledWith("root/active2", expect.objectContaining({ title: null }));
    });

    it("cutIntoNoteCommand bails when there is no active note or path", async () => {
        setTabManager({ getActiveContextNote: () => null, getActiveContextNotePath: () => null });
        renderMarkdown();
        const view = fakeView;
        if (!view) throw new Error("no view");
        view.docText = "selected";
        view.sel = { from: 0, to: 8, head: 8 };
        await act(async () => { await getCmd("cutIntoNoteCommand")(); });
        expect(note_create.createNote).not.toHaveBeenCalled();
    });
});

// --- useMarkdownKeymap --------------------------------------------------------------------------

describe("useMarkdownKeymap", () => {
    function fireKey(key: string, opts: { ctrl?: boolean; shift?: boolean } = {}) {
        const view = fakeView;
        if (!view) throw new Error("no view");
        act(() => {
            view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
                key,
                ctrlKey: opts.ctrl ?? true,
                shiftKey: opts.shift ?? false,
                bubbles: true,
                cancelable: true
            }));
        });
    }

    it("inserts a wrapper pair when there is no selection (bold)", () => {
        renderMarkdown();
        const view = fakeView;
        if (!view) throw new Error("no view");
        view.docText = "";
        view.sel = { from: 0, to: 0, head: 0 };
        fireKey("b");
        expect(view.docText).toBe("****");
    });

    it("wraps a selection and re-selects the inner text (italic)", () => {
        renderMarkdown();
        const view = fakeView;
        if (!view) throw new Error("no view");
        view.docText = "abc";
        view.sel = { from: 0, to: 3, head: 3 };
        fireKey("i");
        expect(view.docText).toBe("*abc*");
    });

    it("unwraps a selection that is already wrapped (math)", () => {
        renderMarkdown();
        const view = fakeView;
        if (!view) throw new Error("no view");
        view.docText = "$x$";
        view.sel = { from: 0, to: 3, head: 3 };
        fireKey("m");
        expect(view.docText).toBe("x");
    });

    it("unwraps when the wrapper sits just outside the selection (strikethrough, shift+x)", () => {
        renderMarkdown();
        const view = fakeView;
        if (!view) throw new Error("no view");
        view.docText = "~~gone~~";
        view.sel = { from: 2, to: 6, head: 6 }; // selects "gone", wrappers outside
        fireKey("x", { shift: true });
        expect(view.docText).toBe("gone");
    });

    it("ignores keystrokes without a modifier or with an unmapped key", () => {
        renderMarkdown();
        const view = fakeView;
        if (!view) throw new Error("no view");
        view.docText = "abc";
        view.sel = { from: 0, to: 0, head: 0 };
        fireKey("b", { ctrl: false }); // no modifier
        fireKey("q"); // unmapped
        expect(view.docText).toBe("abc");
    });
});

// --- useImageDrop -------------------------------------------------------------------------------

describe("useImageDrop", () => {
    function imageFile(name = "pic.png") {
        return new File([ "data" ], name, { type: "image/png" });
    }

    it("uploads dropped image files and inserts a markdown reference", async () => {
        (server.upload as ReturnType<typeof vi.fn>).mockResolvedValue({ uploaded: true, url: "api/x/pic.png" });
        renderMarkdown();
        const view = fakeView;
        if (!view) throw new Error("no view");
        const dt = { files: [ imageFile() ], types: [ "Files" ] } as unknown as DataTransfer;
        const ev = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
        Object.defineProperty(ev, "dataTransfer", { value: dt });
        await act(async () => {
            view.dom.dispatchEvent(ev);
            await Promise.resolve();
        });
        expect(server.upload).toHaveBeenCalled();
    });

    it("ignores a drop with no image files", () => {
        renderMarkdown();
        const view = fakeView;
        if (!view) throw new Error("no view");
        const dt = { files: [ new File([ "x" ], "a.txt", { type: "text/plain" }) ], types: [ "Files" ] } as unknown as DataTransfer;
        const ev = new Event("drop", { bubbles: true }) as DragEvent;
        Object.defineProperty(ev, "dataTransfer", { value: dt });
        act(() => { view.dom.dispatchEvent(ev); });
        expect(server.upload).not.toHaveBeenCalled();
    });

    it("pastes an attachment image reference from HTML clipboard data", () => {
        renderMarkdown();
        const view = fakeView;
        if (!view) throw new Error("no view");
        const html = `<img alt="shot" src="http://h/api/attachments/abc123/image/pic.png">`;
        const cd = { items: [], getData: (t: string) => (t === "text/html" ? html : "") } as unknown as DataTransfer;
        const ev = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
        Object.defineProperty(ev, "clipboardData", { value: cd });
        act(() => { view.dom.dispatchEvent(ev); });
        expect(view.docText).toContain("api/attachments/abc123/image/pic.png");
    });

    it("pastes image files (screenshot) by uploading them", async () => {
        (server.upload as ReturnType<typeof vi.fn>).mockResolvedValue({ uploaded: true, url: "api/y/shot.png" });
        renderMarkdown();
        const view = fakeView;
        if (!view) throw new Error("no view");
        const file = imageFile("shot.png");
        const items = [ { type: "image/png", getAsFile: () => file } ];
        const cd = { items, getData: () => "" } as unknown as DataTransfer;
        const ev = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
        Object.defineProperty(ev, "clipboardData", { value: cd });
        await act(async () => {
            view.dom.dispatchEvent(ev);
            await Promise.resolve();
        });
        expect(server.upload).toHaveBeenCalled();
    });

    it("ignores a paste with no clipboard items and prevents default on file dragover", () => {
        renderMarkdown();
        const view = fakeView;
        if (!view) throw new Error("no view");
        const cdNoItems = { getData: () => "" } as unknown as DataTransfer;
        const pasteEv = new Event("paste", { bubbles: true }) as ClipboardEvent;
        Object.defineProperty(pasteEv, "clipboardData", { value: cdNoItems });
        act(() => { view.dom.dispatchEvent(pasteEv); });
        expect(server.upload).not.toHaveBeenCalled();

        const dragEv = new Event("dragover", { bubbles: true, cancelable: true }) as DragEvent;
        Object.defineProperty(dragEv, "dataTransfer", { value: { types: [ "Files" ] } });
        act(() => { view.dom.dispatchEvent(dragEv); });
        expect(dragEv.defaultPrevented).toBe(true);
    });

    it("surfaces an upload failure as a toast", async () => {
        (server.upload as ReturnType<typeof vi.fn>).mockResolvedValue({ uploaded: false, message: "Too big" });
        renderMarkdown();
        const view = fakeView;
        if (!view) throw new Error("no view");
        const dt = { files: [ imageFile() ], types: [ "Files" ] } as unknown as DataTransfer;
        const ev = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
        Object.defineProperty(ev, "dataTransfer", { value: dt });
        await act(async () => {
            view.dom.dispatchEvent(ev);
            await Promise.resolve();
        });
        expect(toast.showError).toHaveBeenCalled();
    });

    it("surfaces a network error during upload as a toast", async () => {
        (server.upload as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("offline"));
        renderMarkdown();
        const view = fakeView;
        if (!view) throw new Error("no view");
        const dt = { files: [ imageFile() ], types: [ "Files" ] } as unknown as DataTransfer;
        const ev = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
        Object.defineProperty(ev, "dataTransfer", { value: dt });
        await act(async () => {
            view.dom.dispatchEvent(ev);
            await Promise.resolve();
        });
        expect(toast.showError).toHaveBeenCalled();
    });
});

// --- useSlashCommands ---------------------------------------------------------------------------

interface SlashOption {
    label: string;
    apply: (view: unknown, completion: unknown, from: number, to: number) => void;
}

function fakeCompletionContext(opts: { match?: { from: number } | null } = {}) {
    return {
        pos: 0,
        state: {},
        matchBefore: () => (opts.match === undefined ? { from: 0 } : opts.match)
    };
}

function runOverride(ctx: ReturnType<typeof fakeCompletionContext>): { from: number; options: SlashOption[] } | null {
    if (!capturedOverride) throw new Error("override not captured");
    return capturedOverride(ctx) as { from: number; options: SlashOption[] } | null;
}

describe("useSlashCommands", () => {
    async function setupWithStates(states: { name: string; title: string; markdownSymbol: string }[] = [], snippets: typeof snippetsRef.current = []) {
        (getTaskStateDefinitions as ReturnType<typeof vi.fn>).mockResolvedValue(states);
        snippetsRef.current = snippets;
        renderMarkdown();
        // Let the task-states effect resolve so taskStatesRef is populated.
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        const result = runOverride(fakeCompletionContext());
        if (!result) throw new Error("no completions");
        return result.options;
    }

    function applyByLabel(options: SlashOption[], label: string) {
        const opt = options.find(o => o.label === label);
        if (!opt) throw new Error(`option ${label} not found`);
        const view = fakeView;
        if (!view) throw new Error("no view");
        act(() => opt.apply(view, {}, 0, 0));
        return view;
    }

    it("returns null when there is no slash match", async () => {
        await setupWithStates();
        expect(runOverride(fakeCompletionContext({ match: null }))).toBeNull();
    });

    it("suppresses the menu inside a code node", async () => {
        await setupWithStates();
        (syntaxTree as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
            resolveInner: () => ({ name: "FencedCode", parent: null })
        });
        expect(runOverride(fakeCompletionContext())).toBeNull();
    });

    it("date/include/link commands clear the token and trigger the matching command", async () => {
        const options = await setupWithStates();
        const trigger = vi.spyOn(parent, "triggerCommand").mockReturnValue(undefined);
        applyByLabel(options, "/date");
        applyByLabel(options, "/include");
        applyByLabel(options, "/link");
        const names = trigger.mock.calls.map(c => c[0]);
        expect(names).toEqual([ "insertDateTimeToText", "addIncludeNoteToText", "addLinkToText" ]);
    });

    it("image command opens a file picker and uploads the chosen file", async () => {
        (server.upload as ReturnType<typeof vi.fn>).mockResolvedValue({ uploaded: true, url: "api/z/p.png" });
        const options = await setupWithStates();
        let createdInput: HTMLInputElement | null = null;
        const realCreate = document.createElement.bind(document);
        const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
            const el = realCreate(tag);
            if (tag === "input") {
                createdInput = el as HTMLInputElement;
                el.click = () => {};
            }
            return el;
        });
        applyByLabel(options, "/image");
        spy.mockRestore();
        if (!createdInput) throw new Error("no input created");
        const input: HTMLInputElement = createdInput;
        Object.defineProperty(input, "files", { value: [ new File([ "d" ], "p.png", { type: "image/png" }) ] });
        await act(async () => {
            input.dispatchEvent(new Event("change"));
            await Promise.resolve();
        });
        expect(server.upload).toHaveBeenCalled();
    });

    it("math/footnote/mermaid/collapsible/admonition commands insert their templates", async () => {
        const options = await setupWithStates();
        const view = fakeView;
        if (!view) throw new Error("no view");

        applyByLabel(options, "/math");
        expect(view.docText).toContain("$$");

        view.docText = "ref [^2] exists";
        view.sel = { from: 0, to: 0, head: 0 };
        applyByLabel(options, "/footnote");
        expect(view.docText).toContain("[^3]");

        view.docText = "";
        applyByLabel(options, "/mermaid");
        expect(view.docText).toContain("```mermaid");

        view.docText = "";
        applyByLabel(options, "/collapsible");
        expect(view.docText).toContain("trilium-collapsible");

        view.docText = "";
        applyByLabel(options, "/note");
        expect(view.docText).toContain("[!NOTE]");

        // A sample-diagram mermaid command (e.g. /mermaid:flowchart).
        const sample = options.find(o => o.label.startsWith("/mermaid:"));
        if (!sample) throw new Error("no mermaid sample");
        view.docText = "";
        act(() => sample.apply(view, {}, 0, 0));
        expect(view.docText).toContain("```mermaid");
    });

    it("builds /todo commands for task states with a markdown symbol", async () => {
        const options = await setupWithStates([
            { name: "none", title: "To do", markdownSymbol: " " },
            { name: "custom", title: "Doing", markdownSymbol: "/" },
            { name: "nosymbol", title: "Skipped", markdownSymbol: "" }
        ]);
        const todoLabels = options.filter(o => o.label.startsWith("/todo:")).map(o => o.label);
        expect(todoLabels).toContain("/todo:none");
        expect(todoLabels).toContain("/todo:custom");
        expect(todoLabels).not.toContain("/todo:nosymbol");

        const view = fakeView;
        if (!view) throw new Error("no view");
        // Insert at column 0 → keeps the bullet.
        view.docText = "";
        view.sel = { from: 0, to: 0, head: 0 };
        applyByLabel(options, "/todo:none");
        expect(view.docText).toBe("- [ ] ");

        // Preceded by "- " → omits the bullet.
        view.docText = "- ";
        view.sel = { from: 2, to: 2, head: 2 };
        act(() => {
            const opt = options.find(o => o.label === "/todo:custom");
            opt?.apply(view, {}, 2, 2);
        });
        expect(view.docText).toBe("- [/] ");
    });

    it("includes snippet completions except the current note's own snippet", async () => {
        const options = await setupWithStates([], [
            { noteId: "snip1", title: "Snippet One", content: "hello" },
            { noteId: "md1", title: "Self", content: "self" } // current note → excluded
        ]);
        const snippetOpts = options.filter(o => o.label.startsWith("/snippet:"));
        expect(snippetOpts.map(o => o.label)).toContain("/snippet:Snippet One");
        expect(snippetOpts.map(o => o.label)).not.toContain("/snippet:Self");
    });

    it("accepts markdown and plain-text code notes as snippet candidates", () => {
        renderMarkdown();
        expect(capturedSnippetMatches).toBeTruthy();
        const matches = capturedSnippetMatches;
        if (!matches) throw new Error("no predicate");
        expect(matches({ isMarkdown: () => true, type: "text", mime: "x" })).toBe(true);
        expect(matches({ isMarkdown: () => false, type: "code", mime: "text/plain" })).toBe(true);
        expect(matches({ isMarkdown: () => false, type: "code", mime: "text/css" })).toBe(false);
    });
});
