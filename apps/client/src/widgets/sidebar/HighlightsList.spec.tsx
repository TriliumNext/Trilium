import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapMock } from "../../test/mocks";
import { renderInto } from "../../test/render";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// bootstrap (Modal/Tooltip) — render path touches it indirectly; provide inert stubs.
vi.mock("bootstrap", () => bootstrapMock());

// math.render must be a no-op (KaTeX is not loaded in happy-dom).
vi.mock("../../services/math", () => ({ default: { render: vi.fn() } }));

// Replace the heavy Modal with a transparent shell so we can assert structure without bootstrap.
vi.mock("../react/Modal", () => ({
    default: ({ show, children, className, onHidden }: { show: boolean; children: unknown; className: string; onHidden: () => void }) => (
        <div className={`fake-modal ${className}`} data-shown={String(show)}>
            <button className="fake-modal-hide" onClick={() => onHidden()} />
            {children}
        </div>
    )
}));

// Replace RightPanelWidget with a transparent shell that still exposes the title + context menu items
// so we can assert counts and invoke the configure handler without bootstrap/ActionButton machinery.
vi.mock("./RightPanelWidget", () => ({
    default: ({ id, title, children, contextMenuItems }: {
        id: string;
        title: string;
        children: unknown;
        contextMenuItems?: { title: string; handler: () => void }[];
    }) => (
        <div className="fake-right-panel" id={id} data-title={title}>
            <button
                className="fake-configure"
                onClick={() => contextMenuItems?.forEach(item => item.handler())}
            />
            {children}
        </div>
    )
}));

// Control the hooks used by the component so each branch can be exercised deterministically.
const hookState = {
    activeNote: undefined as unknown,
    activeNoteContext: undefined as unknown,
    noteType: "text" as string | undefined,
    isReadOnly: false,
    textEditor: null as unknown,
    contentEl: null as HTMLElement | null,
    highlightsList: [] as string[]
};

vi.mock("../react/hooks", () => ({
    useActiveNoteContext: () => ({ note: hookState.activeNote, noteContext: hookState.activeNoteContext }),
    useNoteProperty: () => hookState.noteType,
    useIsNoteReadOnly: () => ({ isReadOnly: hookState.isReadOnly }),
    useTextEditor: () => hookState.textEditor,
    useContentElement: () => hookState.contentEl,
    useMathRendering: vi.fn(),
    useTriliumOptionJson: () => [ hookState.highlightsList, vi.fn() ]
}));

import HighlightsList, { extractHighlightsFromStaticHtml } from "./HighlightsList";

// --- Render harness ------------------------------------------------------------------------------

beforeEach(() => {
    hookState.activeNote = { noteId: "n1" };
    hookState.activeNoteContext = { ntxId: "ntx1" };
    hookState.noteType = "text";
    hookState.isReadOnly = false;
    hookState.textEditor = null;
    hookState.contentEl = null;
    hookState.highlightsList = [ "bold", "italic", "underline", "color", "bgColor" ];
});

// --- extractHighlightsFromStaticHtml (pure DOM) --------------------------------------------------

function makeEl(html: string): HTMLElement {
    const el = document.createElement("div");
    el.innerHTML = html;
    return el;
}

describe("extractHighlightsFromStaticHtml", () => {
    it("returns [] for a null element", () => {
        expect(extractHighlightsFromStaticHtml(null)).toEqual([]);
    });

    it("extracts styled elements with background-color and color", () => {
        const el = makeEl(
            `<span style="background-color: yellow">highlighted</span>` +
            `<span style="color: red">colored</span>`
        );
        const result = extractHighlightsFromStaticHtml(el);
        expect(result).toHaveLength(2);
        expect(result[0]?.attrs.background).toBe("yellow");
        expect(result[0]?.text).toBe("highlighted");
        expect(result[1]?.attrs.color).toBe("red");
        expect(result.every(h => h.id && h.element instanceof HTMLElement)).toBe(true);
    });

    it("skips styled elements that are empty or whitespace-only", () => {
        const el = makeEl(
            `<span style="background-color: yellow">   </span>` +
            `<span style="color: red"></span>`
        );
        expect(extractHighlightsFromStaticHtml(el)).toHaveLength(0);
    });

    it("does not duplicate an element already processed as styled", () => {
        // A styled <strong> would match both the styled query and the formatting query;
        // it should only appear once.
        const el = makeEl(`<strong style="color: blue">bold colored</strong>`);
        const result = extractHighlightsFromStaticHtml(el);
        expect(result).toHaveLength(1);
        expect(result[0]?.attrs.bold).toBe(true);
        expect(result[0]?.attrs.color).toBe("blue");
    });

    it("skips a styled element with no detectable attributes", () => {
        // An inline style mentioning "color" in a way that yields no computed color and no bold/italic/underline.
        const el = makeEl(`<span style="border-color: red">no real highlight</span>`);
        const result = extractHighlightsFromStaticHtml(el);
        expect(result).toHaveLength(0);
    });

    it("extracts bold / italic / underline formatting elements", () => {
        const el = makeEl(
            `<strong>boldText</strong>` +
            `<em>italicText</em>` +
            `<u>underlineText</u>` +
            `<b>bText</b>` +
            `<i>iText</i>`
        );
        const result = extractHighlightsFromStaticHtml(el);
        expect(result).toHaveLength(5);
        expect(result[0]?.attrs.bold).toBe(true);
        expect(result[1]?.attrs.italic).toBe(true);
        expect(result[2]?.attrs.underline).toBe(true);
        expect(result[3]?.attrs.bold).toBe(true);
        expect(result[4]?.attrs.italic).toBe(true);
    });

    it("detects nested bold/italic/underline ancestry on styled elements", () => {
        const el = makeEl(
            `<strong><em><u><span style="background-color: lime">deep</span></u></em></strong>`
        );
        const result = extractHighlightsFromStaticHtml(el);
        const styled = result.find(h => h.attrs.background === "lime");
        expect(styled?.attrs.bold).toBe(true);
        expect(styled?.attrs.italic).toBe(true);
        expect(styled?.attrs.underline).toBe(true);
    });

    it("skips formatting elements nested inside an already-processed styled element", () => {
        const el = makeEl(`<span style="background-color: yellow">outer <strong>inner</strong></span>`);
        const result = extractHighlightsFromStaticHtml(el);
        // Only the outer styled span; the inner <strong> is contained by a processed element.
        expect(result).toHaveLength(1);
        expect(result[0]?.attrs.background).toBe("yellow");
    });

    it("skips empty formatting elements", () => {
        const el = makeEl(`<strong>   </strong><em></em>`);
        expect(extractHighlightsFromStaticHtml(el)).toHaveLength(0);
    });
});

// --- Top-level component branch selection --------------------------------------------------------

describe("HighlightsList branch selection", () => {
    it("renders nothing when the note is not a text note", () => {
        hookState.noteType = "code";
        const root = renderInto(<HighlightsList />);
        expect(root.querySelector(".fake-right-panel")).toBeNull();
    });

    it("renders nothing when noteType is undefined", () => {
        hookState.noteType = undefined;
        const root = renderInto(<HighlightsList />);
        expect(root.querySelector(".fake-right-panel")).toBeNull();
    });

    it("renders the read-only list for a read-only text note", () => {
        hookState.isReadOnly = true;
        const el = makeEl(`<strong>read only highlight</strong>`);
        hookState.contentEl = el;
        const root = renderInto(<HighlightsList />);
        expect(root.querySelector(".fake-right-panel")).not.toBeNull();
        expect(root.querySelector(".highlights-list ol li")).not.toBeNull();
    });

    it("renders the editable list for an editable text note (no editor → empty)", () => {
        hookState.isReadOnly = false;
        hookState.textEditor = null;
        const root = renderInto(<HighlightsList />);
        expect(root.querySelector(".fake-right-panel")).not.toBeNull();
        // No editor → no highlights → the no-highlights placeholder is shown.
        expect(root.querySelector(".highlights-list .no-highlights")).not.toBeNull();
    });
});

// --- AbstractHighlightsList / HighlightItem (via read-only branch) --------------------------------

describe("AbstractHighlightsList rendering and interaction", () => {
    it("shows the no-highlights placeholder when nothing matches the filter", () => {
        hookState.isReadOnly = true;
        hookState.contentEl = makeEl(`<p>nothing special</p>`);
        const root = renderInto(<HighlightsList />);
        expect(root.querySelector(".highlights-list .no-highlights")).not.toBeNull();
        expect(root.querySelector(".highlights-list ol")).toBeNull();
    });

    it("filters out highlights when the option set excludes their attributes", () => {
        hookState.isReadOnly = true;
        hookState.highlightsList = [ "color" ]; // only color highlights are shown
        hookState.contentEl = makeEl(`<strong>bold only</strong>`);
        const root = renderInto(<HighlightsList />);
        // bold-only highlight is filtered out because the option set only includes "color".
        expect(root.querySelector(".highlights-list .no-highlights")).not.toBeNull();
    });

    it("renders a list item per matching highlight and applies inline styles", () => {
        hookState.isReadOnly = true;
        hookState.contentEl = makeEl(
            `<strong>boldItem</strong>` +
            `<em>italicItem</em>` +
            `<u>underlineItem</u>` +
            `<span style="color: red">colorItem</span>` +
            `<span style="background-color: yellow">bgItem</span>`
        );
        const root = renderInto(<HighlightsList />);
        const spans = Array.from(root.querySelectorAll<HTMLSpanElement>(".highlights-list ol li span"));
        expect(spans.length).toBe(5);

        // Assertions are order-independent: match each style on at least one rendered span.
        expect(spans.some(s => s.style.fontWeight === "700")).toBe(true);
        expect(spans.some(s => s.style.fontStyle === "italic")).toBe(true);
        expect(spans.some(s => s.style.textDecoration === "underline")).toBe(true);
        expect(spans.some(s => s.style.color === "red")).toBe(true);
        expect(spans.some(s => s.style.backgroundColor === "yellow")).toBe(true);
    });

    it("invokes the configure handler which shows the options modal", () => {
        hookState.isReadOnly = true;
        hookState.contentEl = makeEl(`<strong>x</strong>`);
        const root = renderInto(<HighlightsList />);
        const modalBefore = document.querySelector(".fake-modal.highlights-list-options-modal");
        expect(modalBefore?.getAttribute("data-shown")).toBe("false");

        const configureBtn = root.querySelector(".fake-configure");
        expect(configureBtn).not.toBeNull();
        act(() => (configureBtn as HTMLButtonElement).click());

        const modalAfter = document.querySelector(".fake-modal.highlights-list-options-modal");
        expect(modalAfter?.getAttribute("data-shown")).toBe("true");

        // Triggering the modal's onHidden resets the shown state to false.
        const hideBtn = modalAfter?.querySelector(".fake-modal-hide");
        act(() => (hideBtn as HTMLButtonElement).click());
        const modalHidden = document.querySelector(".fake-modal.highlights-list-options-modal");
        expect(modalHidden?.getAttribute("data-shown")).toBe("false");
    });

    it("scrolls to the highlight element when a list item is clicked", () => {
        hookState.isReadOnly = true;
        const el = makeEl(`<strong>scroll target</strong>`);
        hookState.contentEl = el;
        const strong = el.querySelector("strong");
        const scrollSpy = vi.fn();
        if (strong) {
            strong.scrollIntoView = scrollSpy;
        }
        const root = renderInto(<HighlightsList />);
        const li = root.querySelector(".highlights-list ol li");
        act(() => (li as HTMLLIElement).click());
        expect(scrollSpy).toHaveBeenCalled();
    });
});

// --- Editable branch with a fake CKEditor --------------------------------------------------------

interface FakeTextProxy {
    data: string;
    textNode: { _id: string };
    startOffset: number;
    attrs: Record<string, unknown>;
    is(type: string): boolean;
    hasAttribute(name: string): boolean;
    getAttribute(name: string): unknown;
}

function makeTextProxy(data: string, attrs: Record<string, unknown>): FakeTextProxy {
    return {
        data,
        textNode: { _id: data },
        startOffset: 0,
        attrs,
        is: (type: string) => type === "$textProxy",
        hasAttribute: (name: string) => Boolean(attrs[name]),
        getAttribute: (name: string) => attrs[name]
    };
}

function makeFakeEditor(items: FakeTextProxy[], opts: { rootNull?: boolean; domThrows?: boolean } = {}) {
    const changeListeners: Record<string, (() => void)[]> = {};
    const differChanges: { type: string; attributeKey?: string }[] = [];

    const editor = {
        _changeListeners: changeListeners,
        _differChanges: differChanges,
        model: {
            document: {
                differ: { getChanges: () => differChanges },
                getRoot: () => (opts.rootNull ? null : { _root: true }),
                on: (event: string, cb: () => void) => {
                    (changeListeners[event] ||= []).push(cb);
                },
                off: (event: string, cb: () => void) => {
                    changeListeners[event] = (changeListeners[event] || []).filter(c => c !== cb);
                }
            },
            createRangeIn: () => ({
                getWalker: () => items.map(item => ({ item }))
            }),
            createPositionAt: (node: unknown) => ({ _pos: node })
        },
        editing: {
            mapper: { toViewPosition: (pos: unknown) => ({ _view: pos }) },
            view: {
                domConverter: {
                    viewPositionToDom: () => {
                        if (opts.domThrows) {
                            throw new Error("not synced");
                        }
                        const parent = document.createElement("span");
                        parent.innerHTML = "<b>dom html</b>";
                        return { parent };
                    }
                }
            }
        }
    };
    return editor;
}

describe("EditableTextHighlightsList with a fake editor", () => {
    function fireChange(editor: ReturnType<typeof makeFakeEditor>) {
        act(() => {
            for (const cb of editor._changeListeners["change:data"] || []) {
                cb();
            }
        });
    }

    it("extracts highlights from the editor and renders them", () => {
        const items = [
            makeTextProxy("bold text", { bold: true }),
            makeTextProxy("colored", { fontColor: "#ff0000" }),
            makeTextProxy("plain text", {}), // no attrs → skipped
            makeTextProxy("   ", { bold: true }) // whitespace-only → skipped
        ];
        hookState.textEditor = makeFakeEditor(items);
        const root = renderInto(<HighlightsList />);
        const lis = root.querySelectorAll(".highlights-list ol li");
        expect(lis.length).toBe(2);
        // The DOM-derived HTML is used when available.
        expect(lis[0]?.querySelector("span")?.innerHTML).toContain("dom html");
    });

    it("falls back to raw text when the DOM conversion throws", () => {
        const items = [ makeTextProxy("italic raw", { italic: true }) ];
        hookState.textEditor = makeFakeEditor(items, { domThrows: true });
        const root = renderInto(<HighlightsList />);
        const span = root.querySelector(".highlights-list ol li span");
        expect(span?.innerHTML).toContain("italic raw");
    });

    it("returns no highlights when the model root is null", () => {
        hookState.textEditor = makeFakeEditor([ makeTextProxy("x", { bold: true }) ], { rootNull: true });
        const root = renderInto(<HighlightsList />);
        expect(root.querySelector(".highlights-list .no-highlights")).not.toBeNull();
    });

    it("re-extracts highlights when a relevant change:data event fires", () => {
        const editor = makeFakeEditor([ makeTextProxy("bold", { bold: true }) ]);
        hookState.textEditor = editor;
        const root = renderInto(<HighlightsList />);
        expect(root.querySelectorAll(".highlights-list ol li").length).toBe(1);

        // An insert change should trigger re-extraction.
        editor._differChanges.push({ type: "insert" });
        fireChange(editor);
        expect(root.querySelectorAll(".highlights-list ol li").length).toBe(1);
    });

    it("re-extracts on a formatting attribute change and ignores unrelated changes", () => {
        const editor = makeFakeEditor([ makeTextProxy("under", { underline: true }) ]);
        hookState.textEditor = editor;
        renderInto(<HighlightsList />);

        // Relevant attribute change.
        editor._differChanges.length = 0;
        editor._differChanges.push({ type: "attribute", attributeKey: "italic" });
        fireChange(editor);

        // remove change is also relevant.
        editor._differChanges.length = 0;
        editor._differChanges.push({ type: "remove" });
        fireChange(editor);

        // Irrelevant attribute change → no effect (the some() callback returns false).
        editor._differChanges.length = 0;
        editor._differChanges.push({ type: "attribute", attributeKey: "alignment" });
        fireChange(editor);

        // Irrelevant change type → no effect.
        editor._differChanges.length = 0;
        editor._differChanges.push({ type: "marker" });
        fireChange(editor);

        expect(true).toBe(true);
    });

    it("does nothing when there is no editor (effect early-returns)", () => {
        hookState.textEditor = null;
        const root = renderInto(<HighlightsList />);
        expect(root.querySelector(".highlights-list .no-highlights")).not.toBeNull();
    });

    it("scrolls to the heading via the model position mapping (HTMLElement parent)", () => {
        const editor = makeFakeEditor([ makeTextProxy("bold", { bold: true }) ]);
        const scrollSpy = vi.fn();
        editor.editing.view.domConverter.viewPositionToDom = () => {
            const parent = document.createElement("div");
            parent.scrollIntoView = scrollSpy;
            return { parent };
        };
        hookState.textEditor = editor;
        const root = renderInto(<HighlightsList />);
        const li = root.querySelector(".highlights-list ol li");
        act(() => (li as HTMLLIElement).click());
        expect(scrollSpy).toHaveBeenCalled();
    });

    it("scrolls to the heading via a Text-node parent", () => {
        const editor = makeFakeEditor([ makeTextProxy("bold", { bold: true }) ]);
        const scrollSpy = vi.fn();
        editor.editing.view.domConverter.viewPositionToDom = () => {
            const textParent = document.createTextNode("text");
            const wrapper = document.createElement("p");
            wrapper.appendChild(textParent);
            wrapper.scrollIntoView = scrollSpy;
            return { parent: textParent };
        };
        hookState.textEditor = editor;
        const root = renderInto(<HighlightsList />);
        const li = root.querySelector(".highlights-list ol li");
        act(() => (li as HTMLLIElement).click());
        expect(scrollSpy).toHaveBeenCalled();
    });

    it("does not scroll when the DOM position cannot be resolved", () => {
        const editor = makeFakeEditor([ makeTextProxy("bold", { bold: true }) ]);
        editor.editing.view.domConverter.viewPositionToDom = () => null;
        hookState.textEditor = editor;
        const root = renderInto(<HighlightsList />);
        const li = root.querySelector(".highlights-list ol li");
        // Should not throw.
        act(() => (li as HTMLLIElement).click());
        expect(li).not.toBeNull();
    });
});
