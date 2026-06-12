import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    isMobile: vi.fn(() => false)
}));

vi.mock("../../services/note_autocomplete", () => ({
    default: {
        showRecentNotes: vi.fn(),
        initNoteAutocomplete: vi.fn(),
        setText: vi.fn()
    }
}));

vi.mock("../../services/search", () => ({
    default: {
        searchForNotes: vi.fn(async () => [])
    }
}));

vi.mock("../../components/app_context", () => ({
    default: {
        triggerCommand: vi.fn(),
        tabManager: {
            getNoteContextById: vi.fn(),
            getActiveContext: vi.fn()
        }
    }
}));

// Replace the heavy child components with light stubs that expose their props so the
// container's own logic (onChange / onClick handlers, conditional rendering) is what we cover.
let capturedAutocompleteProps: Record<string, unknown> | undefined;
vi.mock("../react/NoteAutocomplete", () => ({
    default: (props: Record<string, unknown>) => {
        capturedAutocompleteProps = props;
        return <input className="note-autocomplete-stub" />;
    }
}));
vi.mock("../react/FormGroup", () => ({
    default: ({ children, className, name }: { children: unknown; className?: string; name: string }) => (
        <div className={`form-group-stub ${className ?? ""}`} data-name={name}>{children as never}</div>
    )
}));

import type { Suggestion } from "../../services/note_autocomplete";
import appContext from "../../components/app_context";
import Component from "../../components/component";
import froca from "../../services/froca";
import note_autocomplete from "../../services/note_autocomplete";
import search from "../../services/search";
import { isMobile } from "../../services/utils";
import { buildNote } from "../../test/easy-froca";
import { flush, renderComponent, resetFroca } from "../../test/render";
import Empty from "./Empty";

// --- Render helper --------------------------------------------------------------------------------

function renderEmpty(props: { ntxId?: string | null | undefined } = {}, parent: Component | null = null) {
    return renderComponent((
        <Empty ntxId={props.ntxId} note={undefined as never} viewScope={undefined} parentComponent={undefined} noteContext={undefined} />
    ), { parent: parent as Component }).container;
}

const isMobileMock = isMobile as ReturnType<typeof vi.fn>;
const searchMock = search.searchForNotes as ReturnType<typeof vi.fn>;
const getByIdMock = appContext.tabManager.getNoteContextById as ReturnType<typeof vi.fn>;
const getActiveMock = appContext.tabManager.getActiveContext as ReturnType<typeof vi.fn>;
const triggerCommandMock = appContext.triggerCommand as ReturnType<typeof vi.fn>;

beforeEach(() => {
    resetFroca();
    vi.clearAllMocks();
    isMobileMock.mockReturnValue(false);
    searchMock.mockResolvedValue([]);
    capturedAutocompleteProps = undefined;
});

// --- Tests ----------------------------------------------------------------------------------------

describe("Empty (desktop)", () => {
    it("renders the workspace switcher and the desktop note search; shows recent notes on mount", async () => {
        const root = renderEmpty({ ntxId: "ntx1" });
        await flush();

        // Desktop search path renders the FormGroup + autocomplete stub + results container.
        expect(root.querySelector(".form-group-stub")).toBeTruthy();
        expect(root.querySelector(".note-autocomplete-stub")).toBeTruthy();
        expect(root.querySelector(".note-detail-empty-results")).toBeTruthy();
        expect(root.querySelector(".workspace-notes")).toBeTruthy();

        // The recent-notes effect ran.
        expect(note_autocomplete.showRecentNotes).toHaveBeenCalledTimes(1);
        // Workspace search kicked off.
        expect(searchMock).toHaveBeenCalledWith("#workspace #!template");
    });

    it("passes ntxId through and forwards a selected suggestion to the resolved note context", async () => {
        const setNote = vi.fn();
        getByIdMock.mockReturnValue({ setNote });
        renderEmpty({ ntxId: "ctx-a" });
        await flush();

        const onChange = capturedAutocompleteProps?.onChange as (s: Suggestion | null) => unknown;
        onChange({ notePath: "root/abc" });

        expect(getByIdMock).toHaveBeenCalledWith("ctx-a");
        expect(setNote).toHaveBeenCalledWith("root/abc");
        expect(getActiveMock).not.toHaveBeenCalled();
    });

    it("falls back to the active context when getNoteContextById returns nothing", async () => {
        const setNote = vi.fn();
        getByIdMock.mockReturnValue(undefined);
        getActiveMock.mockReturnValue({ setNote });
        renderEmpty({ ntxId: null });
        await flush();

        const onChange = capturedAutocompleteProps?.onChange as (s: Suggestion | null) => unknown;
        onChange({ notePath: "root/xyz" });

        expect(getActiveMock).toHaveBeenCalled();
        expect(setNote).toHaveBeenCalledWith("root/xyz");
    });

    it("ignores suggestions without a notePath, and does nothing when no context is available", async () => {
        getByIdMock.mockReturnValue(undefined);
        getActiveMock.mockReturnValue(null);
        renderEmpty({ ntxId: "ctx-b" });
        await flush();

        const onChange = capturedAutocompleteProps?.onChange as (s: Suggestion | null) => unknown;
        // No suggestion at all -> early return false.
        expect(onChange(null)).toBe(false);
        // Suggestion without notePath -> early return false.
        expect(onChange({ noteTitle: "x" })).toBe(false);
        // Suggestion with a path but no resolvable context -> no throw, nothing set.
        expect(() => onChange({ notePath: "root/none" })).not.toThrow();
    });
});

describe("Empty (mobile)", () => {
    it("renders the mobile search affordance and triggers jumpToNote on click", () => {
        isMobileMock.mockReturnValue(true);
        const root = renderEmpty({ ntxId: "ntx-m" });

        const mobile = root.querySelector(".empty-tab-search-mobile");
        expect(mobile).toBeTruthy();
        expect(root.querySelector(".form-group-stub")).toBeNull();
        expect(root.querySelector(".empty-tab-search-mobile-icon")).toBeTruthy();
        expect(root.querySelector(".empty-tab-search-mobile-placeholder")).toBeTruthy();

        (mobile as HTMLElement).click();
        expect(triggerCommandMock).toHaveBeenCalledWith("jumpToNote");
        // Mobile path never shows recent notes.
        expect(note_autocomplete.showRecentNotes).not.toHaveBeenCalled();
    });
});

describe("WorkspaceSwitcher", () => {
    it("renders one entry per workspace note and hoists on click through the parent component", async () => {
        const ws1 = buildNote({ id: "wsA", title: "Workspace A" });
        const ws2 = buildNote({ id: "wsB", title: "Workspace B" });
        searchMock.mockResolvedValue([ ws1, ws2 ]);

        const parent = new Component();
        const triggerOnParent = vi.spyOn(parent, "triggerCommand").mockResolvedValue(undefined as never);

        const root = renderEmpty({ ntxId: "ntx1" }, parent);
        await flush();

        const notes = root.querySelectorAll(".workspace-note");
        expect(notes.length).toBe(2);
        expect(root.querySelectorAll(".workspace-icon").length).toBe(2);
        // Titles are rendered.
        expect(root.textContent).toContain("Workspace A");
        expect(root.textContent).toContain("Workspace B");

        (notes[1] as HTMLElement).click();
        expect(triggerOnParent).toHaveBeenCalledWith("hoistNote", { noteId: "wsB" });
    });

    it("renders no entries before/when the search resolves empty, and tolerates a missing parent", async () => {
        searchMock.mockResolvedValue([]);
        const root = renderEmpty({ ntxId: "ntx1" }, null);
        await flush();

        const switcher = root.querySelector(".workspace-notes");
        expect(switcher).toBeTruthy();
        expect(root.querySelectorAll(".workspace-note").length).toBe(0);
    });

    it("does not throw on click when there is no parent component", async () => {
        const ws1 = buildNote({ id: "wsSolo", title: "Solo" });
        searchMock.mockResolvedValue([ ws1 ]);
        const root = renderEmpty({ ntxId: "ntx1" }, null);
        await flush();

        const note = root.querySelector(".workspace-note");
        expect(note).toBeTruthy();
        expect(() => (note as HTMLElement).click()).not.toThrow();
    });
});
