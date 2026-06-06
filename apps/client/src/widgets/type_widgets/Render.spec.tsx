import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapMock } from "../../test/mocks";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => bootstrapMock());

// The render service drives heavy bundle execution + jQuery DOM mutation; stub it.
vi.mock("../../services/render", () => ({
    default: { render: vi.fn() },
    render: vi.fn()
}));

vi.mock("../../services/note_create", () => ({
    default: { createNote: vi.fn(async () => ({ note: { noteId: "createdNote1" } })) }
}));

vi.mock("../../services/toast", () => ({
    default: { showMessage: vi.fn(), showError: vi.fn() },
    showMessage: vi.fn(),
    showError: vi.fn()
}));

// NoteAutocomplete relies on jQuery autocomplete plugins; replace with a controllable stub
// that exposes the noteIdChanged callback through a marker input.
let lastNoteIdChanged: ((noteId: string) => void) | undefined;
vi.mock("../react/NoteAutocomplete", () => ({
    default: ({ noteIdChanged }: { noteIdChanged?: (noteId: string) => void }) => {
        lastNoteIdChanged = noteIdChanged;
        return <input className="note-autocomplete-mock" />;
    }
}));

import attributes from "../../services/attributes";
import Component from "../../components/component";
import note_create from "../../services/note_create";
import render_service from "../../services/render";
import toast from "../../services/toast";
import { buildNote } from "../../test/easy-froca";
import { fakeNoteContext, flush, renderComponent, resetFroca } from "../../test/render";
import RenderWidget from "./Render";

// --- Render harness --------------------------------------------------------------------------------

let parent: Component;

function renderWithProviders(vnode: any, noteContext: any = null) {
    return renderComponent(vnode, { parent, noteContext }).container;
}

function fire(name: string, data: unknown) {
    act(() => { (parent.handleEventInChildren as any)(name, data); });
}

const TYPE_PROPS_EXTRA = {
    parentComponent: undefined,
    noteContext: undefined,
    ntxId: "ntx1" as string | null | undefined
};

beforeEach(() => {
    parent = new Component();
    lastNoteIdChanged = undefined;
    resetFroca();
    vi.clearAllMocks();
    ($.fn as any).tooltip = function () { return this; };
    ($.fn as any).dropdown = function () { return this; };
});

// --- Dispatcher branches ---------------------------------------------------------------------------

describe("Render dispatcher", () => {
    it("renders the setup form when no renderNote relation is set", () => {
        const note = buildNote({ id: "setupNote", title: "Setup" });
        const root = renderWithProviders(<RenderWidget note={note} viewScope={undefined} {...TYPE_PROPS_EXTRA} />);

        // SetupForm structure + a NoteAutocomplete stub + the split button.
        expect(root.querySelector(".setup-form")).toBeTruthy();
        expect(root.querySelector(".note-autocomplete-mock")).toBeTruthy();
        expect(root.querySelector(".btn-group")).toBeTruthy();
        // No render content / disabled enable button.
        expect(root.querySelector(".note-detail-render-content")).toBeNull();
    });

    it("renders the disabled placeholder when disabled:renderNote is set", () => {
        const note = buildNote({ id: "disabledNote", title: "Disabled", "~disabled:renderNote": "target1" });
        const root = renderWithProviders(<RenderWidget note={note} viewScope={undefined} {...TYPE_PROPS_EXTRA} />);

        expect(root.querySelector(".setup-form")).toBeTruthy();
        // The enable button uses the primary kind.
        expect(root.querySelector("button.btn-primary")).toBeTruthy();
        // No autocomplete / split button in the disabled view.
        expect(root.querySelector(".note-autocomplete-mock")).toBeNull();
        expect(root.querySelector(".note-detail-render-content")).toBeNull();
    });

    it("renders the content area and invokes the render service when a renderNote relation is set", () => {
        buildNote({ id: "renderTarget", title: "Target" });
        const note = buildNote({ id: "renderHost", title: "Host", "~renderNote": "renderTarget" });
        const root = renderWithProviders(<RenderWidget note={note} viewScope={undefined} {...TYPE_PROPS_EXTRA} />);

        expect(root.querySelector(".note-detail-render-content")).toBeTruthy();
        expect(render_service.render).toHaveBeenCalledTimes(1);
        expect((render_service.render as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(note);
    });
});

// --- DisabledRender ---------------------------------------------------------------------------------

describe("DisabledRender", () => {
    it("enables the renderNote relation when the enable button is clicked", () => {
        const toggleSpy = vi.spyOn(attributes, "toggleDangerousAttribute").mockResolvedValue(undefined);
        const note = buildNote({ id: "enNote", title: "E", "~disabled:renderNote": "t1" });
        const root = renderWithProviders(<RenderWidget note={note} viewScope={undefined} {...TYPE_PROPS_EXTRA} />);

        const button = root.querySelector("button.btn-primary");
        expect(button).toBeTruthy();
        (button as HTMLButtonElement).click();
        expect(toggleSpy).toHaveBeenCalledWith(note, "relation", "renderNote", true);
    });
});

// --- SetupRenderContent -----------------------------------------------------------------------------

describe("SetupRenderContent", () => {
    it("sets the renderNote relation when a note is picked in the autocomplete", async () => {
        const setRelationSpy = vi.spyOn(attributes, "setRelation").mockResolvedValue(undefined);
        const note = buildNote({ id: "pickNote", title: "Pick" });
        renderWithProviders(<RenderWidget note={note} viewScope={undefined} {...TYPE_PROPS_EXTRA} />);

        expect(typeof lastNoteIdChanged).toBe("function");
        // An empty noteId is ignored.
        act(() => lastNoteIdChanged?.(""));
        expect(setRelationSpy).not.toHaveBeenCalled();

        act(() => lastNoteIdChanged?.("chosenTarget"));
        await flush();
        expect(setRelationSpy).toHaveBeenCalledWith("pickNote", "renderNote", "chosenTarget");
    });

    it("creates a Preact sample note via the main split button and sets the relation + toast", async () => {
        const setRelationSpy = vi.spyOn(attributes, "setRelation").mockResolvedValue(undefined);
        const note = buildNote({ id: "sampleHost", title: "SH" });
        const root = renderWithProviders(<RenderWidget note={note} viewScope={undefined} {...TYPE_PROPS_EXTRA} />);

        const mainButton = root.querySelector(".btn-group button");
        expect(mainButton).toBeTruthy();
        (mainButton as HTMLButtonElement).click();
        await flush();

        expect(note_create.createNote).toHaveBeenCalledWith("sampleHost", expect.objectContaining({
            type: "code",
            mime: "text/jsx",
            activate: false
        }));
        expect(setRelationSpy).toHaveBeenCalledWith("sampleHost", "renderNote", "createdNote1");
        expect(toast.showMessage).toHaveBeenCalled();
    });

    it("creates an HTML sample note via the dropdown item", async () => {
        const setRelationSpy = vi.spyOn(attributes, "setRelation").mockResolvedValue(undefined);
        const note = buildNote({ id: "htmlHost", title: "HH" });
        const root = renderWithProviders(<RenderWidget note={note} viewScope={undefined} {...TYPE_PROPS_EXTRA} />);

        const dropdownItem = root.querySelector(".dropdown-menu li.dropdown-item");
        expect(dropdownItem).toBeTruthy();
        (dropdownItem as HTMLElement).click();
        await flush();

        expect(note_create.createNote).toHaveBeenCalledWith("htmlHost", expect.objectContaining({
            type: "code",
            mime: "text/html"
        }));
        expect(setRelationSpy).toHaveBeenCalledWith("htmlHost", "renderNote", "createdNote1");
    });

    it("does not set a relation when note creation returns no note", async () => {
        (note_create.createNote as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ note: undefined });
        const setRelationSpy = vi.spyOn(attributes, "setRelation").mockResolvedValue(undefined);
        const note = buildNote({ id: "noNoteHost", title: "NN" });
        const root = renderWithProviders(<RenderWidget note={note} viewScope={undefined} {...TYPE_PROPS_EXTRA} />);

        const mainButton = root.querySelector(".btn-group button");
        (mainButton as HTMLButtonElement).click();
        await flush();

        expect(note_create.createNote).toHaveBeenCalled();
        expect(setRelationSpy).not.toHaveBeenCalled();
        expect(toast.showMessage).not.toHaveBeenCalled();
    });
});

// --- RenderContent event handlers + error state ----------------------------------------------------

describe("RenderContent", () => {
    function buildHost(id = "rcHost") {
        buildNote({ id: `${id}Target`, title: "T" });
        return buildNote({ id, title: "Host", "~renderNote": `${id}Target` });
    }

    it("refreshes on renderActiveNote only when the note context is active", () => {
        const note = buildHost("activeHost");
        const isActive = vi.fn(() => true);
        const noteContext = fakeNoteContext({ isActive });
        renderWithProviders(<RenderWidget note={note} viewScope={undefined} {...TYPE_PROPS_EXTRA} noteContext={noteContext} />, noteContext);

        const callsBefore = (render_service.render as ReturnType<typeof vi.fn>).mock.calls.length;
        fire("renderActiveNote", {});
        expect((render_service.render as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore + 1);

        // When inactive, no refresh.
        isActive.mockReturnValue(false);
        fire("renderActiveNote", {});
        expect((render_service.render as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore + 1);
    });

    it("does nothing on renderActiveNote without a note context", () => {
        const note = buildHost("noCtxHost");
        renderWithProviders(<RenderWidget note={note} viewScope={undefined} {...TYPE_PROPS_EXTRA} />);

        const callsBefore = (render_service.render as ReturnType<typeof vi.fn>).mock.calls.length;
        fire("renderActiveNote", {});
        expect((render_service.render as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
    });

    it("refreshes on refreshData only for the matching ntxId", () => {
        const note = buildHost("refreshHost");
        renderWithProviders(<RenderWidget note={note} viewScope={undefined} {...TYPE_PROPS_EXTRA} />);

        const callsBefore = (render_service.render as ReturnType<typeof vi.fn>).mock.calls.length;
        fire("refreshData", { ntxId: "other" });
        expect((render_service.render as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);

        fire("refreshData", { ntxId: "ntx1" });
        expect((render_service.render as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore + 1);
    });

    it("refreshes on entitiesReloaded only for an affecting renderNote relation change", () => {
        const note = buildHost("reloadHost");
        renderWithProviders(<RenderWidget note={note} viewScope={undefined} {...TYPE_PROPS_EXTRA} />);
        const callsBefore = (render_service.render as ReturnType<typeof vi.fn>).mock.calls.length;

        // Unrelated attribute change → no refresh.
        fire("entitiesReloaded", {
            loadResults: { getAttributeRows: () => [ { type: "label", name: "renderNote", noteId: "reloadHost" } ] }
        });
        expect((render_service.render as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);

        // Matching relation change owned by the host note → refresh.
        fire("entitiesReloaded", {
            loadResults: { getAttributeRows: () => [ { type: "relation", name: "renderNote", noteId: "reloadHost", isInheritable: false } ] }
        });
        expect((render_service.render as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore + 1);
    });

    it("resolves executeWithContentElement with the content element for the matching ntxId", () => {
        const note = buildHost("execHost");
        const root = renderWithProviders(<RenderWidget note={note} viewScope={undefined} {...TYPE_PROPS_EXTRA} />);

        // Non-matching ntxId → resolve not called.
        const resolveOther = vi.fn();
        fire("executeWithContentElement", { ntxId: "other", resolve: resolveOther });
        expect(resolveOther).not.toHaveBeenCalled();

        const resolve = vi.fn();
        fire("executeWithContentElement", { ntxId: "ntx1", resolve });
        expect(resolve).toHaveBeenCalledTimes(1);
        const passed = resolve.mock.calls[0][0];
        expect(passed[0]).toBe(root.querySelector(".note-detail-render-content"));
    });

    it("shows a caution admonition when the render service reports an error", () => {
        // Make render invoke its onError callback synchronously with an Error.
        (render_service.render as ReturnType<typeof vi.fn>).mockImplementation((_note, _el, onError) => {
            onError?.(new Error("boom"));
        });
        const note = buildHost("errHost");
        const root = renderWithProviders(<RenderWidget note={note} viewScope={undefined} {...TYPE_PROPS_EXTRA} />);

        const admonition = root.querySelector(".admonition.caution");
        expect(admonition).toBeTruthy();
        expect(admonition?.textContent).toContain("boom");
    });
});
