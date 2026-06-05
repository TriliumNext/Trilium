import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// Stub NoteAutocomplete so the relation cell renders a plain input + a button that fires noteIdChanged,
// avoiding the jQuery autocomplete plugin machinery.
vi.mock("./react/NoteAutocomplete", () => ({
    default: ({ id, noteId, noteIdChanged }: { id?: string; noteId?: string; noteIdChanged?: (v: string) => void }) => (
        <div className="note-autocomplete-stub">
            <input id={id} value={noteId} data-testid="relation-input" />
            <button
                type="button"
                className="relation-change"
                onClick={() => noteIdChanged?.("targetNoteX")}
            />
        </div>
    )
}));

import { DefinitionObject } from "@triliumnext/commons";

import Component from "../components/component";
import type NoteContext from "../components/note_context";
import FAttribute from "../entities/fattribute";
import FNote from "../entities/fnote";
import { Attribute } from "../services/attribute_parser";
import froca from "../services/froca";
import noteAttributeCache from "../services/note_attribute_cache";
import server from "../services/server";
import ws from "../services/ws";
import { buildNote } from "../test/easy-froca";
import { flush, makeLoadResults, renderHook } from "../test/render-hook";
import PromotedAttributes, { PromotedAttributesContent, usePromotedAttributeData } from "./PromotedAttributes";
import { ParentComponent } from "./react/react_utils";

// --- Rendering harness for full components --------------------------------------------------------

let container: HTMLDivElement | undefined;
let lastParent: Component | undefined;

function renderInto(vnode: preact.ComponentChild, parent = new Component()) {
    lastParent = parent;
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
        render((
            <ParentComponent.Provider value={parent}>
                {vnode}
            </ParentComponent.Provider>
        ), container);
    });
    return container;
}

function fakeNoteContext(overrides: Record<string, unknown> = {}): NoteContext {
    return {
        ntxId: "ntx1",
        viewScope: { viewMode: "default" },
        ...overrides
    } as unknown as NoteContext;
}

function clearFroca() {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    for (const key of Object.keys(noteAttributeCache.attributes)) delete noteAttributeCache.attributes[key];
}

beforeEach(() => {
    clearFroca();
    vi.clearAllMocks();
    // The auto-mock (test/setup.ts) only defines server.get/post — add the write verbs used here.
    Object.assign(server, {
        get: vi.fn(async () => [] as string[]),
        put: vi.fn(async () => ({ attributeId: "newAttrId" })),
        remove: vi.fn(async () => undefined)
    });
    Object.assign(ws, { logError: vi.fn() });
    // jQuery autocomplete plugin is not loaded in the test env; provide a no-op so the
    // text-label autocomplete effect never throws.
    ($.fn as Record<string, unknown>).autocomplete = vi.fn(function (this: unknown) { return this; });
});

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- Cell builders ------------------------------------------------------------------------------

/** Build a real FAttribute definition note via easy-froca and return its definition attribute. */
function makeDefinitionAttr(defName: string, defValue: string): FAttribute {
    const note = buildNote({ title: "def", [`#${defName}`]: defValue } as never);
    const defs = note.getAttributeDefinitions();
    const def = defs.find((d) => d.name === defName);
    if (!def) throw new Error(`definition attribute ${defName} not built`);
    return def;
}

function makeCell(partial: {
    definition: DefinitionObject;
    valueAttr: Attribute;
    valueName: string;
    definitionAttr?: FAttribute;
    uniqueId?: string;
}) {
    const definitionAttr = partial.definitionAttr ?? makeDefinitionAttr(
        `${partial.valueAttr.type}:${partial.valueName}`,
        "promoted"
    );
    return {
        uniqueId: partial.uniqueId ?? `cell-${partial.valueName}-${Math.random().toString(36).slice(2)}`,
        definitionAttr,
        definition: partial.definition,
        valueAttr: partial.valueAttr,
        valueName: partial.valueName
    };
}

// =================================================================================================
// usePromotedAttributeData
// =================================================================================================

describe("usePromotedAttributeData", () => {
    it("returns empty cells when there is no note", async () => {
        const h = renderHook(() => usePromotedAttributeData(null, "cmp", fakeNoteContext()));
        await flush();
        expect(h.result.current[0]).toEqual([]);
    });

    it("returns empty cells when viewType is table", async () => {
        const note = buildNote({
            title: "tableNote",
            "#viewType": "table",
            "#label:foo": "promoted,text"
        });
        const h = renderHook(() => usePromotedAttributeData(note, "cmp", fakeNoteContext()));
        await flush();
        expect(h.result.current[0]).toEqual([]);
    });

    it("returns empty cells when the view mode is not the default", async () => {
        const note = buildNote({ title: "n", "#label:foo": "promoted,text" });
        const ctx = fakeNoteContext({ viewScope: { viewMode: "attachments" } });
        const h = renderHook(() => usePromotedAttributeData(note, "cmp", ctx));
        await flush();
        expect(h.result.current[0]).toEqual([]);
    });

    it("builds one cell per promoted definition, with an empty placeholder when no value exists", async () => {
        const note = buildNote({
            title: "n",
            "#label:foo": "promoted,text,single"
        });
        const h = renderHook(() => usePromotedAttributeData(note, "cmp", fakeNoteContext()));
        await flush();
        const cells = h.result.current[0] ?? [];
        expect(cells).toHaveLength(1);
        expect(cells[0]?.valueName).toBe("foo");
        expect(cells[0]?.valueAttr.value).toBe("");
        expect(cells[0]?.valueAttr.attributeId).toBe("");
    });

    it("uses the owned attribute value and reflects multi multiplicity (one cell per value)", async () => {
        const note = buildNote({
            id: "multiNote",
            title: "n",
            "#label:tag": "promoted,text,multi",
            "#tag": "first"
        });
        // add a second owned value for the same label so the multi branch yields two cells
        const secondId = "second-attr";
        const second = new FAttribute(froca, {
            attributeId: secondId,
            noteId: "multiNote",
            type: "label",
            name: "tag",
            value: "second",
            position: 50,
            isInheritable: false
        });
        froca.attributes[secondId] = second;
        note.attributes.push(secondId);
        noteAttributeCache.attributes["multiNote"]?.push(second);

        const h = renderHook(() => usePromotedAttributeData(note, "cmp", fakeNoteContext()));
        await flush();
        const cells = h.result.current[0] ?? [];
        const tagCells = cells.filter((c) => c.valueName === "tag");
        expect(tagCells.map((c) => c.valueAttr.value).sort()).toEqual(["first", "second"]);
    });

    it("keeps only the first value when multiplicity is single", async () => {
        const note = buildNote({
            id: "singleNote",
            title: "n",
            "#label:mood": "promoted,text,single",
            "#mood": "happy"
        });
        const dupId = "dup-attr";
        const dup = new FAttribute(froca, {
            attributeId: dupId,
            noteId: "singleNote",
            type: "label",
            name: "mood",
            value: "sad",
            position: 99,
            isInheritable: false
        });
        froca.attributes[dupId] = dup;
        note.attributes.push(dupId);
        noteAttributeCache.attributes["singleNote"]?.push(dup);

        const h = renderHook(() => usePromotedAttributeData(note, "cmp", fakeNoteContext()));
        await flush();
        const moodCells = (h.result.current[0] ?? []).filter((c) => c.valueName === "mood");
        expect(moodCells).toHaveLength(1);
        expect(moodCells[0]?.valueAttr.value).toBe("happy");
    });

    it("forces a new attribute (clears attributeId) when the value is inherited from another note", async () => {
        // Parent owns an inheritable promoted definition + value; child inherits both.
        const parent = buildNote({
            id: "parentInh",
            title: "parent",
            "#label:proj(inheritable)": "promoted,text,single",
            "#proj(inheritable)": "inheritedValue"
        });
        const child = buildNote({ id: "childInh", title: "child" });
        const branchId = "br-parent-child";
        const FBranch = (await import("../entities/fbranch")).default;
        froca.branches[branchId] = new FBranch(froca, {
            branchId,
            noteId: "childInh",
            parentNoteId: "parentInh",
            notePosition: 0,
            fromSearchNote: false
        });
        parent.addChild("childInh", branchId, false);
        child.addParent("parentInh", branchId, false);
        delete noteAttributeCache.attributes["childInh"];

        const h = renderHook(() => usePromotedAttributeData(child, "cmp", fakeNoteContext()));
        await flush();
        const projCells = (h.result.current[0] ?? []).filter((c) => c.valueName === "proj");
        expect(projCells.length).toBeGreaterThanOrEqual(1);
        // inherited value retained, but attributeId cleared so save creates a new owned attribute
        expect(projCells[0]?.valueAttr.value).toBe("inheritedValue");
        expect(projCells[0]?.valueAttr.attributeId).toBe("");
    });

    it("refreshes when an affecting attribute row arrives via entitiesReloaded", async () => {
        const note = buildNote({ id: "evtNote", title: "n", "#label:foo": "promoted,text" });
        const h = renderHook(() => usePromotedAttributeData(note, "cmp", fakeNoteContext()));
        await flush();
        const setterSpy = vi.spyOn(note, "getOwnedAttributes");

        h.fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({
                attributeRows: [{ type: "label", name: "foo", value: "x", noteId: "evtNote", isDeleted: false, isInheritable: false }]
            })
        });
        await flush();
        expect(setterSpy).toHaveBeenCalled();
    });

    it("does not refresh when the reloaded attribute does not affect the note", async () => {
        const note = buildNote({ id: "noEvtNote", title: "n", "#label:foo": "promoted,text" });
        const h = renderHook(() => usePromotedAttributeData(note, "cmp", fakeNoteContext()));
        await flush();
        const before = h.result.current[0];
        h.fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({
                attributeRows: [{ type: "label", name: "foo", value: "x", noteId: "someUncachedNote", isDeleted: false, isInheritable: false }]
            })
        });
        await flush();
        // identity unchanged -> refresh not run
        expect(h.result.current[0]).toBe(before);
    });
});

// =================================================================================================
// PromotedAttributesContent + cells
// =================================================================================================

describe("PromotedAttributesContent", () => {
    it("renders nothing inside the container when there are no cells", () => {
        const el = renderInto(
            <PromotedAttributesContent note={undefined} componentId="cmp" cells={[]} setCells={() => {}} />
        );
        expect(el.querySelector(".promoted-attributes-widget")).toBeTruthy();
        expect(el.querySelector(".promoted-attributes-container")).toBeNull();
    });

    it("renders a text label cell with a label element and input wired to data-attributes", () => {
        const note = buildNote({ id: "tn", title: "n" });
        const cell = makeCell({
            definition: { labelType: "text", multiplicity: "single" },
            valueAttr: { attributeId: "a1", type: "label", name: "foo", value: "hello", noteId: "tn" },
            valueName: "foo"
        });
        const el = renderInto(
            <PromotedAttributesContent note={note} componentId="cmp" cells={[cell]} setCells={() => {}} />
        );
        const input = el.querySelector("input.promoted-attribute-input") as HTMLInputElement | null;
        expect(input).toBeTruthy();
        expect(input?.getAttribute("data-attribute-name")).toBe("foo");
        expect(input?.getAttribute("data-attribute-type")).toBe("label");
        expect(input?.getAttribute("data-attribute-id")).toBe("a1");
        expect(el.querySelector("label")).toBeTruthy();
        expect(el.querySelector(".promoted-attribute-label-text")).toBeTruthy();
    });

    it("renders a textarea for the textarea label type", () => {
        const note = buildNote({ id: "tn2", title: "n" });
        const cell = makeCell({
            definition: { labelType: "textarea", multiplicity: "single" },
            valueAttr: { attributeId: "", type: "label", name: "notes", value: "", noteId: "tn2" },
            valueName: "notes"
        });
        const el = renderInto(
            <PromotedAttributesContent note={note} componentId="cmp" cells={[cell]} setCells={() => {}} />
        );
        expect(el.querySelector("textarea.promoted-attribute-input")).toBeTruthy();
    });

    it("applies a step derived from numberPrecision for number labels", () => {
        const note = buildNote({ id: "tn3", title: "n" });
        const cell = makeCell({
            definition: { labelType: "number", multiplicity: "single", numberPrecision: 2 },
            valueAttr: { attributeId: "", type: "label", name: "count", value: "1", noteId: "tn3" },
            valueName: "count"
        });
        const el = renderInto(
            <PromotedAttributesContent note={note} componentId="cmp" cells={[cell]} setCells={() => {}} />
        );
        const input = el.querySelector("input[type=number]") as HTMLInputElement | null;
        expect(input?.getAttribute("step")).toBe("0.01");
    });

    it("renders a url label with the external-link button which opens a new window", () => {
        const note = buildNote({ id: "tn4", title: "n" });
        const cell = makeCell({
            definition: { labelType: "url", multiplicity: "single" },
            valueAttr: { attributeId: "", type: "label", name: "link", value: "https://example.com", noteId: "tn4" },
            valueName: "link"
        });
        const el = renderInto(
            <PromotedAttributesContent note={note} componentId="cmp" cells={[cell]} setCells={() => {}} />
        );
        const input = el.querySelector("input[type=url]") as HTMLInputElement | null;
        expect(input).toBeTruthy();
        if (input) input.value = "https://opened.example";
        const openBtn = el.querySelector(".open-external-link-button") as HTMLElement | null;
        expect(openBtn).toBeTruthy();
        const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
        act(() => openBtn?.click());
        expect(openSpy).toHaveBeenCalledWith("https://opened.example", "_blank");
    });

    it("does not open a window for a url label when the value is empty", () => {
        const note = buildNote({ id: "tn4b", title: "n" });
        const cell = makeCell({
            definition: { labelType: "url", multiplicity: "single" },
            valueAttr: { attributeId: "", type: "label", name: "link", value: "", noteId: "tn4b" },
            valueName: "link"
        });
        const el = renderInto(
            <PromotedAttributesContent note={note} componentId="cmp" cells={[cell]} setCells={() => {}} />
        );
        const input = el.querySelector("input[type=url]") as HTMLInputElement | null;
        if (input) input.value = "";
        const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
        act(() => (el.querySelector(".open-external-link-button") as HTMLElement | null)?.click());
        expect(openSpy).not.toHaveBeenCalled();
    });

    it("renders a boolean label as a checkbox (checked when value is true) without an outer label", () => {
        const note = buildNote({ id: "tn5", title: "n" });
        const cell = makeCell({
            definition: { labelType: "boolean", multiplicity: "single" },
            valueAttr: { attributeId: "", type: "label", name: "done", value: "true", noteId: "tn5" },
            valueName: "done"
        });
        const el = renderInto(
            <PromotedAttributesContent note={note} componentId="cmp" cells={[cell]} setCells={() => {}} />
        );
        const checkbox = el.querySelector("input[type=checkbox]") as HTMLInputElement | null;
        expect(checkbox?.checked).toBe(true);
        expect(el.querySelector(".tn-checkbox")).toBeTruthy();
    });

    it("renders a color label with the hidden input and the reset button", () => {
        const note = buildNote({ id: "tn6", title: "n" });
        const cell = makeCell({
            definition: { labelType: "color", multiplicity: "single" },
            valueAttr: { attributeId: "", type: "label", name: "shade", value: "#112233", noteId: "tn6" },
            valueName: "shade"
        });
        const el = renderInto(
            <PromotedAttributesContent note={note} componentId="cmp" cells={[cell]} setCells={() => {}} />
        );
        expect(el.querySelector("input[type=color]")).toBeTruthy();
        expect(el.querySelector("input[type=hidden]")).toBeTruthy();
        expect(el.querySelector(".bxs-tag-x")).toBeTruthy();
    });

    it("renders a relation cell using the (stubbed) NoteAutocomplete", () => {
        const note = buildNote({ id: "tn7", title: "n" });
        const cell = makeCell({
            definition: { multiplicity: "single" },
            valueAttr: { attributeId: "", type: "relation", name: "target", value: "", noteId: "tn7" },
            valueName: "target",
            definitionAttr: makeDefinitionAttr("relation:target", "promoted")
        });
        const el = renderInto(
            <PromotedAttributesContent note={note} componentId="cmp" cells={[cell]} setCells={() => {}} />
        );
        expect(el.querySelector(".promoted-attribute-relation")).toBeTruthy();
        expect(el.querySelector(".note-autocomplete-stub")).toBeTruthy();
    });

    it("logs an error for an unknown attribute type", () => {
        const note = buildNote({ id: "tn8", title: "n" });
        const cell = makeCell({
            definition: { multiplicity: "single" },
            // deliberately invalid type to hit the default switch branch
            valueAttr: { attributeId: "", type: "bogus" as never, name: "x", value: "", noteId: "tn8" },
            valueName: "x"
        });
        renderInto(
            <PromotedAttributesContent note={note} componentId="cmp" cells={[cell]} setCells={() => {}} />
        );
        expect(ws.logError).toHaveBeenCalled();
    });

    it("uses promotedAlias as the label text when defined", () => {
        const note = buildNote({ id: "tn9", title: "n" });
        const cell = makeCell({
            definition: { labelType: "text", multiplicity: "single", promotedAlias: "Pretty Name" },
            valueAttr: { attributeId: "", type: "label", name: "raw", value: "", noteId: "tn9" },
            valueName: "raw"
        });
        const el = renderInto(
            <PromotedAttributesContent note={note} componentId="cmp" cells={[cell]} setCells={() => {}} />
        );
        const label = el.querySelector("label");
        expect(label?.textContent).toBe("Pretty Name");
    });
});

// =================================================================================================
// Interaction: updateAttribute via onBlur / onChange
// =================================================================================================

describe("updateAttribute interactions", () => {
    it("calls server.put with the new value on blur of a text label and updates the cell", async () => {
        const note = buildNote({ id: "up1", title: "n" });
        let cells = [makeCell({
            definition: { labelType: "text", multiplicity: "single" },
            valueAttr: { attributeId: "", type: "label", name: "foo", value: "old", noteId: "up1" },
            valueName: "foo",
            uniqueId: "cell-up1"
        })];
        const setCells = vi.fn((updater: unknown) => {
            cells = typeof updater === "function" ? (updater as (p: typeof cells) => typeof cells)(cells) : (updater as typeof cells);
        });
        const el = renderInto(
            <PromotedAttributesContent note={note} componentId="cmp" cells={cells} setCells={setCells} />
        );
        const input = el.querySelector("input.promoted-attribute-input") as HTMLInputElement | null;
        if (input) {
            input.value = "newval";
            await act(async () => {
                input.dispatchEvent(new Event("focusout", { bubbles: true }));
                await new Promise((r) => setTimeout(r, 0));
            });
        }
        expect(server.put).toHaveBeenCalledWith(
            "notes/up1/attribute",
            expect.objectContaining({ name: "foo", value: "newval", type: "label" }),
            "cmp"
        );
    });

    it("does NOT call server.put when the value is unchanged", async () => {
        const note = buildNote({ id: "up2", title: "n" });
        const cell = makeCell({
            definition: { labelType: "text", multiplicity: "single" },
            valueAttr: { attributeId: "", type: "label", name: "foo", value: "same", noteId: "up2" },
            valueName: "foo"
        });
        const el = renderInto(
            <PromotedAttributesContent note={note} componentId="cmp" cells={[cell]} setCells={() => {}} />
        );
        const input = el.querySelector("input.promoted-attribute-input") as HTMLInputElement | null;
        if (input) {
            input.value = "same";
            await act(async () => {
                input.dispatchEvent(new Event("focusout", { bubbles: true }));
                await new Promise((r) => setTimeout(r, 0));
            });
        }
        expect(server.put).not.toHaveBeenCalled();
    });

    it("serialises a boolean checkbox to 'true'/'false' on blur", async () => {
        const note = buildNote({ id: "up3", title: "n" });
        const cell = makeCell({
            definition: { labelType: "boolean", multiplicity: "single" },
            valueAttr: { attributeId: "", type: "label", name: "done", value: "false", noteId: "up3" },
            valueName: "done"
        });
        const el = renderInto(
            <PromotedAttributesContent note={note} componentId="cmp" cells={[cell]} setCells={() => {}} />
        );
        const checkbox = el.querySelector("input[type=checkbox]") as HTMLInputElement | null;
        if (checkbox) {
            checkbox.checked = true;
            await act(async () => {
                checkbox.dispatchEvent(new Event("focusout", { bubbles: true }));
                await new Promise((r) => setTimeout(r, 0));
            });
        }
        expect(server.put).toHaveBeenCalledWith(
            "notes/up3/attribute",
            expect.objectContaining({ name: "done", value: "true" }),
            "cmp"
        );
    });

    it("clears the color via the reset button which triggers an empty-value update", async () => {
        const note = buildNote({ id: "up4", title: "n" });
        const cell = makeCell({
            definition: { labelType: "color", multiplicity: "single" },
            valueAttr: { attributeId: "ca", type: "label", name: "shade", value: "#abcdef", noteId: "up4" },
            valueName: "shade"
        });
        const el = renderInto(
            <PromotedAttributesContent note={note} componentId="cmp" cells={[cell]} setCells={() => {}} />
        );
        const resetBtn = el.querySelector(".bxs-tag-x") as HTMLElement | null;
        await act(async () => {
            resetBtn?.click();
            await new Promise((r) => setTimeout(r, 0));
        });
        expect(server.put).toHaveBeenCalledWith(
            "notes/up4/attribute",
            expect.objectContaining({ name: "shade", value: "" }),
            "cmp"
        );
    });

    it("relation change fires updateAttribute through the stubbed autocomplete button", async () => {
        const note = buildNote({ id: "up5", title: "n" });
        const cell = makeCell({
            definition: { multiplicity: "single" },
            valueAttr: { attributeId: "", type: "relation", name: "target", value: "", noteId: "up5" },
            valueName: "target",
            definitionAttr: makeDefinitionAttr("relation:target", "promoted")
        });
        const el = renderInto(
            <PromotedAttributesContent note={note} componentId="cmp" cells={[cell]} setCells={() => {}} />
        );
        const changeBtn = el.querySelector(".relation-change") as HTMLElement | null;
        await act(async () => {
            changeBtn?.click();
            await new Promise((r) => setTimeout(r, 0));
        });
        expect(server.put).toHaveBeenCalledWith(
            "notes/up5/attribute",
            expect.objectContaining({ name: "target", type: "relation", value: "targetNoteX" }),
            "cmp"
        );
    });
});

// =================================================================================================
// MultiplicityCell add / remove buttons
// =================================================================================================

describe("MultiplicityCell", () => {
    it("renders add/remove buttons only for multi multiplicity", () => {
        const note = buildNote({ id: "mc0", title: "n" });
        const single = makeCell({
            definition: { labelType: "text", multiplicity: "single" },
            valueAttr: { attributeId: "", type: "label", name: "foo", value: "", noteId: "mc0" },
            valueName: "foo"
        });
        const el = renderInto(
            <PromotedAttributesContent note={note} componentId="cmp" cells={[single]} setCells={() => {}} />
        );
        expect(el.querySelector(".multiplicity")).toBeNull();
    });

    it("adds a new empty cell after the current one when '+' is clicked", () => {
        const note = buildNote({ id: "mc1", title: "n" });
        let cells = [makeCell({
            definition: { labelType: "text", multiplicity: "multi" },
            valueAttr: { attributeId: "a", type: "label", name: "tag", value: "v", noteId: "mc1" },
            valueName: "tag",
            uniqueId: "mc1-cell"
        })];
        const setCells = vi.fn((updater: unknown) => {
            cells = typeof updater === "function" ? (updater as (p: typeof cells) => typeof cells)(cells) : (updater as typeof cells);
        });
        const el = renderInto(
            <PromotedAttributesContent note={note} componentId="cmp" cells={cells} setCells={setCells} />
        );
        const addBtn = el.querySelector(".bx-plus") as HTMLElement | null;
        act(() => addBtn?.click());
        expect(setCells).toHaveBeenCalled();
        expect(cells).toHaveLength(2);
        expect(cells[1]?.valueAttr.value).toBe("");
        expect(cells[1]?.valueAttr.attributeId).toBe("");
    });

    it("removes the attribute on the server and reinserts an empty cell when it was the last of its type", async () => {
        const note = buildNote({ id: "mc2", title: "n" });
        let cells = [makeCell({
            definition: { labelType: "text", multiplicity: "multi" },
            valueAttr: { attributeId: "existingAttr", type: "label", name: "tag", value: "v", noteId: "mc2" },
            valueName: "tag",
            uniqueId: "mc2-cell"
        })];
        const setCells = vi.fn((updater: unknown) => {
            cells = typeof updater === "function" ? (updater as (p: typeof cells) => typeof cells)(cells) : (updater as typeof cells);
        });
        const el = renderInto(
            <PromotedAttributesContent note={note} componentId="cmp" cells={cells} setCells={setCells} />
        );
        const removeBtn = el.querySelector(".bx-trash") as HTMLElement | null;
        await act(async () => {
            removeBtn?.click();
            await new Promise((r) => setTimeout(r, 0));
        });
        expect(server.remove).toHaveBeenCalledWith("notes/mc2/attributes/existingAttr", "cmp");
        // last of its type -> replaced with a single empty cell, not removed entirely
        expect(cells).toHaveLength(1);
        expect(cells[0]?.valueAttr.value).toBe("");
        expect(cells[0]?.valueAttr.attributeId).toBe("");
    });

    it("removes only the clicked cell when other values of the same type remain", async () => {
        const note = buildNote({ id: "mc3", title: "n" });
        let cells = [
            makeCell({
                definition: { labelType: "text", multiplicity: "multi" },
                valueAttr: { attributeId: "", type: "label", name: "tag", value: "a", noteId: "mc3" },
                valueName: "tag",
                uniqueId: "mc3-a"
            }),
            makeCell({
                definition: { labelType: "text", multiplicity: "multi" },
                valueAttr: { attributeId: "", type: "label", name: "tag", value: "b", noteId: "mc3" },
                valueName: "tag",
                uniqueId: "mc3-b"
            })
        ];
        const setCells = vi.fn((updater: unknown) => {
            cells = typeof updater === "function" ? (updater as (p: typeof cells) => typeof cells)(cells) : (updater as typeof cells);
        });
        const el = renderInto(
            <PromotedAttributesContent note={note} componentId="cmp" cells={cells} setCells={setCells} />
        );
        const removeBtns = el.querySelectorAll(".bx-trash");
        await act(async () => {
            (removeBtns[0] as HTMLElement | undefined)?.click();
            await new Promise((r) => setTimeout(r, 0));
        });
        // no attributeId -> server.remove skipped; other value still present so no empty insert
        expect(server.remove).not.toHaveBeenCalled();
        expect(cells).toHaveLength(1);
        expect(cells[0]?.valueAttr.value).toBe("b");
    });
});

// =================================================================================================
// Default export (full pipeline through useNoteContext)
// =================================================================================================

describe("PromotedAttributes (default export)", () => {
    it("renders cells end-to-end from the note context", async () => {
        const note = buildNote({
            id: "ee1",
            title: "n",
            "#label:foo": "promoted,text,single",
            "#foo": "bar"
        });
        const ctx = fakeNoteContext({ note, notePath: "root/ee1", viewScope: { viewMode: "default" } });
        const parent = new Component();
        // useNoteContext reads parent.componentId; ensure it exists.
        expect(parent.componentId).toBeTruthy();

        container = document.createElement("div");
        document.body.appendChild(container);
        const { NoteContextContext } = await import("./react/react_utils");
        await act(async () => {
            render((
                <ParentComponent.Provider value={parent}>
                    <NoteContextContext.Provider value={ctx}>
                        <PromotedAttributes />
                    </NoteContextContext.Provider>
                </ParentComponent.Provider>
            ), container);
            await new Promise((r) => setTimeout(r, 0));
        });
        const input = container.querySelector("input.promoted-attribute-input") as HTMLInputElement | null;
        expect(input?.getAttribute("data-attribute-name")).toBe("foo");
        expect(input?.value).toBe("bar");
    });
});
