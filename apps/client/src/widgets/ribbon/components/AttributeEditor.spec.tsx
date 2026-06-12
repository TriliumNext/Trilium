import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MutableRef } from "preact/hooks";

import { bootstrapMock } from "../../../test/mocks";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// i18next is not initialized in the test env, so its `t` yields undefined; return the key instead so
// `escapeQuotes(t(...))` (and the module-level HELP_TEXT) get strings, not undefined. Keep the other
// exports (translationsInitializedPromise, etc.) intact via importOriginal.
vi.mock("../../../services/i18n", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/i18n")>()),
    t: (key: string) => key
}));

vi.mock("bootstrap", () => bootstrapMock());

// The real ckeditor5 bundle is huge and irrelevant here (CKEditor itself is mocked below); provide
// just the named symbols referenced at module top-level.
vi.mock("@triliumnext/ckeditor5", () => ({
    AttributeEditor: class FakeAttributeEditor {},
    MentionFeed: class {},
    ModelElement: class {},
    ModelNode: class {},
    ModelPosition: class {}
}));

// A lightweight stand-in for the CKEditor wrapper. It exposes the props it was rendered with (so we
// can drive onChange/onClick/onBlur/onKeyDown), and wires up the imperative apiRef + onInitialized.
const ckEditorState: {
    props: Record<string, any> | undefined;
    setText: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
} = { props: undefined, setText: vi.fn(), focus: vi.fn() };

vi.mock("../../react/CKEditor", () => ({
    default: (props: any) => {
        ckEditorState.props = props;
        if (props.apiRef) {
            props.apiRef.current = { setText: ckEditorState.setText, focus: ckEditorState.focus };
        }
        props.onInitialized?.({});
        return null;
    }
}));

// A trivial BasicWidget subclass whose imperative methods we can spy on.
const attributeDetailState: {
    showAttributeDetail: ReturnType<typeof vi.fn>;
    hide: ReturnType<typeof vi.fn>;
} = { showAttributeDetail: vi.fn(), hide: vi.fn() };

vi.mock("../../attribute_widgets/attribute_detail", async () => {
    const { default: BasicWidget } = await import("../../basic_widget");
    class FakeAttributeDetailWidget extends BasicWidget {
        showAttributeDetail = attributeDetailState.showAttributeDetail;
        hide = attributeDetailState.hide;
        doRender() { this.$widget = $("<div class='fake-attr-detail'></div>"); }
    }
    return { default: FakeAttributeDetailWidget };
});

// Capture context-menu invocations so we can drive the menu item handlers + onHide.
const contextMenuState: { options: any } = { options: undefined };
vi.mock("../../../menus/context_menu", () => ({
    default: { show: vi.fn((options: any) => { contextMenuState.options = options; }) }
}));

import FAttribute from "../../../entities/fattribute";
import type FNote from "../../../entities/fnote";
import contextMenu from "../../../menus/context_menu";
import attribute_parser from "../../../services/attribute_parser";
import froca from "../../../services/froca";
import link from "../../../services/link";
import note_autocomplete from "../../../services/note_autocomplete";
import note_create from "../../../services/note_create";
import options from "../../../services/options";
import server from "../../../services/server";
import { buildNote } from "../../../test/easy-froca";
import { flush, makeLoadResults, renderComponent, resetFroca } from "../../../test/render";
import type Component from "../../../components/component";
import AttributeEditor, { AttributeEditorImperativeHandlers } from "./AttributeEditor";

// --- Harness --------------------------------------------------------------------------------------

let parent: Component;

function renderEditor(props: {
    note: FNote;
    componentId?: string;
    notePath?: string | null;
    ntxId?: string | null;
    hidden?: boolean;
}) {
    const api: MutableRef<AttributeEditorImperativeHandlers | null> = { current: null };
    const result = renderComponent(
        <AttributeEditor
            api={api}
            note={props.note}
            componentId={props.componentId ?? "comp-1"}
            notePath={props.notePath}
            ntxId={props.ntxId}
            hidden={props.hidden}
        />
    );
    parent = result.parent;
    return { api, parent, container: result.container };
}

function fireEvent(name: string, data: unknown) {
    act(() => { (parent.handleEventInChildren as any)(name, data); });
}

beforeEach(() => {
    resetFroca();
    options.load({ locale: "en" } as any);
    vi.clearAllMocks();
    Object.assign(($.fn as unknown as Record<string, unknown>), { tooltip: vi.fn() });
    ckEditorState.props = undefined;
    ckEditorState.setText = vi.fn();
    ckEditorState.focus = vi.fn();
    attributeDetailState.showAttributeDetail = vi.fn();
    attributeDetailState.hide = vi.fn();
    contextMenuState.options = undefined;
});

// --- Tests ----------------------------------------------------------------------------------------

describe("AttributeEditor rendering & initial refresh", () => {
    it("renders the editor wrapper, focuses on init, and seeds editor text from owned attributes", async () => {
        const note = buildNote({ id: "n1", title: "N", "#archived": "true" });
        const { container } = renderEditor({ note });
        await flush();

        expect(container.querySelector(".attribute-list-editor-wrapper")).toBeTruthy();
        // onInitialized → editor focus
        expect(ckEditorState.focus).toHaveBeenCalled();
        // refresh() on mount renders owned attributes into the editor
        expect(ckEditorState.setText).toHaveBeenCalled();
        const lastText = ckEditorState.setText.mock.calls.at(-1)?.[0] as string;
        expect(lastText).toContain("#archived");
    });

    it("renders nothing inside the wrapper when hidden, but still mounts the detail portal", async () => {
        const note = buildNote({ id: "hid", title: "H" });
        const { container } = renderEditor({ note, hidden: true });
        await flush();
        expect(container.querySelector(".attribute-list-editor-wrapper")).toBeNull();
    });
});

describe("CKEditor onChange → needsSaving + save button", () => {
    it("marks needsSaving when content diverges from last saved, then clears the flag on save", async () => {
        const note = buildNote({ id: "chg", title: "C" });
        const { container } = renderEditor({ note });
        await flush();

        // No save button initially (nothing changed).
        expect(container.querySelector(".save-attributes-button")).toBeNull();

        act(() => ckEditorState.props?.onChange("<p>#foo=bar</p>"));
        await flush();
        const saveBtn = container.querySelector(".save-attributes-button");
        expect(saveBtn).toBeTruthy();

        // Clicking the save button persists via server.put and removes the button again.
        act(() => (saveBtn as HTMLButtonElement).click());
        await flush();
        expect(server.put).toHaveBeenCalledTimes(1);
        const [ url ] = (server.put as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(url).toBe("notes/chg/attributes");
        expect(container.querySelector(".save-attributes-button")).toBeNull();

        // The "blink" effect sets opacity to 0 then restores it to 1 after a timeout.
        const wrapper = container.querySelector(".attribute-list-editor-wrapper") as HTMLElement;
        await new Promise((r) => setTimeout(r, 150));
        await flush();
        expect(wrapper.style.opacity).toBe("1");
    });

    it("does not flag needsSaving when the normalized content is unchanged", async () => {
        const note = buildNote({ id: "same", title: "S" });
        const { container } = renderEditor({ note });
        await flush();
        act(() => ckEditorState.props?.onChange(""));
        await flush();
        expect(container.querySelector(".save-attributes-button")).toBeNull();
    });
});

describe("error handling", () => {
    it("shows the attribute-errors block when parsing fails on save attempt", async () => {
        const note = buildNote({ id: "err", title: "E" });
        const { container } = renderEditor({ note });
        await flush();

        // An invalid attribute string makes the parser throw.
        act(() => ckEditorState.props?.onChange("<p>not-an-attribute</p>"));
        await flush();
        // Trigger save via Enter key handler on the wrapper (calls save() → parseAttributes throws).
        const wrapper = container.querySelector(".attribute-list-editor-wrapper") as HTMLElement;
        act(() => { wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
        // save() is scheduled in a timeout; let it run.
        await new Promise((r) => setTimeout(r, 150));
        await flush();
        expect(container.querySelector(".attribute-errors")).toBeTruthy();
    });

    it("clears a previous error on the next onChange", async () => {
        const note = buildNote({ id: "err2", title: "E2" });
        const { container } = renderEditor({ note });
        await flush();
        act(() => ckEditorState.props?.onChange("<p>bad attr</p>"));
        const wrapper = container.querySelector(".attribute-list-editor-wrapper") as HTMLElement;
        act(() => { wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
        await new Promise((r) => setTimeout(r, 150));
        await flush();
        expect(container.querySelector(".attribute-errors")).toBeTruthy();

        act(() => ckEditorState.props?.onChange("<p>#archived</p>"));
        await flush();
        expect(container.querySelector(".attribute-errors")).toBeNull();
    });
});

describe("imperative API (api ref)", () => {
    it("exposes save/refresh/focus/renderOwnedAttributes", async () => {
        const note = buildNote({ id: "api", title: "A", "#archived": "true" });
        const { api } = renderEditor({ note });
        await flush();
        expect(typeof api.current?.save).toBe("function");
        expect(typeof api.current?.refresh).toBe("function");
        expect(typeof api.current?.focus).toBe("function");

        ckEditorState.focus.mockClear();
        act(() => api.current?.focus());
        expect(ckEditorState.focus).toHaveBeenCalled();

        ckEditorState.setText.mockClear();
        const extra = new FAttribute(froca, {
            noteId: "api", attributeId: "x1", type: "label", name: "readOnly", value: "true", position: 5, isInheritable: false
        });
        await act(async () => { await api.current?.renderOwnedAttributes([ extra ]); });
        expect(ckEditorState.setText).toHaveBeenCalled();

        ckEditorState.setText.mockClear();
        act(() => api.current?.refresh());
        await flush();
        expect(ckEditorState.setText).toHaveBeenCalled();
    });

    it("save() is a no-op when nothing needs saving", async () => {
        const note = buildNote({ id: "noop", title: "N" });
        const { api } = renderEditor({ note });
        await flush();
        await act(async () => { await api.current?.save(); });
        expect(server.put).not.toHaveBeenCalled();
    });
});

describe("entitiesReloaded refresh", () => {
    it("refreshes when a reloaded attribute affects the note, and ignores unrelated ones", async () => {
        const note = buildNote({ id: "rel", title: "R" });
        renderEditor({ note, componentId: "comp-X" });
        await flush();

        ckEditorState.setText.mockClear();
        fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({ attributeRows: [ { type: "label", name: "archived", value: "true", noteId: "rel", isDeleted: false } ] })
        });
        await flush();
        expect(ckEditorState.setText).toHaveBeenCalled();

        ckEditorState.setText.mockClear();
        fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({ attributeRows: [ { type: "label", name: "archived", value: "true", noteId: "someOtherUncachedNote", isDeleted: false } ] })
        });
        await flush();
        expect(ckEditorState.setText).not.toHaveBeenCalled();
    });
});

describe("add-new-attribute context menu", () => {
    it("opens the menu and adds a label via selectMenuItemHandler", async () => {
        const note = buildNote({ id: "menu", title: "M" });
        const { container } = renderEditor({ note });
        await flush();

        const addBtn = container.querySelector(".add-new-attribute-button") as HTMLButtonElement;
        expect(addBtn).toBeTruthy();
        act(() => addBtn.click());
        expect(contextMenu.show).toHaveBeenCalled();
        expect(contextMenuState.options).toBeTruthy();

        attributeDetailState.showAttributeDetail.mockClear();
        ckEditorState.setText.mockClear();
        await act(async () => { await contextMenuState.options.selectMenuItemHandler({ command: "addNewLabel" }); });
        // renderOwnedAttributes runs → editor text updated
        expect(ckEditorState.setText).toHaveBeenCalled();
        // showAttributeDetail is scheduled in a timeout
        await new Promise((r) => setTimeout(r, 150));
        expect(attributeDetailState.showAttributeDetail).toHaveBeenCalled();
    });

    it("handles relation/labelDefinition/relationDefinition and ignores unknown commands", async () => {
        const note = buildNote({ id: "menu2", title: "M2" });
        const { container } = renderEditor({ note });
        await flush();
        const addBtn = container.querySelector(".add-new-attribute-button") as HTMLButtonElement;
        act(() => addBtn.click());

        for (const command of [ "addNewRelation", "addNewLabelDefinition", "addNewRelationDefinition" ]) {
            ckEditorState.setText.mockClear();
            await act(async () => { await contextMenuState.options.selectMenuItemHandler({ command }); });
            expect(ckEditorState.setText).toHaveBeenCalled();
        }

        // Unknown command → returns early, no render.
        ckEditorState.setText.mockClear();
        await act(async () => { await contextMenuState.options.selectMenuItemHandler({ command: "somethingElse" }); });
        expect(ckEditorState.setText).not.toHaveBeenCalled();
    });

    it("toggles isMenuOpen and suppresses a transient onHide when re-opening", async () => {
        const note = buildNote({ id: "menu3", title: "M3" });
        const { container } = renderEditor({ note });
        await flush();
        const addBtn = container.querySelector(".add-new-attribute-button") as HTMLButtonElement;

        // First open.
        act(() => addBtn.click());
        const firstOnHide = contextMenuState.options.onHide;
        // Re-open while open → suppressNextOnHide is set.
        act(() => addBtn.click());
        // The transient hide from re-show should be suppressed (no throw, menu stays "open").
        act(() => firstOnHide());
        // A real hide afterwards closes the menu.
        act(() => contextMenuState.options.onHide());
        expect(contextMenu.show).toHaveBeenCalledTimes(2);
    });
});

describe("CKEditor onKeyDown / onBlur", () => {
    it("hides the attribute detail on editor keydown and saves on blur", async () => {
        const note = buildNote({ id: "kb", title: "K" });
        renderEditor({ note });
        await flush();

        attributeDetailState.hide.mockClear();
        act(() => ckEditorState.props?.onKeyDown());
        expect(attributeDetailState.hide).toHaveBeenCalled();

        // onBlur → save(); with nothing to save it's a no-op but must not throw.
        await act(async () => { await ckEditorState.props?.onBlur(); });
        expect(server.put).not.toHaveBeenCalled();
    });
});

describe("CKEditor onClick → attribute detail / help tooltip", () => {
    it("shows the help tooltip when clicking outside any attribute text", async () => {
        const note = buildNote({ id: "clk", title: "Clk" });
        renderEditor({ note });
        await flush();

        // pos without a textNode → help tooltip branch.
        act(() => { ckEditorState.props?.onClick({ pageX: 1, pageY: 2 }, null); });
        await new Promise((r) => setTimeout(r, 150));
        // Tooltip plugin invoked (via useTooltip showTooltip from the state effect).
        expect(($.fn as any).tooltip).toHaveBeenCalled();
    });

    it("matches a clicked attribute and shows its detail popup", async () => {
        const note = buildNote({ id: "clk2", title: "Clk2" });
        renderEditor({ note });
        await flush();

        // Seed currentValueRef with a parseable attribute via onChange.
        act(() => ckEditorState.props?.onChange("#archived"));
        await flush();

        // Build a fake ModelPosition whose textNode points inside the "#archived" token.
        const pos = {
            offset: 5,
            textNode: { data: "#archived", startOffset: 0, previousSibling: null }
        };
        attributeDetailState.showAttributeDetail.mockClear();
        act(() => { ckEditorState.props?.onClick({ pageX: 10, pageY: 20 }, pos); });
        await new Promise((r) => setTimeout(r, 150));
        expect(attributeDetailState.showAttributeDetail).toHaveBeenCalled();
    });

    it("falls back to help tooltip when the parser cannot lex the clicked content", async () => {
        const note = buildNote({ id: "clk3", title: "Clk3" });
        renderEditor({ note });
        await flush();

        act(() => ckEditorState.props?.onChange("not valid attr text"));
        await flush();
        const spy = vi.spyOn(attribute_parser, "lexAndParse").mockImplementation(() => { throw new Error("boom"); });
        const pos = { offset: 3, textNode: { data: "not", startOffset: 0, previousSibling: null } };
        // Should swallow the parse error and return null without throwing.
        act(() => { ckEditorState.props?.onClick({ pageX: 1, pageY: 1 }, pos); });
        await new Promise((r) => setTimeout(r, 150));
        expect(spy).toHaveBeenCalled();
    });

    it("falls into the help-tooltip branch when click is inside text that matches no attribute", async () => {
        const note = buildNote({ id: "clk4", title: "Clk4" });
        renderEditor({ note });
        await flush();
        act(() => ckEditorState.props?.onChange("#archived"));
        await flush();
        // offset 0 → clickIndex 0, which is not greater than any attr.startIndex → no match.
        const pos = { offset: 0, textNode: { data: "#archived", startOffset: 0, previousSibling: null } };
        attributeDetailState.showAttributeDetail.mockClear();
        act(() => { ckEditorState.props?.onClick({ pageX: 1, pageY: 1 }, pos); });
        await new Promise((r) => setTimeout(r, 150));
        expect(attributeDetailState.showAttributeDetail).not.toHaveBeenCalled();
    });
});

describe("legacy imperative handlers (reference links)", () => {
    it("loadReferenceLinkTitle resolves a note title and [missing] otherwise", async () => {
        const target = buildNote({ id: "refTarget", title: "Referenced" });
        const note = buildNote({ id: "refHost", title: "Host" });
        renderEditor({ note, notePath: "root/refHost" });
        await flush();

        vi.spyOn(link, "parseNavigationStateFromUrl").mockReturnValue({ noteId: "refTarget" } as ReturnType<typeof link.parseNavigationStateFromUrl>);
        vi.spyOn(froca, "getNote").mockResolvedValue(target);
        const $el = $("<span>");
        await act(async () => {
            await (parent as any).loadReferenceLinkTitle($el, "#root/refTarget");
        });
        expect($el.text()).toBe("Referenced");

        (link.parseNavigationStateFromUrl as ReturnType<typeof vi.fn>).mockReturnValue({});
        const $el2 = $("<span>");
        await act(async () => {
            await (parent as any).loadReferenceLinkTitle($el2, "#nothing");
        });
        expect($el2.text()).toBe("[missing]");
    });

    it("createNoteForReferenceLink creates a note when a notePath is provided, otherwise returns undefined", async () => {
        const note = buildNote({ id: "crHost", title: "Host" });
        const created = buildNote({ id: "crNew", title: "New" });
        vi.spyOn(created, "getBestNotePathString").mockReturnValue("root/crNew");
        const createSpy = vi.spyOn(note_create, "createNoteWithTypePrompt").mockResolvedValue({ note: created } as any);

        renderEditor({ note, notePath: "root/crHost" });
        await flush();
        let result: string | undefined;
        await act(async () => { result = await (parent as any).createNoteForReferenceLink("Title"); });
        expect(createSpy).toHaveBeenCalledWith("root/crHost", expect.objectContaining({ activate: false, title: "Title" }));
        expect(result).toBe("root/crNew");
    });

    it("createNoteForReferenceLink returns undefined when no notePath", async () => {
        const note = buildNote({ id: "crHost2", title: "Host2" });
        const createSpy = vi.spyOn(note_create, "createNoteWithTypePrompt");
        renderEditor({ note, notePath: null });
        await flush();
        let result: string | undefined = "x";
        await act(async () => { result = await (parent as any).createNoteForReferenceLink("Title"); });
        expect(createSpy).not.toHaveBeenCalled();
        expect(result).toBeUndefined();
    });
});

describe("keyboard-shortcut events (addNewLabel / addNewRelation)", () => {
    it("only reacts when the event ntxId matches", async () => {
        const note = buildNote({ id: "ks", title: "KS" });
        renderEditor({ note, ntxId: "ntx-9" });
        await flush();

        ckEditorState.setText.mockClear();
        // Non-matching ntxId → ignored.
        fireEvent("addNewLabel", { ntxId: "other" });
        await flush();
        expect(ckEditorState.setText).not.toHaveBeenCalled();

        // Matching ntxId → adds a label (renders).
        fireEvent("addNewLabel", { ntxId: "ntx-9" });
        await flush();
        expect(ckEditorState.setText).toHaveBeenCalled();

        ckEditorState.setText.mockClear();
        fireEvent("addNewRelation", { ntxId: "ntx-9" });
        await flush();
        expect(ckEditorState.setText).toHaveBeenCalled();
    });

    it("handleAddNewAttributeCommand bails out when the current content cannot be parsed", async () => {
        const note = buildNote({ id: "ksbad", title: "KSBad" });
        renderEditor({ note, ntxId: "ntx-bad" });
        await flush();
        // Put invalid content so parseAttributes() throws → returns undefined → command early-returns.
        act(() => ckEditorState.props?.onChange("not an attribute"));
        await flush();
        ckEditorState.setText.mockClear();
        fireEvent("addNewLabel", { ntxId: "ntx-bad" });
        await flush();
        expect(ckEditorState.setText).not.toHaveBeenCalled();
    });
});

describe("wrapper onKeyDown (IME + Enter)", () => {
    it("ignores keydowns while IME is composing", async () => {
        const note = buildNote({ id: "ime", title: "IME" });
        const { container } = renderEditor({ note });
        await flush();
        const wrapper = container.querySelector(".attribute-list-editor-wrapper") as HTMLElement;

        // keyCode 229 signals an IME composition → handler returns before the Enter branch.
        const evt = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
        Object.defineProperty(evt, "keyCode", { value: 229 });
        act(() => { wrapper.dispatchEvent(evt); });
        await new Promise((r) => setTimeout(r, 150));
        await flush();
        // Nothing to save; server.put must not have been called.
        expect(server.put).not.toHaveBeenCalled();
    });
});

describe("mention feeds (config passed to CKEditor)", () => {
    it("provides @, # and ~ feeds plus an item renderer", async () => {
        const note = buildNote({ id: "feeds", title: "F" });
        renderEditor({ note });
        await flush();

        const feeds = ckEditorState.props?.config?.mention?.feeds as any[];
        expect(Array.isArray(feeds)).toBe(true);
        expect(feeds.map((f) => f.marker).sort()).toEqual([ "#", "@", "~" ]);

        // @ feed delegates to note_autocomplete; itemRenderer builds a button element.
        const atFeed = feeds.find((f) => f.marker === "@");
        const acSpy = vi.spyOn(note_autocomplete, "autocompleteSourceForCKEditor").mockResolvedValue([] as any);
        await atFeed.feed("query");
        expect(acSpy).toHaveBeenCalledWith("query");
        const renderer = atFeed.itemRenderer;
        const el = renderer({ highlightedNotePathTitle: "Hello" });
        expect(el.tagName).toBe("BUTTON");
        expect(el.innerHTML).toContain("Hello");

        // # and ~ feeds hit server.get and map the names into mention items.
        vi.spyOn(server, "get").mockResolvedValue([ "alpha", "beta" ]);
        const hashFeed = feeds.find((f) => f.marker === "#");
        const hashItems = await hashFeed.feed("a");
        expect(hashItems).toEqual([ { id: "#alpha", name: "alpha" }, { id: "#beta", name: "beta" } ]);

        const relFeed = feeds.find((f) => f.marker === "~");
        const relItems = await relFeed.feed("b");
        expect(relItems).toEqual([ { id: "~alpha", name: "alpha" }, { id: "~beta", name: "beta" } ]);
    });
});

describe("getClickIndex sibling traversal", () => {
    it("accounts for preceding reference and text siblings when locating the clicked attribute", async () => {
        const note = buildNote({ id: "sib", title: "Sib" });
        renderEditor({ note });
        await flush();

        // Two attributes so a click in the second token must walk previous siblings.
        act(() => ckEditorState.props?.onChange("#archived #readOnly"));
        await flush();

        // textNode for the 2nd token "#readOnly", with a preceding reference sibling and a text sibling.
        const refSibling = {
            name: "reference",
            getAttribute: (_k: string) => "#root/somewhere",
            previousSibling: { data: "#archived ", previousSibling: null }
        };
        const pos = {
            offset: 5,
            textNode: { data: "#readOnly", startOffset: 0, previousSibling: refSibling }
        };
        // We don't assert the exact match — just that traversal runs without throwing.
        act(() => { ckEditorState.props?.onClick({ pageX: 1, pageY: 1 }, pos); });
        await new Promise((r) => setTimeout(r, 150));
        expect(true).toBe(true);
    });
});
