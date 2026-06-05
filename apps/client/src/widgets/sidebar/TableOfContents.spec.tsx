import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// The real ckeditor5 bundle is huge and side-effectful; we only need the one runtime helper.
vi.mock("@triliumnext/ckeditor5", () => ({
    attributeChangeAffectsHeading: vi.fn(() => false)
}));

vi.mock("../../services/keyboard_actions", () => ({
    default: { getAction: vi.fn(async () => ({ effectiveShortcuts: [] })) }
}));

// Partial-mock the hooks module: keep the pure ones (useSyncedRef) real so RightPanelWidget renders,
// but stub the data/context/bootstrap hooks so the component is fully drivable.
const hookState: {
    note?: unknown;
    noteContext?: unknown;
    noteType?: string;
    noteMime?: string;
    isReadOnly?: boolean;
    textEditor?: unknown;
    contentElement?: HTMLElement | null;
    contextData?: unknown;
} = {};

vi.mock("../react/hooks", async (importOriginal) => {
    const original = await importOriginal<typeof import("../react/hooks")>();
    return {
        ...original,
        useActiveNoteContext: () => ({ note: hookState.note, noteContext: hookState.noteContext }),
        // useNoteProperty is called for "type" first, then "mime".
        useNoteProperty: (_note: unknown, property: string) =>
            property === "type" ? hookState.noteType : property === "mime" ? hookState.noteMime : undefined,
        useIsNoteReadOnly: () => ({ isReadOnly: hookState.isReadOnly }),
        useTextEditor: () => hookState.textEditor,
        useContentElement: () => hookState.contentElement ?? null,
        useGetContextData: () => hookState.contextData,
        useMathRendering: vi.fn(),
        useStaticTooltip: vi.fn(),
        useTriliumOptionJson: () => [ [] as string[], vi.fn() ]
    };
});

import { attributeChangeAffectsHeading } from "@triliumnext/ckeditor5";

import TableOfContents from "./TableOfContents";

// --- Render harness --------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
function renderToc() {
    const c = document.createElement("div");
    container = c;
    document.body.appendChild(c);
    act(() => render(<TableOfContents />, c));
    return c;
}

function resetState() {
    hookState.note = undefined;
    hookState.noteContext = { ntxId: "ntx1" };
    hookState.noteType = undefined;
    hookState.noteMime = undefined;
    hookState.isReadOnly = false;
    hookState.textEditor = undefined;
    hookState.contentElement = null;
    hookState.contextData = undefined;
}

beforeEach(() => {
    resetState();
    vi.clearAllMocks();
    (attributeChangeAffectsHeading as ReturnType<typeof vi.fn>).mockReturnValue(false);
});

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- Fake CKEditor model ---------------------------------------------------------------------------

interface FakeChild {
    isElement: boolean;
    elementName?: string;
    textData?: string;
    equation?: string;
}

interface FakeItem {
    name: string;
    attributes: Record<string, unknown>;
    children: FakeChild[];
    viewEl?: unknown;
    domEl?: HTMLElement | null;
}

/** Build a minimal CKEditor-like editor exposing only the surface that extractTocFromTextEditor reads. */
function makeFakeEditor(items: (FakeItem | null)[], opts: {
    root?: unknown;
    changeListeners?: { cb?: (() => void) };
    differChanges?: unknown[];
} = {}) {
    const root = opts.root === undefined ? {} : opts.root;
    const listeners: Record<string, (() => void)[]> = {};

    const mapper = {
        toViewElement: (item: FakeItem) => item.viewEl,
        // for scrollToHeading
        // (heading.element resolves to FakeItem)
    };
    const domConverter = {
        mapViewToDom: (viewEl: unknown) => {
            const owner = items.find(i => i && i.viewEl === viewEl);
            return owner ? owner.domEl : null;
        }
    };

    const editor = {
        model: {
            document: {
                getRoot: () => root,
                differ: { getChanges: () => opts.differChanges ?? [] },
                on: (evt: string, cb: () => void) => {
                    (listeners[evt] ??= []).push(cb);
                },
                off: (evt: string, cb: () => void) => {
                    listeners[evt] = (listeners[evt] ?? []).filter(l => l !== cb);
                }
            },
            createRangeIn: (_root: unknown) => ({
                getWalker: function* () {
                    for (const item of items) {
                        if (!item) {
                            // A non-element walker entry (covers the `type !== elementStart` skip).
                            yield { type: "text", item: { is: () => false, name: "" } };
                            continue;
                        }
                        yield {
                            type: "elementStart",
                            item: makeModelItem(item)
                        };
                    }
                }
            }),
            change: (writer: (w: { setAttribute: (k: string, v: unknown, item: unknown) => void }) => void) => {
                writer({
                    setAttribute: (k: string, v: unknown, item: unknown) => {
                        (item as FakeItem).attributes[k] = v;
                    }
                });
            }
        },
        editing: { mapper, view: { domConverter } }
    };

    return { editor, listeners };
}

function makeModelItem(item: FakeItem) {
    return {
        ...item,
        is: (kind: string, name?: string) => {
            if (kind === "element" && name === undefined) return true;
            if (kind === "element" && name) return item.name === name;
            return false;
        },
        name: item.name,
        getAttribute: (k: string) => item.attributes[k],
        getChildren: () => item.children.map(makeModelChild)
    };
}

function makeModelChild(child: FakeChild) {
    return {
        is: (kind: string, name?: string) => {
            if (kind === "$text") return !child.isElement;
            if (kind === "element" && name) return child.isElement && child.elementName === name;
            if (kind === "element") return child.isElement;
            return false;
        },
        data: child.textData,
        getAttribute: (k: string) => (k === "equation" ? child.equation : undefined)
    };
}

// --- Top-level dispatch ----------------------------------------------------------------------------

describe("TableOfContents top-level dispatch", () => {
    it("renders the read-only TOC variant for read-only text notes", () => {
        hookState.note = { isMarkdown: () => false };
        hookState.noteType = "text";
        hookState.isReadOnly = true;
        const headingEl = document.createElement("h2");
        headingEl.innerHTML = "Read only heading";
        const content = document.createElement("div");
        content.appendChild(headingEl);
        hookState.contentElement = content;

        const root = renderToc();
        expect(root.querySelector("#toc")).toBeTruthy();
        const items = root.querySelectorAll(".toc ol > li");
        expect(items.length).toBe(1);
        expect(root.querySelector(".item-content")?.innerHTML).toBe("Read only heading");
    });

    it("renders the read-only TOC variant for doc notes", () => {
        hookState.note = { isMarkdown: () => false };
        hookState.noteType = "doc";
        hookState.isReadOnly = false;
        hookState.contentElement = document.createElement("div"); // no headings → empty state
        const root = renderToc();
        expect(root.querySelector(".toc .no-headings")).toBeTruthy();
    });

    it("renders the editable TOC variant for editable text notes", () => {
        hookState.note = { isMarkdown: () => false };
        hookState.noteType = "text";
        hookState.isReadOnly = false;
        const { editor } = makeFakeEditor([]);
        hookState.textEditor = editor;
        const root = renderToc();
        // No headings extracted → empty state.
        expect(root.querySelector(".toc .no-headings")).toBeTruthy();
    });

    it("renders the context-data TOC variant for PDF file notes", () => {
        hookState.note = { isMarkdown: () => false };
        hookState.noteType = "file";
        hookState.noteMime = "application/pdf";
        hookState.contextData = {
            headings: [ { id: "p1", level: 1, text: "Page 1" } ],
            scrollToHeading: vi.fn(),
            activeHeadingId: "p1"
        };
        const root = renderToc();
        const active = root.querySelector(".toc li.active");
        expect(active).toBeTruthy();
        expect(root.querySelector(".item-content")?.innerHTML).toBe("Page 1");
    });

    it("renders the context-data TOC variant for markdown notes and tolerates missing data", () => {
        hookState.note = { isMarkdown: () => true };
        hookState.noteType = "code";
        hookState.contextData = undefined; // exercises the `|| []` / `|| (() => {})` fallbacks
        const root = renderToc();
        expect(root.querySelector(".toc .no-headings")).toBeTruthy();
    });

    it("uses the no-op scrollToHeading fallback when context data lacks one", () => {
        hookState.note = { isMarkdown: () => true };
        hookState.noteType = "code";
        // headings present but no scrollToHeading → `|| (() => {})` fallback is wired to clicks.
        hookState.contextData = { headings: [ { id: "x", level: 1, text: "X" } ] };
        const root = renderToc();
        const itemContent = root.querySelector(".item-content");
        expect(() => act(() => (itemContent as HTMLElement).click())).not.toThrow();
    });

    it("renders nothing inside the panel for unsupported note types", () => {
        hookState.note = { isMarkdown: () => false };
        hookState.noteType = "render";
        const root = renderToc();
        expect(root.querySelector(".toc")).toBeNull();
        expect(root.querySelector("#toc")).toBeTruthy(); // RightPanelWidget shell still present
    });
});

// --- AbstractTableOfContents / nesting / interaction ----------------------------------------------

describe("AbstractTableOfContents nesting and interaction", () => {
    function renderContextToc(contextData: unknown) {
        hookState.note = { isMarkdown: () => true };
        hookState.noteType = "code";
        hookState.contextData = contextData;
        return renderToc();
    }

    it("builds a nested tree, renders collapse buttons, and toggles collapse", () => {
        const scrollToHeading = vi.fn();
        const root = renderContextToc({
            headings: [
                { id: "h1", level: 1, text: "Chapter" },
                { id: "h2a", level: 2, text: "Section A" },
                { id: "h2b", level: 2, text: "Section B" }
            ],
            scrollToHeading
        });

        // Top-level li with two nested children.
        const topLi = root.querySelector(".toc > ol > li");
        expect(topLi).toBeTruthy();
        const nestedLis = root.querySelectorAll(".toc > ol > ol > li");
        expect(nestedLis.length).toBe(2);

        // The parent heading shows a collapse button; toggling it adds the collapsed class.
        const collapseBtn = topLi?.querySelector(".collapse-button");
        expect(collapseBtn).toBeTruthy();
        expect(topLi?.classList.contains("collapsed")).toBe(false);
        act(() => (collapseBtn as HTMLElement).click());
        expect(root.querySelector(".toc > ol > li")?.classList.contains("collapsed")).toBe(true);
        act(() => (root.querySelector(".collapse-button") as HTMLElement).click());
        expect(root.querySelector(".toc > ol > li")?.classList.contains("collapsed")).toBe(false);
    });

    it("fires scrollToHeading when an item content is clicked", () => {
        const scrollToHeading = vi.fn();
        const root = renderContextToc({
            headings: [ { id: "only", level: 1, text: "Solo" } ],
            scrollToHeading
        });
        const itemContent = root.querySelector(".item-content");
        act(() => (itemContent as HTMLElement).click());
        expect(scrollToHeading).toHaveBeenCalledTimes(1);
        expect(scrollToHeading).toHaveBeenCalledWith(expect.objectContaining({ id: "only", text: "Solo" }));
    });

    it("does not render a collapse button for leaf headings", () => {
        const root = renderContextToc({
            headings: [ { id: "leaf", level: 1, text: "Leaf" } ],
            scrollToHeading: vi.fn()
        });
        expect(root.querySelector(".collapse-button")).toBeNull();
    });

    it("handles a heading whose level is shallower than the previous one (stack pop)", () => {
        const root = renderContextToc({
            headings: [
                { id: "a", level: 2, text: "Deep first" },
                { id: "b", level: 1, text: "Shallow second" }
            ],
            scrollToHeading: vi.fn()
        });
        // Both should be top-level siblings since the second is shallower.
        const topLis = root.querySelectorAll(".toc > ol > li");
        expect(topLis.length).toBe(2);
    });
});

// --- Editable text TOC (CKEditor extraction) ------------------------------------------------------

describe("EditableTextTableOfContents (CKEditor extraction)", () => {
    function renderEditable(editor: unknown) {
        hookState.note = { isMarkdown: () => false };
        hookState.noteType = "text";
        hookState.isReadOnly = false;
        hookState.textEditor = editor;
        return renderToc();
    }

    it("renders nothing extra and shows empty state when there is no text editor yet", () => {
        const root = renderEditable(undefined);
        expect(root.querySelector(".toc .no-headings")).toBeTruthy();
    });

    it("extracts headings via DOM conversion and preserves inner HTML", () => {
        const domEl = document.createElement("h1");
        domEl.innerHTML = "<strong>Title</strong>";
        const item: FakeItem = {
            name: "heading1",
            attributes: { tocId: "existing-id" },
            children: [ { isElement: false, textData: "Title" } ],
            viewEl: { v: 1 },
            domEl
        };
        const { editor } = makeFakeEditor([ item ]);
        const root = renderEditable(editor);
        const itemContent = root.querySelector(".item-content");
        expect(itemContent?.innerHTML).toBe("<strong>Title</strong>");
    });

    it("assigns a new toc id when the heading has none (writer.setAttribute)", () => {
        const domEl = document.createElement("h2");
        domEl.innerHTML = "Generated";
        const item: FakeItem = {
            name: "heading2",
            attributes: {}, // no tocId → randomString + setAttribute
            children: [ { isElement: false, textData: "Generated" } ],
            viewEl: { v: 2 },
            domEl
        };
        const { editor } = makeFakeEditor([ item ]);
        renderEditable(editor);
        expect(typeof item.attributes.tocId).toBe("string");
        expect((item.attributes.tocId as string).length).toBeGreaterThan(0);
    });

    it("replaces ck-math-tex spans using the model equation", () => {
        const domEl = document.createElement("h1");
        const ckMath = document.createElement("span");
        ckMath.className = "ck-math-tex";
        domEl.appendChild(document.createTextNode("E="));
        domEl.appendChild(ckMath);
        const item: FakeItem = {
            name: "heading1",
            attributes: { tocId: "m1" },
            children: [
                { isElement: false, textData: "E=" },
                { isElement: true, elementName: "mathtex-inline", equation: "mc^2" }
            ],
            viewEl: { v: 9 },
            domEl
        };
        const { editor } = makeFakeEditor([ item ]);
        const root = renderEditable(editor);
        const html = root.querySelector(".item-content")?.innerHTML ?? "";
        expect(html).toContain("math-tex");
        expect(html).toContain("\\(mc^2\\)");
        expect(html).not.toContain("ck-math-tex");
    });

    it("defaults the equation to empty when a math child has no equation attribute", () => {
        const domEl = document.createElement("h1");
        const ckMath = document.createElement("span");
        ckMath.className = "ck-math-tex";
        domEl.appendChild(ckMath);
        const item: FakeItem = {
            name: "heading1",
            attributes: { tocId: "noeq" },
            children: [
                // equation undefined → `?? ''` fallback exercised.
                { isElement: true, elementName: "mathtex-inline" }
            ],
            viewEl: { v: 13 },
            domEl
        };
        const { editor } = makeFakeEditor([ item ]);
        const root = renderEditable(editor);
        const html = root.querySelector(".item-content")?.innerHTML ?? "";
        expect(html).toContain("math-tex");
        expect(html).toContain("\\(\\)");
    });

    it("breaks out of math replacement when there are more math children than ck spans", () => {
        const domEl = document.createElement("h1");
        const ckMath = document.createElement("span");
        ckMath.className = "ck-math-tex";
        domEl.appendChild(ckMath); // only ONE span for TWO math children
        const item: FakeItem = {
            name: "heading1",
            attributes: { tocId: "mm1" },
            children: [
                { isElement: true, elementName: "mathtex-inline", equation: "a" },
                { isElement: true, elementName: "mathtex-inline", equation: "b" } // mathIdx >= length → break
            ],
            viewEl: { v: 11 },
            domEl
        };
        const { editor } = makeFakeEditor([ item ]);
        const root = renderEditable(editor);
        const html = root.querySelector(".item-content")?.innerHTML ?? "";
        expect(html).toContain("\\(a\\)"); // first replaced
        expect(html).not.toContain("\\(b\\)"); // second skipped due to break
    });

    it("falls back to plain text when the DOM node is not an HTMLElement", () => {
        // mapViewToDom returns a Text node → `domEl instanceof HTMLElement` is false.
        const item: FakeItem = {
            name: "heading1",
            attributes: { tocId: "tn1" },
            children: [ { isElement: false, textData: "TextNode" } ],
            viewEl: { v: 77 },
            domEl: document.createTextNode("TextNode") as unknown as HTMLElement
        };
        const { editor } = makeFakeEditor([ item ]);
        const root = renderEditable(editor);
        expect(root.querySelector(".item-content")?.innerHTML).toBe("TextNode");
    });

    it("falls back to plain text when DOM conversion is unavailable", () => {
        const item: FakeItem = {
            name: "heading3",
            attributes: { tocId: "f1" },
            children: [
                { isElement: false, textData: "Plain " },
                { isElement: true, elementName: "softBreak" }, // non-text child → contributes ''
                { isElement: false, textData: "Text" }
            ],
            viewEl: undefined, // no view element → toViewElement returns undefined → fallback path
            domEl: null
        };
        const { editor } = makeFakeEditor([ item ]);
        const root = renderEditable(editor);
        expect(root.querySelector(".item-content")?.innerHTML).toBe("Plain Text");
    });

    it("skips walker entries that are not heading elementStarts", () => {
        const heading: FakeItem = {
            name: "heading1",
            attributes: { tocId: "k1" },
            children: [ { isElement: false, textData: "Kept" } ],
            viewEl: { v: 5 },
            domEl: (() => { const d = document.createElement("h1"); d.innerHTML = "Kept"; return d; })()
        };
        const paragraph: FakeItem = {
            name: "paragraph",
            attributes: {},
            children: [ { isElement: false, textData: "ignored" } ]
        };
        // `null` entry → non-elementStart walker step; paragraph → element but not a heading.
        const { editor } = makeFakeEditor([ null, paragraph, heading ]);
        const root = renderEditable(editor);
        const items = root.querySelectorAll(".toc ol > li");
        expect(items.length).toBe(1);
        expect(root.querySelector(".item-content")?.innerHTML).toBe("Kept");
    });

    it("returns empty headings when the editor has no root", () => {
        const { editor } = makeFakeEditor([], { root: null });
        const root = renderEditable(editor);
        expect(root.querySelector(".toc .no-headings")).toBeTruthy();
    });

    it("re-extracts on a heading-affecting change and ignores irrelevant changes", () => {
        const makeHeading = (text: string): FakeItem => ({
            name: "heading1",
            attributes: { tocId: "chg" },
            children: [ { isElement: false, textData: text } ],
            viewEl: { v: 1 },
            domEl: (() => { const d = document.createElement("h1"); d.innerHTML = text; return d; })()
        });
        const { editor, listeners } = makeFakeEditor([ makeHeading("Before") ]);
        const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
            cb(0);
            return 0;
        });
        renderEditable(editor);
        const fire = () => act(() => listeners["change:data"]?.forEach(l => l()));

        // insert change → triggers re-extract.
        editor.model.document.differ.getChanges = () => [ { type: "insert" } ];
        fire();
        // remove change → triggers re-extract.
        editor.model.document.differ.getChanges = () => [ { type: "remove" } ];
        fire();
        // attribute change that affects headings.
        (attributeChangeAffectsHeading as ReturnType<typeof vi.fn>).mockReturnValue(true);
        editor.model.document.differ.getChanges = () => [ { type: "attribute" } ];
        fire();
        // attribute change that does NOT affect headings → no re-extract scheduled.
        (attributeChangeAffectsHeading as ReturnType<typeof vi.fn>).mockReturnValue(false);
        editor.model.document.differ.getChanges = () => [ { type: "attribute" } ];
        rafSpy.mockClear();
        fire();
        expect(rafSpy).not.toHaveBeenCalled();
    });

    it("unsubscribes from the change listener on unmount", () => {
        const { editor, listeners } = makeFakeEditor([]);
        renderEditable(editor);
        expect(listeners["change:data"]?.length).toBe(1);
        const c = container;
        if (c) {
            act(() => render(null, c));
            c.remove();
            container = undefined;
        }
        expect(listeners["change:data"]?.length).toBe(0);
    });

    it("scrollToHeading maps the model element through to the DOM and scrolls", () => {
        const domEl = document.createElement("h1");
        domEl.innerHTML = "Clickme";
        const scrollIntoView = vi.fn();
        domEl.scrollIntoView = scrollIntoView;
        const item: FakeItem = {
            name: "heading1",
            attributes: { tocId: "s1" },
            children: [ { isElement: false, textData: "Clickme" } ],
            viewEl: { v: 42 },
            domEl
        };
        const { editor } = makeFakeEditor([ item ]);
        const root = renderEditable(editor);
        act(() => (root.querySelector(".item-content") as HTMLElement).click());
        expect(scrollIntoView).toHaveBeenCalled();
    });

    it("scrollToHeading is a no-op when the heading has no view element", () => {
        const item: FakeItem = {
            name: "heading1",
            attributes: { tocId: "nv1" },
            children: [ { isElement: false, textData: "NoView" } ],
            viewEl: undefined,
            domEl: null
        };
        const { editor } = makeFakeEditor([ item ]);
        const root = renderEditable(editor);
        // Falls back to plain text; clicking must not throw despite missing view element.
        expect(() => act(() => (root.querySelector(".item-content") as HTMLElement).click())).not.toThrow();
    });
});

// --- Read-only text TOC ---------------------------------------------------------------------------

describe("ReadOnlyTextTableOfContents", () => {
    function renderReadOnly(contentElement: HTMLElement | null) {
        hookState.note = { isMarkdown: () => false };
        hookState.noteType = "text";
        hookState.isReadOnly = true;
        hookState.contentElement = contentElement;
        return renderToc();
    }

    it("extracts all heading levels and scrolls on click", () => {
        const content = document.createElement("div");
        content.innerHTML = "<h1>One</h1><h3>Three</h3><h6>Six</h6>";
        const scrollSpies = Array.from(content.querySelectorAll("h1,h2,h3,h4,h5,h6")).map(el => {
            const spy = vi.fn();
            (el as HTMLElement).scrollIntoView = spy;
            return spy;
        });
        const root = renderReadOnly(content);
        const items = root.querySelectorAll(".toc ol > li");
        expect(items.length).toBe(3);

        act(() => (root.querySelector(".item-content") as HTMLElement).click());
        expect(scrollSpies[0]).toHaveBeenCalled();
    });

    it("shows the empty state when there is no content element", () => {
        const root = renderReadOnly(null);
        expect(root.querySelector(".toc .no-headings")).toBeTruthy();
    });
});
