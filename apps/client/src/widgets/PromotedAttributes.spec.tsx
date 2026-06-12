import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) ---------------------------------------------

// NoteAutocomplete pulls in jQuery autocomplete plugins and a top-level server.get; replace it with a
// trivial input that surfaces `noteIdChanged` so the RelationInput branch can be exercised.
vi.mock("./react/NoteAutocomplete", () => ({
    default: ({ id, noteId, noteIdChanged }: { id?: string; noteId?: string; noteIdChanged?: (v: string) => void; }) => {
        return (
            <input
                id={id}
                className="note-autocomplete-mock"
                data-note-id={noteId}
                onInput={(e) => noteIdChanged?.((e.target as HTMLInputElement).value)}
            />
        );
    }
}));

import FAttribute from "../entities/fattribute";
import type FNote from "../entities/fnote";
import froca from "../services/froca";
import noteAttributeCache from "../services/note_attribute_cache";
import server from "../services/server";
import ws from "../services/ws";
import { buildNote } from "../test/easy-froca";
import { fakeNoteContext, flush, makeLoadResults, renderHook, renderInto, resetFroca } from "../test/render";
import { NoteContextContext, ParentComponent } from "./react/react_utils";
import Component from "../components/component";
import PromotedAttributes, { PromotedAttributesContent, usePromotedAttributeData } from "./PromotedAttributes";

// --- Fixtures --------------------------------------------------------------------------------------

// jQuery's algolia `autocomplete` plugin is not loaded under happy-dom; stub it so the text-label
// autocomplete effect (and its cleanup `.autocomplete("destroy")`) does not throw. We also capture the
// dataset config so a test can drive the `source` callback. The stub stays installed for the whole file
// so it is still present when the shared render teardown unmounts components (and fires the cleanup).
const jqueryFns = $.fn as unknown as Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let capturedDatasets: any[] | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
jqueryFns.autocomplete = vi.fn(function (this: unknown, configOrCommand: unknown, datasets: any[]) {
    if (typeof configOrCommand !== "string") {
        capturedDatasets = datasets;
    }
    return this;
});

beforeEach(() => {
    resetFroca();
    vi.clearAllMocks();
    capturedDatasets = undefined;
    Object.assign(server, {
        put: vi.fn(async () => ({ attributeId: "newAttrId" })),
        get: vi.fn(async () => []),
        remove: vi.fn(async () => undefined)
    });
});

// --- usePromotedAttributeData ---------------------------------------------------------------------

describe("usePromotedAttributeData", () => {
    it("returns an empty list when there is no note", () => {
        const ctx = fakeNoteContext();
        const h = renderHook(() => usePromotedAttributeData(undefined, "cmp", ctx));
        expect(h.result.current[0]).toEqual([]);
    });

    it("returns an empty list for table viewType", () => {
        const note = buildNote({ id: "tableNote", title: "T", "#viewType": "table", "#label:foo": "promoted,text,single" });
        const ctx = fakeNoteContext();
        const h = renderHook(() => usePromotedAttributeData(note, "cmp", ctx));
        expect(h.result.current[0]).toEqual([]);
    });

    it("returns an empty list when the view mode is not default", () => {
        const note = buildNote({ id: "srcNote", title: "S", "#label:foo": "promoted,text,single" });
        const ctx = fakeNoteContext({ viewScope: { viewMode: "source" } });
        const h = renderHook(() => usePromotedAttributeData(note, "cmp", ctx));
        expect(h.result.current[0]).toEqual([]);
    });

    it("builds a single empty cell for a defined-but-unset label", () => {
        const note = buildNote({ id: "n1", title: "N", "#label:mood": "promoted,text,single" });
        const ctx = fakeNoteContext();
        const h = renderHook(() => usePromotedAttributeData(note, "cmp", ctx));
        const cells = h.result.current[0];
        expect(cells).toHaveLength(1);
        expect(cells?.[0].valueName).toBe("mood");
        expect(cells?.[0].valueAttr.value).toBe("");
        expect(cells?.[0].valueAttr.attributeId).toBe("");
    });

    it("uses an existing owned value for a single-multiplicity label", () => {
        const note = buildNote({ id: "n2", title: "N", "#label:mood": "promoted,text,single", "#mood": "happy" });
        const ctx = fakeNoteContext();
        const h = renderHook(() => usePromotedAttributeData(note, "cmp", ctx));
        const cells = h.result.current[0];
        expect(cells).toHaveLength(1);
        expect(cells?.[0].valueAttr.value).toBe("happy");
    });

    it("collapses multiple values to one for single multiplicity", () => {
        const note = buildNote({ id: "n3", title: "N", "#label:mood": "promoted,text,single" });
        // add two value attributes manually so there are several to collapse
        addLabel(note, "mood", "first");
        addLabel(note, "mood", "second");
        const ctx = fakeNoteContext();
        const h = renderHook(() => usePromotedAttributeData(note, "cmp", ctx));
        expect(h.result.current[0]).toHaveLength(1);
    });

    it("keeps all values for multi multiplicity", () => {
        const note = buildNote({ id: "n4", title: "N", "#label:tag": "promoted,text,multi" });
        addLabel(note, "tag", "a");
        addLabel(note, "tag", "b");
        const ctx = fakeNoteContext();
        const h = renderHook(() => usePromotedAttributeData(note, "cmp", ctx));
        expect(h.result.current[0]).toHaveLength(2);
    });

    it("forces a fresh attribute id when the value attribute is inherited from another note", () => {
        const note = buildNote({ id: "ownNote", title: "Owner", "#label:topic": "promoted,text,single" });
        // an attribute that owns to a *different* note id (inherited) → attributeId must be cleared
        const inherited = addLabel(note, "topic", "inheritedValue");
        Object.assign(inherited, { noteId: "someOtherNote" });
        const ctx = fakeNoteContext();
        const h = renderHook(() => usePromotedAttributeData(note, "cmp", ctx));
        expect(h.result.current[0]?.[0].valueAttr.attributeId).toBe("");
    });

    it("builds a relation cell", () => {
        buildNote({ id: "target1", title: "Target" });
        const note = buildNote({ id: "relParent", title: "N", "#relation:colleague": "promoted,single", "~colleague": "target1" });
        const ctx = fakeNoteContext();
        const h = renderHook(() => usePromotedAttributeData(note, "cmp", ctx));
        const cells = h.result.current[0];
        expect(cells).toHaveLength(1);
        expect(cells?.[0].valueAttr.type).toBe("relation");
        expect(cells?.[0].valueAttr.value).toBe("target1");
    });

    it("refreshes when an affecting attribute is reloaded", () => {
        const note = buildNote({ id: "refNote", title: "N", "#label:mood": "promoted,text,single" });
        const ctx = fakeNoteContext();
        const h = renderHook(() => usePromotedAttributeData(note, "cmp", ctx));
        expect(h.result.current[0]).toHaveLength(1);

        // a new promoted definition appears; firing entitiesReloaded with an affecting row triggers refresh
        addLabel(note, "mood", "set-now");
        h.fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({ attributeRows: [ { type: "label", name: "mood", value: "set-now", noteId: "refNote", isDeleted: false } ] })
        });
        expect(h.result.current[0]?.[0].valueAttr.value).toBe("set-now");
    });

    it("ignores entitiesReloaded that does not affect the note", () => {
        const note = buildNote({ id: "refNote2", title: "N", "#label:mood": "promoted,text,single" });
        const ctx = fakeNoteContext();
        const h = renderHook(() => usePromotedAttributeData(note, "cmp", ctx));
        const before = h.result.current[0];
        h.fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({ attributeRows: [ { type: "label", name: "mood", value: "x", noteId: "unknownNote", isDeleted: false } ] })
        });
        expect(h.result.current[0]).toBe(before);
    });
});

// --- PromotedAttributesContent (full component tree) ----------------------------------------------

describe("PromotedAttributesContent", () => {
    function buildCellsFor(note: FNote, componentId = "cmp", ctx = fakeNoteContext()) {
        const h = renderHook(() => usePromotedAttributeData(note, componentId, ctx));
        return h.result.current[0];
    }

    function renderContent(note: FNote, cells: ReturnType<typeof buildCellsFor>, componentId = "cmp") {
        return renderInto(
            <ParentComponent.Provider value={new Component()}>
                <PromotedAttributesContent note={note} componentId={componentId} cells={cells} setCells={vi.fn()} />
            </ParentComponent.Provider>
        );
    }

    it("renders nothing when there are no cells", () => {
        const note = buildNote({ id: "emptyNote", title: "N" });
        const root = renderContent(note, []);
        expect(root.querySelector(".promoted-attributes-container")).toBeNull();
    });

    it("renders a text label input with the alias label", () => {
        const note = buildNote({ id: "textNote", title: "N", "#label:mood": "promoted,text,single,alias=Mood Label" });
        const cells = buildCellsFor(note);
        const root = renderContent(note, cells);
        const input = root.querySelector("input.promoted-attribute-input") as HTMLInputElement | null;
        expect(input?.type).toBe("text");
        expect(root.querySelector("label")?.textContent).toBe("Mood Label");
    });

    it("renders a textarea for the textarea label type", () => {
        const note = buildNote({ id: "taNote", title: "N", "#label:notes": "promoted,textarea,single" });
        const cells = buildCellsFor(note);
        const root = renderContent(note, cells);
        expect(root.querySelector("textarea.promoted-attribute-input")).not.toBeNull();
    });

    it("renders a number input with a precision-derived step", () => {
        const note = buildNote({ id: "numNote", title: "N", "#label:rating": "promoted,number,single,precision=2" });
        const cells = buildCellsFor(note);
        const root = renderContent(note, cells);
        const input = root.querySelector("input.promoted-attribute-input") as HTMLInputElement | null;
        expect(input?.type).toBe("number");
        expect(input?.getAttribute("step")).toBe("0.01");
    });

    it("renders a url input with an open-external-link button", () => {
        const note = buildNote({ id: "urlNote", title: "N", "#label:homepage": "promoted,url,single", "#homepage": "https://example.com" });
        const cells = buildCellsFor(note);
        const root = renderContent(note, cells);
        const input = root.querySelector("input.promoted-attribute-input") as HTMLInputElement | null;
        expect(input?.type).toBe("url");
        const openBtn = root.querySelector(".open-external-link-button") as HTMLElement | null;
        expect(openBtn).not.toBeNull();

        const opened: string[] = [];
        const originalOpen = window.open;
        Object.assign(window, { open: (url: string) => { opened.push(url); return null; } });
        try {
            act(() => openBtn?.click());
            expect(opened).toEqual([ "https://example.com" ]);
        } finally {
            Object.assign(window, { open: originalOpen });
        }
    });

    it("renders a number input with the default step when no precision is given", () => {
        const note = buildNote({ id: "numNoPrec", title: "N", "#label:rating": "promoted,number,single" });
        const cells = buildCellsFor(note);
        const root = renderContent(note, cells);
        const input = root.querySelector("input.promoted-attribute-input") as HTMLInputElement | null;
        expect(input?.type).toBe("number");
        expect(input?.getAttribute("step")).toBe("1");
    });

    it("renders a boolean checkbox reflecting a true and a false value", () => {
        const trueNote = buildNote({ id: "boolNote", title: "N", "#label:done": "promoted,boolean,single", "#done": "true" });
        const trueRoot = renderContent(trueNote, buildCellsFor(trueNote));
        expect((trueRoot.querySelector("input[type=checkbox]") as HTMLInputElement | null)?.checked).toBe(true);
        // the boolean branch renders the alias label outside the cell <label for>
        expect(trueRoot.querySelector(".tn-checkbox")).not.toBeNull();

        const falseNote = buildNote({ id: "boolNote2", title: "N", "#label:done": "promoted,boolean,single" });
        const falseRoot = renderContent(falseNote, buildCellsFor(falseNote));
        expect((falseRoot.querySelector("input[type=checkbox]") as HTMLInputElement | null)?.checked).toBe(false);
    });

    it("renders the url open button as a no-op when the field is empty", () => {
        const note = buildNote({ id: "urlEmpty", title: "N", "#label:homepage": "promoted,url,single" });
        const root = renderContent(note, buildCellsFor(note));
        const openBtn = root.querySelector(".open-external-link-button") as HTMLElement | null;
        const opened: string[] = [];
        const originalOpen = window.open;
        Object.assign(window, { open: (url: string) => { opened.push(url); return null; } });
        try {
            act(() => openBtn?.click());
            expect(opened).toEqual([]);
        } finally {
            Object.assign(window, { open: originalOpen });
        }
    });

    it("falls back to the default color when the value is empty", () => {
        const note = buildNote({ id: "colorEmpty", title: "N", "#label:tint": "promoted,color,single" });
        const root = renderContent(note, buildCellsFor(note));
        const colorInput = root.querySelector("input[type=color]") as HTMLInputElement | null;
        expect(colorInput?.value).toBe("#ffffff");
    });

    it("renders a color input plus a reset button", () => {
        const note = buildNote({ id: "colorNote", title: "N", "#label:tint": "promoted,color,single", "#tint": "#ff0000" });
        const cells = buildCellsFor(note);
        const root = renderContent(note, cells);
        const colorInput = root.querySelector("input[type=color]") as HTMLInputElement | null;
        expect(colorInput?.value).toBe("#ff0000");
        // hidden input that backs the color value
        expect(root.querySelector("input[type=hidden]")).not.toBeNull();
    });

    it("renders a relation cell via NoteAutocomplete", () => {
        buildNote({ id: "relT", title: "T" });
        const note = buildNote({ id: "relCellNote", title: "N", "#relation:friend": "promoted,single", "~friend": "relT" });
        const cells = buildCellsFor(note);
        const root = renderContent(note, cells);
        const auto = root.querySelector(".note-autocomplete-mock") as HTMLInputElement | null;
        expect(auto?.getAttribute("data-note-id")).toBe("relT");
        expect(root.querySelector(".promoted-attribute-relation")).not.toBeNull();
    });

    it("renders multiplicity add/remove buttons for multi attributes", () => {
        const note = buildNote({ id: "multiNote", title: "N", "#label:tag": "promoted,text,multi" });
        const cells = buildCellsFor(note);
        const root = renderContent(note, cells);
        expect(root.querySelector(".multiplicity .bx-plus")).not.toBeNull();
        expect(root.querySelector(".multiplicity .bx-trash")).not.toBeNull();
    });
});

// --- Behaviour: updateAttribute through the inputs -------------------------------------------------

describe("PromotedAttributes input behaviour", () => {
    function setupCellComponent(note: FNote, componentId = "cmp") {
        const ctx = fakeNoteContext();
        const dataHook = renderHook(() => usePromotedAttributeData(note, componentId, ctx));
        const cells = dataHook.result.current[0];
        const setCells = vi.fn();
        const root = renderInto(
            <ParentComponent.Provider value={new Component()}>
                <PromotedAttributesContent note={note} componentId={componentId} cells={cells} setCells={setCells} />
            </ParentComponent.Provider>
        );
        return { root, setCells };
    }

    it("calls server.put on blur with a changed text value", async () => {
        const note = buildNote({ id: "putNote", title: "N", "#label:mood": "promoted,text,single" });
        const { root } = setupCellComponent(note);
        const input = root.querySelector("input.promoted-attribute-input") as HTMLInputElement;
        input.value = "changed";
        await act(async () => { input.dispatchEvent(new Event("focusout", { bubbles: true })); });
        await flush();
        expect(server.put).toHaveBeenCalledWith(
            "notes/putNote/attribute",
            expect.objectContaining({ name: "mood", value: "changed", type: "label" }),
            "cmp"
        );
    });

    it("does not call server.put when the value is unchanged", async () => {
        const note = buildNote({ id: "noChange", title: "N", "#label:mood": "promoted,text,single", "#mood": "same" });
        const { root } = setupCellComponent(note);
        const input = root.querySelector("input.promoted-attribute-input") as HTMLInputElement;
        // value already equals the model value
        await act(async () => { input.dispatchEvent(new Event("focusout", { bubbles: true })); });
        await flush();
        expect(server.put).not.toHaveBeenCalled();
    });

    it("serializes the checkbox state to true/false on blur", async () => {
        const note = buildNote({ id: "cbNote", title: "N", "#label:done": "promoted,boolean,single" });
        const { root } = setupCellComponent(note);
        const checkbox = root.querySelector("input[type=checkbox]") as HTMLInputElement;
        checkbox.checked = true;
        await act(async () => { checkbox.dispatchEvent(new Event("focusout", { bubbles: true })); });
        await flush();
        expect(server.put).toHaveBeenCalledWith(
            "notes/cbNote/attribute",
            expect.objectContaining({ value: "true" }),
            "cmp"
        );
    });

    it("clears the color through the reset button and persists an empty value", async () => {
        const note = buildNote({ id: "resetColor", title: "N", "#label:tint": "promoted,color,single", "#tint": "#abcdef" });
        const { root } = setupCellComponent(note);
        const resetBtn = root.querySelector(".bxs-tag-x") as HTMLElement;
        await act(async () => { resetBtn.click(); });
        await flush();
        expect(server.put).toHaveBeenCalledWith(
            "notes/resetColor/attribute",
            expect.objectContaining({ name: "tint", value: "" }),
            "cmp"
        );
    });

    it("updates the relation through NoteAutocomplete", async () => {
        buildNote({ id: "newTarget", title: "NT" });
        const note = buildNote({ id: "relUpd", title: "N", "#relation:friend": "promoted,single" });
        const { root } = setupCellComponent(note);
        const auto = root.querySelector(".note-autocomplete-mock") as HTMLInputElement;
        auto.value = "newTarget";
        await act(async () => { auto.dispatchEvent(new Event("input", { bubbles: true })); });
        await flush();
        expect(server.put).toHaveBeenCalledWith(
            "notes/relUpd/attribute",
            expect.objectContaining({ type: "relation", name: "friend", value: "newTarget" }),
            "cmp"
        );
    });

    it("applies the optimistic cell update produced by updateAttribute", async () => {
        const note = buildNote({ id: "updNote", title: "N", "#label:mood": "promoted,text,single" });
        const ctx = fakeNoteContext();
        const dataHook = renderHook(() => usePromotedAttributeData(note, "cmp", ctx));
        const cells = dataHook.result.current[0];
        const setCells = vi.fn();
        const root = renderInto(
            <ParentComponent.Provider value={new Component()}>
                <PromotedAttributesContent note={note} componentId="cmp" cells={cells} setCells={setCells} />
            </ParentComponent.Provider>
        );
        const input = root.querySelector("input.promoted-attribute-input") as HTMLInputElement;
        input.value = "newval";
        await act(async () => { input.dispatchEvent(new Event("focusout", { bubbles: true })); });
        await flush();

        // updateAttribute called setCells with a functional updater; run it to cover the mapping branch.
        const updater = setCells.mock.calls.at(-1)?.[0] as (prev: typeof cells) => typeof cells;
        const next = updater(cells);
        const updated = next?.find(c => c.uniqueId === cells?.[0].uniqueId);
        expect(updated?.valueAttr.value).toBe("newval");
        expect(updated?.valueAttr.attributeId).toBe("newAttrId");
        // The functional updater also tolerates an undefined previous state.
        expect(updater(undefined as never)).toBeUndefined();
        dataHook.unmount();
    });

    it("renders text-label autocomplete suggestions and reflects a selection in the draft", async () => {
        Object.assign(server, { get: vi.fn(async () => [ "alpha", "beta", "gamma" ]) });
        const note = buildNote({ id: "acNote", title: "N", "#label:mood": "promoted,text,single" });
        const { root } = setupCellComponent(note);
        await flush();

        // The autocomplete dataset's `source` callback should filter by the typed term.
        const source = capturedDatasets?.[0]?.source as ((term: string, cb: (rows: { value: string }[]) => void) => void) | undefined;
        expect(source).toBeTypeOf("function");
        let filtered: { value: string }[] = [];
        source?.("BET", (rows) => { filtered = rows; });
        expect(filtered.map(r => r.value)).toEqual([ "beta" ]);

        // Selecting a suggestion updates the controlled draft via setDraft (jQuery sets currentTarget).
        const input = root.querySelector("input.promoted-attribute-input") as HTMLInputElement;
        input.value = "chosen";
        await act(async () => { $(input).trigger("autocomplete:selected"); });
        expect(input.value).toBe("chosen");
    });

    it("logs an error for an unknown attribute type", () => {
        const note = buildNote({ id: "unkNote", title: "N" });
        const cells = [ {
            uniqueId: "u1",
            definitionAttr: { position: 0, getDefinition: () => ({}) } as never,
            definition: {},
            valueAttr: { attributeId: "", type: "weird", name: "x", value: "" },
            valueName: "x"
        } ] as never;
        renderInto(
            <ParentComponent.Provider value={new Component()}>
                <PromotedAttributesContent note={note} componentId="cmp" cells={cells} setCells={vi.fn()} />
            </ParentComponent.Provider>
        );
        expect(ws.logError).toHaveBeenCalled();
    });

    it("adds a new cell with the + button", async () => {
        const note = buildNote({ id: "addNote", title: "N", "#label:tag": "promoted,text,multi" });
        const { root, setCells } = setupCellComponent(note);
        const addBtn = root.querySelector(".multiplicity .bx-plus") as HTMLElement;
        await act(async () => { addBtn.click(); });
        expect(setCells).toHaveBeenCalled();
        const newCells = setCells.mock.calls[0][0] as unknown[];
        expect(newCells).toHaveLength(2);
    });

    it("removes a persisted attribute via the trash button, hitting the server", async () => {
        const note = buildNote({ id: "delNote", title: "N", "#label:tag": "promoted,text,multi", "#tag": "v" });
        const { root, setCells } = setupCellComponent(note);
        const trashBtn = root.querySelector(".multiplicity .bx-trash") as HTMLElement;
        await act(async () => { trashBtn.click(); });
        await flush();
        expect(server.remove).toHaveBeenCalled();
        expect(setCells).toHaveBeenCalled();
    });

    it("removes an unsaved attribute without contacting the server", async () => {
        const note = buildNote({ id: "delEmpty", title: "N", "#label:tag": "promoted,text,multi" });
        const { root, setCells } = setupCellComponent(note);
        const trashBtn = root.querySelector(".multiplicity .bx-trash") as HTMLElement;
        await act(async () => { trashBtn.click(); });
        await flush();
        expect(server.remove).not.toHaveBeenCalled();
        expect(setCells).toHaveBeenCalled();
    });
});

// --- Default export (top-level) -------------------------------------------------------------------

describe("PromotedAttributes (default export)", () => {
    it("renders cells driven from the note context", () => {
        const note = buildNote({ id: "topNote", title: "N", "#label:mood": "promoted,text,single" });
        const ctx = fakeNoteContext({ note, notePath: "root/topNote" });
        const root = renderInto(
            <ParentComponent.Provider value={new Component()}>
                <NoteContextContext.Provider value={ctx}>
                    <PromotedAttributes />
                </NoteContextContext.Provider>
            </ParentComponent.Provider>
        );
        expect(root.querySelector(".promoted-attributes-widget")).not.toBeNull();
        expect(root.querySelector("input.promoted-attribute-input")).not.toBeNull();
    });

    it("adds a fresh cell through the + button and focuses it", async () => {
        const note = buildNote({ id: "topMulti", title: "N", "#label:tag": "promoted,text,multi" });
        const ctx = fakeNoteContext({ note, notePath: "root/topMulti" });
        const root = renderInto(
            <ParentComponent.Provider value={new Component()}>
                <NoteContextContext.Provider value={ctx}>
                    <PromotedAttributes />
                </NoteContextContext.Provider>
            </ParentComponent.Provider>
        );
        expect(root.querySelectorAll("input.promoted-attribute-input")).toHaveLength(1);

        const addBtn = root.querySelector(".multiplicity .bx-plus") as HTMLElement;
        await act(async () => { addBtn.click(); });
        await flush();
        // a new cell was appended (which also exercises the shouldFocus effect on the focused cell)
        expect(root.querySelectorAll("input.promoted-attribute-input").length).toBeGreaterThan(1);
    });
});

// --- Helpers --------------------------------------------------------------------------------------

function addLabel(note: FNote, name: string, value: string) {
    return addAttribute(note, "label", name, value);
}

function addAttribute(note: FNote, type: "label" | "relation", name: string, value: string) {
    // mirror what easy-froca does, for additional value attributes beyond the buildNote definition
    const attributeId = `attr-${Math.random().toString(36).slice(2)}`;
    const attr = new FAttribute(froca, {
        noteId: note.noteId,
        attributeId,
        type,
        name,
        value,
        position: note.attributes.length,
        isInheritable: false
    });
    froca.attributes[attributeId] = attr;
    note.attributes.push(attributeId);
    if (!noteAttributeCache.attributes[note.noteId]) {
        noteAttributeCache.attributes[note.noteId] = [];
    }
    noteAttributeCache.attributes[note.noteId].push(attr);
    return attr;
}
