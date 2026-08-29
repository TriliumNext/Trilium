import { DefinitionObject } from "@triliumnext/commons";
import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A relation's target is picked in an Algolia autocomplete bound to jQuery, which is not loaded
// here; a plain input in its place keeps the cell around it assertable.
vi.mock("./react/NoteAutocomplete", () => ({
    default: ({ id, noteId }: { id?: string; noteId?: string }) =>
        <input id={id} className="note-autocomplete-stub" value={noteId} />
}));

// The chip fields have specs of their own; here they hand over their props, which is where the
// grid's behaviour lives — what the field is given, and what committing through it does.
const multiInput = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("./attribute_widgets/multi_value_input", () => ({
    default: (props: Record<string, unknown>) => {
        multiInput.current = props;
        return null;
    },
    BOOLEAN_OPTIONS: [ "true", "false" ]
}));
const relationInput = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("./attribute_widgets/relation_values_input", () => ({
    default: (props: Record<string, unknown>) => {
        relationInput.current = props;
        return null;
    },
    RelationValueChips: () => null
}));

// The grid follows the note the tab shows; the tests hand it one directly. The context object is
// held stable: the grid rebuilds its cells when the context changes, told apart by identity.
const shownNote = vi.hoisted(() => ({ current: null as FNote | null }));
const noteContext = vi.hoisted(() => ({ viewScope: { viewMode: "default" } }));
vi.mock("./react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./react/hooks")>()),
    useNoteContext: () => ({
        note: shownNote.current,
        componentId: "cid",
        noteContext
    })
}));

// Keep the global setup.ts websocket mock (subscribeToMessages et al.) and only add logError,
// which the unknown-attribute-type branch reports through.
const logErrorMock = vi.hoisted(() => vi.fn());
vi.mock("../services/ws", async (importOriginal) => {
    const original = await importOriginal<{ default: object }>();
    return {
        ...original,
        default: { ...original.default, logError: (...args: unknown[]) => logErrorMock(...args) }
    };
});

import $ from "jquery";

import type Component from "../components/component";
import FAttribute from "../entities/fattribute";
import type FNote from "../entities/fnote";
import froca from "../services/froca";
import type LoadResults from "../services/load_results";
import noteAttributeCache from "../services/note_attribute_cache";
import server from "../services/server";
import { randomString } from "../services/utils";
import { buildNote } from "../test/easy-froca";
import { renderInto } from "../test/render";
import { ParentComponent } from "./react/react_utils";
import PromotedAttributes, { buildPromotedCells, PromotedAttributesContent, usePromotedAttributeData } from "./PromotedAttributes";

// A text field offers the values other notes hold under its name through the Algolia plugin, which
// is not loaded here; a stub that chains like jQuery does keeps the field's setup on its feet.
type PluggedIn = { autocomplete(...args: unknown[]): PluggedIn };
const autocompleteMock = vi.fn(function (this: PluggedIn) { return this; });
($.fn as unknown as PluggedIn).autocomplete = autocompleteMock;

// The fields reach the server through these three; every suite stands them down, and the ones
// asserting on what was written reach for these same handles.
const serverGetMock = vi.fn(async () => [] as string[]);
const serverPutMock = vi.fn(async () => ({ attributeId: "newAttributeId" }));
const serverRemoveMock = vi.fn(async () => undefined);
server.get = serverGetMock as unknown as typeof server.get;
server.put = serverPutMock as unknown as typeof server.put;
server.remove = serverRemoveMock as unknown as typeof server.remove;

describe("buildPromotedCells", () => {
    it("gathers a label allowing several values into one field, leaving a single-valued one its own", () => {
        const note = buildNote({
            title: "Task",
            "#label:tags": "promoted,multi,text",
            "#label:status": "promoted,single,text",
            "#tags": "alpha",
            "#status": "open"
        });
        hold(note, "label", "tags", "beta");

        const cells = buildPromotedCells(note);

        // One field per definition, in the order the definitions are declared.
        expect(cells.map((cell) => cell.valueName)).toEqual([ "tags", "status" ]);
        // The set as it will be shown: chips in the one field, not a field apiece.
        expect(cells[0].values).toEqual([ "alpha", "beta" ]);
        // A single value is still edited through the very attribute holding it, so that typing into
        // the field updates that attribute rather than rewriting everything under the name.
        expect(cells[1].values).toBeUndefined();
        expect(cells[1].valueAttr.value).toBe("open");
    });

    it("shows the values in the order the note holds them, whichever order they were loaded in", () => {
        const note = buildNote({ title: "Task", "#label:tags": "promoted,multi,text" });
        hold(note, "label", "tags", "second", 20);
        hold(note, "label", "tags", "first", 10);

        expect(buildPromotedCells(note)[0].values).toEqual([ "first", "second" ]);
    });

    it("offers an empty field where the note holds nothing under the name", () => {
        const note = buildNote({ title: "Task", "#label:tags": "promoted,multi,text" });

        const [ cell ] = buildPromotedCells(note);

        // A blank value among the chips would be a chip standing for nothing, whose remove button
        // would remove nothing; the field simply opens with none.
        expect(cell.values).toEqual([]);
        expect(cell.valueAttr).toMatchObject({ attributeId: "", type: "label", name: "tags" });
    });

    it("leaves a value stored empty out of the chips", () => {
        // A definition retyped from single to multi can leave one behind, as can an attribute created
        // and never filled in.
        const note = buildNote({ title: "Task", "#label:tags": "promoted,multi,text", "#tags": "" });
        hold(note, "label", "tags", "alpha");

        expect(buildPromotedCells(note)[0].values).toEqual([ "alpha" ]);
    });

    it("gathers a relation's targets into one field, as it gathers a label's values", () => {
        const note = buildNote({
            title: "Task",
            "#relation:related": "promoted,multi",
            "~related": "aaaaaaaaaaaa"
        });
        hold(note, "relation", "related", "bbbbbbbbbbbb");

        const cells = buildPromotedCells(note);

        expect(cells).toHaveLength(1);
        // The chips carry the targets' noteIds; naming the notes they point at is the field's affair.
        expect(cells[0].values).toEqual([ "aaaaaaaaaaaa", "bbbbbbbbbbbb" ]);
        expect(cells[0].valueAttr).toMatchObject({ attributeId: "", type: "relation", name: "related" });
    });

    it("gives a single-valued definition its empty field too, and keeps it to the one value", () => {
        const empty = buildNote({ title: "Task", "#label:status": "promoted,single,text" });
        expect(buildPromotedCells(empty)).toHaveLength(1);
        expect(buildPromotedCells(empty)[0].valueAttr).toMatchObject({ attributeId: "", value: "" });

        // Holding two under a single-valued name — a definition retyped from multi — shows the first.
        const twice = buildNote({ title: "Task", "#label:status": "promoted,single,text", "#status": "open" });
        hold(twice, "label", "status", "closed");
        const cells = buildPromotedCells(twice);
        expect(cells).toHaveLength(1);
        expect(cells[0].valueAttr.value).toBe("open");
    });
});

describe("PromotedAttributesContent", () => {
    let container: HTMLElement;

    beforeEach(() => {
        vi.clearAllMocks();
        multiInput.current = null;
        relationInput.current = null;
        serverPutMock.mockResolvedValue({ attributeId: "newAttributeId" });
        // The text fields ask for the values other notes hold under the name, to suggest them.
        serverGetMock.mockResolvedValue([]);
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    /** The grid over cells of its own, holding them as the widget's hook does. */
    function Host({ note }: { note: FNote }) {
        const [ cells, setCells ] = useState<ReturnType<typeof buildPromotedCells> | undefined>(() => buildPromotedCells(note));
        return <PromotedAttributesContent note={note} componentId="cid" cells={cells} setCells={setCells} />;
    }

    function mount(note: FNote) {
        act(() => render(<Host note={note} />, container));
    }

    it("gives a single-valued label its own field, edited through the attribute holding the value", () => {
        const note = buildNote({
            title: "Task",
            "#label:status": "promoted,single,text",
            "#status": "open"
        });
        mount(note);

        const input = container.querySelector<HTMLInputElement>(".promoted-attribute-input");
        expect(input?.value).toBe("open");
        expect(input?.dataset.attributeName).toBe("status");
    });

    it("writes a multi label's set back by name, and patches the field it shows in place", async () => {
        const note = buildNote({ title: "Task", "#label:tags": "promoted,multi,text", "#tags": "alpha" });
        mount(note);

        expect(multiInput.current).toMatchObject({ labelType: "text", values: [ "alpha" ] });

        await act(async () => (multiInput.current?.onCommit as (values: string[]) => Promise<void>)([ "alpha", "beta" ]));

        // Only what the set gained is written — the attribute already there is left as it stands.
        expect(serverPutMock).toHaveBeenCalledOnce();
        expect(serverPutMock).toHaveBeenCalledWith(
            `notes/${note.noteId}/attribute`,
            { attributeId: undefined, type: "label", name: "tags", value: "beta" },
            "cid"
        );
        // The grid ignores reloads of its own making, so the field is patched by hand.
        expect(multiInput.current?.values).toEqual([ "alpha", "beta" ]);
    });

    it("keeps quick multi-label commits in order and shows a set once it is written", async () => {
        const note = buildNote({
            title: "Task",
            "#label:tags": "promoted,multi,text",
            "#tags": "alpha"
        });
        let finishFirstWrite: (response: { attributeId: string }) => void = () => {};
        serverPutMock.mockReturnValueOnce(new Promise((resolve) => {
            finishFirstWrite = resolve;
        }));
        mount(note);

        const commit = multiInput.current?.onCommit as (values: string[]) => Promise<void>;
        let firstCommit: Promise<void> | undefined;
        await act(async () => {
            firstCommit = commit([ "alpha", "beta" ]);
            await Promise.resolve();
        });
        // `values` remains unchanged until `setLabelValues()` resolves.
        expect(multiInput.current?.values).toEqual([ "alpha" ]);
        expect(serverPutMock).toHaveBeenCalledOnce();

        let secondCommit: Promise<void> | undefined;
        await act(async () => {
            secondCommit = commit([ "alpha", "beta", "gamma" ]);
            await Promise.resolve();
        });
        // `commitQueue` does not start the second request before the first request resolves.
        expect(serverPutMock).toHaveBeenCalledOnce();

        await act(async () => {
            finishFirstWrite({ attributeId: "beta-id" });
            await Promise.all([ firstCommit, secondCommit ]);
        });
        expect(serverPutMock).toHaveBeenCalledTimes(2);
        expect(multiInput.current?.values).toEqual([ "alpha", "beta", "gamma" ]);
    });

    it("rebases edits queued after a failed multi-label write", async () => {
        const note = buildNote({
            title: "Task",
            "#label:tags": "promoted,multi,text",
            "#tags": "alpha"
        });
        serverPutMock.mockRejectedValueOnce(new Error("write refused"));
        mount(note);

        const commit = multiInput.current?.onCommit as (values: string[]) => Promise<void>;
        let failed: Promise<void> | undefined;
        let following: Promise<void> | undefined;
        await act(async () => {
            failed = commit([ "alpha", "beta" ]);
            following = commit([ "alpha", "beta", "gamma" ]);
            await Promise.allSettled([ failed, following ]);
        });
        await expect(failed).rejects.toThrow("write refused");
        await expect(following).resolves.toBeUndefined();
        expect(serverPutMock).toHaveBeenCalledTimes(2);
        expect(serverPutMock).toHaveBeenLastCalledWith(
            `notes/${note.noteId}/attribute`,
            { attributeId: undefined, type: "label", name: "tags", value: "gamma" },
            "cid"
        );
        expect(multiInput.current?.values).toEqual([ "alpha", "gamma" ]);
    });

    it("adds a select option to the definition itself, the field offering it from then on", async () => {
        const note = buildNote({ title: "Task", "#label:status": "promoted,multi,select,options=Todo;Done" });
        mount(note);

        expect(multiInput.current?.options).toEqual([ "Todo", "Done" ]);

        await act(async () => (multiInput.current?.onCreateOption as (option: string) => Promise<void>)("Blocked"));

        // Written back to the very attribute declaring the field, options and the rest of it intact.
        expect(serverPutMock).toHaveBeenCalledWith(
            `notes/${note.noteId}/attribute`,
            expect.objectContaining({ name: "label:status", value: expect.stringContaining("Blocked") }),
            "cid"
        );
        expect(multiInput.current?.options).toEqual([ "Todo", "Done", "Blocked" ]);
    });

    it("writes a multi relation's targets by name, as it writes a label's values", async () => {
        const target = buildNote({ title: "Alpha" });
        const other = buildNote({ title: "Beta" });
        const note = buildNote({ title: "Task", "#relation:crew": "promoted,multi", "~crew": target.noteId });
        mount(note);

        expect(relationInput.current?.values).toEqual([ target.noteId ]);

        await act(async () => (relationInput.current?.onCommit as (values: string[]) => Promise<void>)([ target.noteId, other.noteId ]));

        expect(serverPutMock).toHaveBeenCalledWith(
            `notes/${note.noteId}/attribute`,
            { attributeId: undefined, type: "relation", name: "crew", value: other.noteId },
            "cid"
        );
        expect(relationInput.current?.values).toEqual([ target.noteId, other.noteId ]);
    });
});

describe("PromotedAttributes", () => {
    let container: HTMLElement;
    /** What the widget subscribed to, for handing it a reload as the real component tree would. */
    let handlers: Map<string, (data: unknown) => void>;

    beforeEach(() => {
        vi.clearAllMocks();
        multiInput.current = null;
        serverGetMock.mockResolvedValue([]);
        handlers = new Map();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    function mount(note: FNote, omit?: readonly string[]) {
        shownNote.current = note;
        const parent = {
            componentId: "cid",
            registerHandler: (name: string, callback: (data: unknown) => void) => handlers.set(name, callback),
            removeHandler: () => {}
        } as unknown as Component;
        act(() => render(
            <ParentComponent.Provider value={parent}>
                <PromotedAttributes omit={omit} />
            </ParentComponent.Provider>,
            container
        ));
    }

    it("builds the fields the note's definitions ask for, and rebuilds on a change made elsewhere", () => {
        const note = buildNote({ title: "Task", "#label:tags": "promoted,multi,text", "#tags": "alpha" });
        mount(note);

        expect(container.querySelectorAll(".promoted-attribute-cell")).toHaveLength(1);
        expect(multiInput.current?.values).toEqual([ "alpha" ]);

        // Another client fills a value in: the reload reaches the grid, which rereads the note.
        hold(note, "label", "tags", "beta");
        const loadResults = {
            getAttributeRows: () => [ {
                noteId: note.noteId, type: "label", name: "tags", value: "beta", isInheritable: false
            } ]
        } as unknown as LoadResults;
        act(() => handlers.get("entitiesReloaded")?.({ loadResults }));

        expect(multiInput.current?.values).toEqual([ "alpha", "beta" ]);
    });

    /** A host showing a value better than a field would says so by name — see the geo map's pane. */
    it("leaves out the definitions the host names, and keeps the rest", () => {
        const note = buildNote({
            title: "Place",
            "#label:geolocation": "promoted,single,text",
            "#geolocation": "1,2",
            "#label:visited": "promoted,single,text",
            "#visited": "yes"
        });
        mount(note, [ "geolocation" ]);

        const names = [ ...container.querySelectorAll(".promoted-attribute-cell > label") ]
            .map((label) => label.textContent);
        expect(names).toEqual([ "visited" ]);
    });

    it("keeps the grid empty for a table view, whose cells already edit the same fields", () => {
        const note = buildNote({
            title: "Grid", "#viewType": "table",
            "#label:tags": "promoted,multi,text", "#tags": "alpha"
        });
        mount(note);

        expect(container.querySelectorAll(".promoted-attribute-cell")).toHaveLength(0);
    });
});


describe("PromotedAttributesContent rendering", () => {
    let note: FNote;

    beforeEach(() => {
        vi.clearAllMocks();
        serverGetMock.mockResolvedValue([]);
        serverPutMock.mockResolvedValue({ attributeId: "newAttributeId" });
        note = buildNote({ title: "Host note" });
    });

    it("renders no container when there are no cells", async () => {
        const emptyContainer = await renderCells(note, []);
        expect(emptyContainer.querySelector(".promoted-attributes-widget")).not.toBeNull();
        expect(emptyContainer.querySelector(".promoted-attributes-container")).toBeNull();

        // `undefined` (not yet loaded) behaves the same way.
        const pendingContainer = await renderCells(note, undefined as never);
        expect(pendingContainer.querySelector(".promoted-attributes-container")).toBeNull();
    });

    it("renders one cell per entry, with a label bound to the input", async () => {
        const container = await renderCells(note, [
            buildCell(note, { name: "first", uniqueId: "a" }),
            buildCell(note, { name: "second", uniqueId: "b" })
        ]);

        const cells = container.querySelectorAll(".promoted-attribute-cell");
        expect(cells).toHaveLength(2);

        const label = container.querySelector("label");
        const input = container.querySelector<HTMLInputElement>("input.promoted-attribute-input");
        expect(label?.textContent).toBe("first");
        expect(label?.getAttribute("for")).toBe(input?.id);
        expect(input?.id).toBeTruthy();
    });

    it("prefers the promoted alias over the raw attribute name", async () => {
        const container = await renderCells(note, [
            buildCell(note, { name: "rawName", definition: { promotedAlias: "Friendly name" } })
        ]);

        expect(container.querySelector("label")?.textContent).toBe("Friendly name");
    });

    it("maps each label type onto the matching input type", async () => {
        const cases: Array<[DefinitionObject["labelType"], string]> = [
            [ "text", "text" ],
            [ "number", "number" ],
            [ "boolean", "checkbox" ],
            [ "date", "date" ],
            [ "datetime", "datetime-local" ],
            [ "time", "time" ],
            [ "url", "url" ]
        ];

        for (const [ labelType, expectedInputType ] of cases) {
            const container = await renderCells(note, [
                buildCell(note, { definition: { labelType }, uniqueId: `cell-${labelType}` })
            ]);
            const input = container.querySelector<HTMLInputElement>("input.promoted-attribute-input");
            expect(input?.getAttribute("type"), `labelType=${labelType}`).toBe(expectedInputType);
            expect(container.querySelector(".promoted-attribute-cell")?.className)
                .toContain(`promoted-attribute-label-${labelType}`);
        }
    });

    it("renders a textarea instead of an input for the textarea label type", async () => {
        const container = await renderCells(note, [
            buildCell(note, { definition: { labelType: "textarea" }, value: "long text" })
        ]);

        const textarea = container.querySelector<HTMLTextAreaElement>("textarea.promoted-attribute-input");
        expect(textarea).not.toBeNull();
        expect(container.querySelector("input.promoted-attribute-input")).toBeNull();
        expect(textarea?.value).toBe("long text");
    });

    it("derives the number step from the configured precision", async () => {
        const twoDecimals = await renderCells(note, [
            buildCell(note, { definition: { labelType: "number", numberPrecision: 2 } })
        ]);
        expect(twoDecimals.querySelector("input.promoted-attribute-input")?.getAttribute("step")).toBe("0.01");

        // With no precision declared the field is left to the browser's default stepping rather
        // than being pinned to a step of its own.
        const noPrecision = await renderCells(note, [
            buildCell(note, { definition: { labelType: "number" }, uniqueId: "no-precision" })
        ]);
        expect(noPrecision.querySelector("input.promoted-attribute-input")?.getAttribute("step")).toBeNull();
    });

    it("moves the label after the checkbox for boolean attributes and reflects the checked state", async () => {
        const container = await renderCells(note, [
            buildCell(note, { definition: { labelType: "boolean" }, value: "true" })
        ]);

        const checkbox = container.querySelector<HTMLInputElement>("input[type=checkbox]");
        expect(checkbox?.checked).toBe(true);
        // The boolean branch wraps the input in a `.tn-checkbox` label rather than preceding it.
        expect(container.querySelector("label.tn-checkbox")).not.toBeNull();

        const unchecked = await renderCells(note, [
            buildCell(note, { definition: { labelType: "boolean" }, value: "false", uniqueId: "unchecked" })
        ]);
        expect(unchecked.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked).toBe(false);
    });

    it("renders the colour picker alongside a colour attribute", async () => {
        const container = await renderCells(note, [
            buildCell(note, { definition: { labelType: "color" }, value: "#123456" })
        ]);

        expect(container.querySelector(".color-picker")).not.toBeNull();
        // The raw input is kept but hidden, the picker drives the value.
        expect(container.querySelector("input.promoted-attribute-input")?.getAttribute("type")).toBe("hidden");
    });

    it("renders an open-link button for url attributes and opens the current value", async () => {
        const container = await renderCells(note, [
            buildCell(note, { definition: { labelType: "url" }, value: "https://example.com" })
        ]);

        const input = container.querySelector<HTMLInputElement>("input.promoted-attribute-input");
        expect(input?.getAttribute("type")).toBe("url");

        const openButton = container.querySelector<HTMLElement>(".open-external-link-button");
        expect(openButton).not.toBeNull();

        const windowOpen = vi.spyOn(window, "open").mockImplementation(() => null);
        openButton?.click();
        expect(windowOpen).toHaveBeenCalledWith("https://example.com", "_blank");

        windowOpen.mockRestore();
    });

    it("does not open a blank tab for a url attribute with no value", async () => {
        const container = await renderCells(note, [
            buildCell(note, { definition: { labelType: "url" }, value: "", uniqueId: "empty-url" })
        ]);

        const windowOpen = vi.spyOn(window, "open").mockImplementation(() => null);
        container.querySelector<HTMLElement>(".open-external-link-button")?.click();
        expect(windowOpen).not.toHaveBeenCalled();
        windowOpen.mockRestore();
    });

    it("renders the note autocomplete for relation attributes", async () => {
        const container = await renderCells(note, [
            buildCell(note, { type: "relation", value: "targetNoteId" })
        ]);

        expect(container.querySelector(".promoted-attribute-cell")?.className)
            .toContain("promoted-attribute-relation");
        expect(container.querySelector<HTMLInputElement>(".note-autocomplete-stub")?.value).toBe("targetNoteId");
    });

    it("logs an error for an unknown attribute type and renders no input", async () => {
        const container = await renderCells(note, [
            buildCell(note, { type: "bogus" as never })
        ]);

        expect(logErrorMock).toHaveBeenCalledOnce();
        expect(container.querySelector(".promoted-attribute-input")).toBeNull();
    });

    it("persists a changed value on blur and writes back the returned attribute id", async () => {
        const setCells = vi.fn();
        const container = await renderCells(note, [
            buildCell(note, { name: "myLabel", value: "before", attributeId: "" })
        ], setCells);

        const input = container.querySelector<HTMLInputElement>("input.promoted-attribute-input");
        expect(input).not.toBeNull();
        if (!input) return;

        await act(async () => {
            input.value = "after";
            // Preact delegates blur to focusout.
            input.dispatchEvent(new Event("focusout", { bubbles: true }));
        });

        expect(serverPutMock).toHaveBeenCalledWith(
            `notes/${note.noteId}/attribute`,
            { attributeId: "", type: "label", name: "myLabel", value: "after" },
            "test-component"
        );

        // The state updater merges the server-assigned id into the matching cell.
        const updater = setCells.mock.calls[0][0] as (prev: CellLike[]) => CellLike[];
        const updated = updater([ buildCell(note, { name: "myLabel", uniqueId: "cell-1" }) ]);
        expect(updated[0].valueAttr.attributeId).toBe("newAttributeId");
        expect(updated[0].valueAttr.value).toBe("after");
    });

    it("skips the server round-trip when the value did not change", async () => {
        const container = await renderCells(note, [
            buildCell(note, { value: "unchanged" })
        ]);

        const input = container.querySelector<HTMLInputElement>("input.promoted-attribute-input");
        if (!input) return;
        await act(async () => {
            input.dispatchEvent(new Event("focusout", { bubbles: true }));
        });

        expect(serverPutMock).not.toHaveBeenCalled();
    });

    it("sends the checkbox state rather than its value for boolean attributes", async () => {
        const container = await renderCells(note, [
            buildCell(note, { name: "flag", definition: { labelType: "boolean" }, value: "false" })
        ]);

        const checkbox = container.querySelector<HTMLInputElement>("input[type=checkbox]");
        if (!checkbox) return;
        await act(async () => {
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event("focusout", { bubbles: true }));
        });

        expect(serverPutMock).toHaveBeenCalledWith(
            `notes/${note.noteId}/attribute`,
            expect.objectContaining({ name: "flag", value: "true" }),
            "test-component"
        );
    });

    it("fetches suggestion values only for text attributes", async () => {
        await renderCells(note, [ buildCell(note, { name: "tags", definition: { labelType: "text" } }) ]);
        expect(serverGetMock).toHaveBeenCalledWith("attribute-values/tags");

        serverGetMock.mockClear();
        await renderCells(note, [ buildCell(note, { definition: { labelType: "number" }, uniqueId: "num" }) ]);
        expect(serverGetMock).not.toHaveBeenCalled();
    });

    it("binds the suggestion list only where there is something to suggest", async () => {
        serverGetMock.mockResolvedValueOnce([ "one", "two" ]);
        await renderCells(note, [ buildCell(note, { name: "tags", definition: { labelType: "text" } }) ]);
        expect(autocompleteMock).toHaveBeenCalled();

        autocompleteMock.mockClear();
        await renderCells(note, [ buildCell(note, { name: "flag", definition: { labelType: "boolean" }, uniqueId: "flag" }) ]);
        expect(autocompleteMock).not.toHaveBeenCalled();

        // A text field whose name nothing else holds a value under is bound no more than a flag is.
        await renderCells(note, [ buildCell(note, { name: "fresh", definition: { labelType: "text" }, uniqueId: "fresh" }) ]);
        expect(autocompleteMock).not.toHaveBeenCalled();
    });

    it("hands a field holding several values the names already entered under its own", async () => {
        serverGetMock.mockResolvedValueOnce([ "Game", "RPG" ]);
        await renderCells(note, [ buildCell(note, {
            name: "tags",
            definition: { labelType: "text", multiplicity: "multi" },
            values: [ "Game" ]
        }) ]);
        expect(serverGetMock).toHaveBeenCalledWith("attribute-values/tags");

        const suggest = multiInput.current?.source as (query: string) => Promise<string[]>;
        expect(await suggest("")).toEqual([ "Game", "RPG" ]);
        expect(await suggest(" ga ")).toEqual([ "Game" ]);

        await renderCells(note, [ buildCell(note, {
            name: "due",
            definition: { labelType: "date", multiplicity: "multi" },
            values: [],
            uniqueId: "due"
        }) ]);
        expect(multiInput.current?.source).toBeUndefined();

        await renderCells(note, [ buildCell(note, {
            name: "fresh",
            definition: { labelType: "text", multiplicity: "multi" },
            values: [],
            uniqueId: "fresh"
        }) ]);
        expect(serverGetMock).toHaveBeenCalledWith("attribute-values/fresh");
        const suggestFresh = multiInput.current?.source as (query: string) => Promise<string[]>;
        expect(await suggestFresh("")).toEqual([]);
    });

    it("keeps a multi text field's suggestion source attached while its values load", async () => {
        let finishLoading: (values: string[]) => void = () => {};
        serverGetMock.mockReturnValueOnce(new Promise<string[]>((resolve) => {
            finishLoading = resolve;
        }));

        await renderCells(note, [ buildCell(note, {
            name: "tags",
            definition: { labelType: "text", multiplicity: "multi" },
            values: []
        }) ]);

        const loadingSource = multiInput.current?.source as (query: string) => Promise<string[]>;
        expect(await loadingSource("")).toEqual([]);

        await act(async () => finishLoading([ "Game", "RPG" ]));
        const loadedSource = multiInput.current?.source as (query: string) => Promise<string[]>;
        expect(await loadedSource("rp")).toEqual([ "RPG" ]);
    });
});

describe("usePromotedAttributeData", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns no cells without a note, outside the default view mode, or for table views", async () => {
        expect(await collectCells(null)).toEqual([]);

        const note = buildNote({ title: "Plain", "#label:foo": "promoted" });
        expect(await collectCells(note, { viewScope: { viewMode: "attachments" } })).toEqual([]);

        const tableNote = buildNote({ title: "Table", "#label:foo": "promoted", "#viewType": "table" });
        expect(await collectCells(tableNote)).toEqual([]);
    });

    it("builds a cell per promoted definition, ignoring non-promoted ones", async () => {
        const note = buildNote({
            title: "Definitions",
            "#label:promotedOne": "promoted,text",
            "#label:notPromoted": "text",
            "#promotedOne": "a value"
        });

        const cells = await collectCells(note);

        expect(cells).toHaveLength(1);
        expect(cells?.[0].valueName).toBe("promotedOne");
        expect(cells?.[0].valueAttr.value).toBe("a value");
        expect(cells?.[0].definition.labelType).toBe("text");
        expect(cells?.[0].uniqueId).toBeTruthy();
    });

    it("synthesises an empty cell when a promoted definition has no value yet", async () => {
        const note = buildNote({ title: "No value", "#label:empty": "promoted,text" });

        const cells = await collectCells(note);

        expect(cells).toHaveLength(1);
        expect(cells?.[0].valueAttr.value).toBe("");
        // A blank attribute id marks it as not yet persisted.
        expect(cells?.[0].valueAttr.attributeId).toBe("");
    });

    it("keeps every value for multi multiplicity but only the first for single", async () => {
        // A multi definition is one field holding the whole set as chips, so the values land in
        // `values` rather than in a cell apiece.
        const multiNote = buildNote({ title: "Multi", "#label:tag": "promoted,multi,text", "#tag": "first" });
        hold(multiNote, "label", "tag", "second");
        const multiCells = await collectCells(multiNote);
        expect(multiCells).toHaveLength(1);
        expect(multiCells?.[0].values).toEqual([ "first", "second" ]);

        const singleNote = buildNote({ title: "Single", "#label:tag": "promoted,single,text", "#tag": "first" });
        hold(singleNote, "label", "tag", "second");
        const singleCells = await collectCells(singleNote);
        expect(singleCells?.map((cell) => cell.valueAttr.value)).toEqual([ "first" ]);
    });

    it("builds relation cells from relation definitions", async () => {
        const target = buildNote({ title: "Target" });
        const note = buildNote({
            title: "With relation",
            "#relation:link": "promoted",
            "~link": target.noteId
        });

        const cells = await collectCells(note);

        expect(cells).toHaveLength(1);
        expect(cells?.[0].valueAttr.type).toBe("relation");
        expect(cells?.[0].valueAttr.value).toBe(target.noteId);
    });

    it("returns no cells when promoted attributes are hidden", async () => {
        const note = buildNote({
            title: "Hidden",
            "#label:foo": "promoted,text",
            "#hidePromotedAttributes": "true"
        });

        expect(await collectCells(note)).toEqual([]);
    });
});

interface CellLike {
    uniqueId: string;
    definitionAttr: FAttribute;
    definition: DefinitionObject;
    valueAttr: { attributeId: string; type: string; name: string; value: string; noteId?: string };
    valueName: string;
    values?: string[];
}

/** Builds a definition attribute + matching value cell, mirroring what `usePromotedAttributeData` produces. */
function buildCell(note: FNote, {
    name = "myLabel",
    type = "label",
    value = "",
    definition = {},
    attributeId = "valueAttrId",
    uniqueId = "cell-1",
    values
}: {
    name?: string;
    type?: "label" | "relation";
    value?: string;
    definition?: DefinitionObject;
    attributeId?: string;
    uniqueId?: string;
    values?: string[];
} = {}): CellLike {
    const definitionAttr = new FAttribute(froca, {
        noteId: note.noteId,
        attributeId: `${uniqueId}-def`,
        type: "label",
        name: `${type}:${name}`,
        value: "promoted",
        position: 10,
        isInheritable: false
    });
    // `definition` drives every render branch, so inject it directly rather than round-tripping
    // through the definition-string parser.
    definitionAttr.getDefinition = () => ({ isPromoted: true, ...definition });

    return {
        uniqueId,
        definitionAttr,
        definition: { isPromoted: true, ...definition },
        valueAttr: { attributeId, type, name, value, noteId: note.noteId },
        valueName: name,
        ...(values && { values })
    };
}

async function renderCells(note: FNote, cells: CellLike[], setCells = vi.fn()) {
    let container: HTMLElement | undefined;
    await act(async () => {
        container = renderInto(
            <PromotedAttributesContent
                note={note}
                componentId="test-component"
                cells={cells as never}
                setCells={setCells}
            />);
        // Let the text-autocomplete server fetch settle.
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    if (!container) throw new Error("render produced no container");
    return container;
}

/** Runs the hook against a real note and returns the cells it derived. */
async function collectCells(note: FNote | null | undefined, context: unknown = { viewScope: { viewMode: "default" } }) {
    let cells: CellLike[] | undefined;

    function Probe() {
        const [ derived ] = usePromotedAttributeData(note, "test-component", context as never);
        cells = derived as CellLike[] | undefined;
        return null;
    }

    await act(async () => {
        renderInto(<Probe />);
        await new Promise((resolve) => setTimeout(resolve, 0));
    });

    return cells;
}
/** Gives the note another attribute under a name it already carries, which one literal cannot. */
function hold(note: FNote, type: "label" | "relation", name: string, value: string, position = 100) {
    const attributeId = randomString(12);
    const attribute = new FAttribute(froca, {
        noteId: note.noteId,
        attributeId,
        type,
        name,
        value,
        position,
        isInheritable: false
    });

    froca.attributes[attributeId] = attribute;
    note.attributes.push(attributeId);
    noteAttributeCache.attributes[note.noteId]?.push(attribute);
}
