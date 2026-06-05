import { OptionNames } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        config: unknown;
        constructor(el: Element, config?: unknown) { this.element = el; this.config = config; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    class Dropdown {
        static instances = new Map<Element, Dropdown>();
        static getOrCreateInstance(el: Element) {
            let inst = Dropdown.instances.get(el);
            if (!inst) { inst = new Dropdown(el); Dropdown.instances.set(el, inst); }
            return inst;
        }
        element: Element;
        constructor(el: Element) { this.element = el; }
        dispose() { Dropdown.instances.delete(this.element); }
        show() {}
        hide() {}
        update() {}
    }
    return { Tooltip, Dropdown, default: { Tooltip, Dropdown } };
});
vi.mock("../../services/clipboard_ext", () => ({
    copyText: vi.fn(() => true),
    copyTextWithToast: vi.fn()
}));
vi.mock("../../services/link", () => ({
    goToLinkExt: vi.fn()
}));
vi.mock("../../services/sync", () => ({ default: { syncNow: vi.fn() } }));
vi.mock("../../services/branches", () => ({ default: { cloneNoteToParentNote: vi.fn() } }));
vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    isElectron: vi.fn(() => false)
}));

import type NoteContext from "../../components/note_context";
import Component from "../../components/component";
import { copyTextWithToast } from "../../services/clipboard_ext";
import { goToLinkExt } from "../../services/link";
import options from "../../services/options";
import server from "../../services/server";
import ws from "../../services/ws";
import { isElectron } from "../../services/utils";
import { buildNote } from "../../test/easy-froca";
import froca from "../../services/froca";
import { NoteContextContext, ParentComponent } from "../react/react_utils";
import NoteBadges, { SaveStatusBadge } from "./NoteBadges";

// --- Render harness --------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let parent: Component | undefined;

function renderWithContext(vnode: preact.ComponentChild, noteContext: NoteContext | null) {
    const el = document.createElement("div");
    container = el;
    document.body.appendChild(el);
    const parentComponent = new Component();
    parent = parentComponent;
    act(() => render((
        <ParentComponent.Provider value={parentComponent}>
            <NoteContextContext.Provider value={noteContext}>
                {vnode}
            </NoteContextContext.Provider>
        </ParentComponent.Provider>
    ), el));
    return el;
}

async function flush() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

/** A minimal NoteContext-shaped object; only the fields the badges read are implemented. */
function fakeNoteContext(overrides: Record<string, unknown> = {}): NoteContext {
    return {
        ntxId: "ntx1",
        hoistedNoteId: "root",
        notePath: "root/note1",
        viewScope: { viewMode: "default" },
        getContextData: vi.fn(() => undefined),
        setContextData: vi.fn(),
        clearContextData: vi.fn(),
        isReadOnly: vi.fn(async () => false),
        ...overrides
    } as unknown as NoteContext;
}

function setOptions(values: Record<string, string>) {
    options.load(values as Record<OptionNames, string>);
}

beforeEach(() => {
    setOptions({});
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
    Object.assign(server, { put: vi.fn(async () => undefined), upload: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) });
    Object.assign(ws, { logError: vi.fn() });
    (isElectron as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const tooltipPlugin = vi.fn();
    Object.assign(($.fn as unknown as Record<string, unknown>), { tooltip: tooltipPlugin });
});

afterEach(async () => {
    await act(async () => {});
    if (container) { render(null, container); container.remove(); container = undefined; }
    parent = undefined;
    vi.restoreAllMocks();
});

// --- The container ---------------------------------------------------------------------------------

describe("NoteBadges", () => {
    it("renders the badge container even with no note", () => {
        const root = renderWithContext(<NoteBadges />, fakeNoteContext({ note: undefined }));
        expect(root.querySelector(".note-badges")).toBeTruthy();
        // Nothing applicable → no individual badges rendered.
        expect(root.querySelector(".ext-badge")).toBeNull();
    });

    it("renders without a note context at all (null provider)", () => {
        const root = renderWithContext(<NoteBadges />, null);
        expect(root.querySelector(".note-badges")).toBeTruthy();
    });
});

// --- ReadOnlyBadge ---------------------------------------------------------------------------------

describe("ReadOnlyBadge", () => {
    it("shows the auto read-only badge for a read-only note and toggles editing on click", async () => {
        const note = buildNote({ id: "roAuto", title: "RO" });
        const noteContext = fakeNoteContext({ note, isReadOnly: vi.fn(async () => true) });
        const root = renderWithContext(<NoteBadges />, noteContext);
        await flush();

        const badge = root.querySelector(".read-only-badge");
        expect(badge).toBeTruthy();
        expect(badge?.querySelector(".bx-lock-alt")).toBeTruthy();
        expect(badge?.classList.contains("clickable")).toBe(true);

        (badge as HTMLElement | null)?.click();
        // enableEditing flips the temporary toggle → badge becomes the "temporarily editable" one.
        await flush();
        const tempBadge = root.querySelector(".temporarily-editable-badge");
        expect(tempBadge).toBeTruthy();
        expect(tempBadge?.querySelector(".bx-lock-open-alt")).toBeTruthy();

        // Clicking the temporarily-editable badge calls enableEditing(false).
        (tempBadge as HTMLElement | null)?.click();
        await flush();
    });

    it("shows the explicit read-only badge when the note carries the readOnly label", async () => {
        const note = buildNote({ id: "roExplicit", title: "RO", "#readOnly": "true" });
        const noteContext = fakeNoteContext({ note, isReadOnly: vi.fn(async () => true) });
        const root = renderWithContext(<NoteBadges />, noteContext);
        await flush();
        expect(root.querySelector(".read-only-badge .bx-lock-alt")).toBeTruthy();
    });

    it("renders no read-only badge when the note is editable", async () => {
        const note = buildNote({ id: "editable", title: "E" });
        const noteContext = fakeNoteContext({ note, isReadOnly: vi.fn(async () => false) });
        const root = renderWithContext(<NoteBadges />, noteContext);
        await flush();
        expect(root.querySelector(".read-only-badge")).toBeNull();
        expect(root.querySelector(".temporarily-editable-badge")).toBeNull();
    });
});

// --- ShareBadge ------------------------------------------------------------------------------------

describe("ShareBadge", () => {
    it("renders a share badge with copy/open/unshare actions when the note is under _share", async () => {
        buildNote({ id: "_share", title: "Shared root", children: [ { id: "sharedNote", title: "S" } ] });
        const note = froca.notes["sharedNote"];
        const noteContext = fakeNoteContext({ note });
        const root = renderWithContext(<NoteBadges />, noteContext);
        await flush();

        const badge = root.querySelector(".share-badge");
        expect(badge).toBeTruthy();

        // Open the dropdown so its (lazily-rendered) list items mount.
        const dropdownContainer = root.querySelector(".dropdown-badge");
        expect(dropdownContainer).toBeTruthy();
        act(() => { if (dropdownContainer) $(dropdownContainer).trigger("show.bs.dropdown"); });

        const items = root.querySelectorAll(".dropdown-item");
        expect(items.length).toBeGreaterThanOrEqual(3);

        const copyItem = root.querySelector(".bx-copy");
        copyItem?.closest<HTMLElement>(".dropdown-item")?.click();
        expect(copyTextWithToast).toHaveBeenCalled();

        const openItem = root.querySelector(".bx-link-external");
        openItem?.closest<HTMLElement>(".dropdown-item")?.click();
        expect(goToLinkExt).toHaveBeenCalled();

        const unshareItem = root.querySelector(".bx-unlink");
        unshareItem?.closest<HTMLElement>(".dropdown-item")?.click();
    });

    it("uses the world icon when shared externally (electron + sync host)", async () => {
        (isElectron as ReturnType<typeof vi.fn>).mockReturnValue(true);
        setOptions({ syncServerHost: "https://example.com" });
        buildNote({ id: "_share", title: "Shared root", children: [ { id: "sharedExt", title: "S" } ] });
        const note = froca.notes["sharedExt"];
        const root = renderWithContext(<NoteBadges />, fakeNoteContext({ note }));
        await flush();
        expect(root.querySelector(".share-badge .bx-world")).toBeTruthy();
    });

    it("uses the local share icon when not shared externally (electron, no sync host)", async () => {
        (isElectron as ReturnType<typeof vi.fn>).mockReturnValue(true);
        setOptions({});
        buildNote({ id: "_share", title: "Shared root", children: [ { id: "sharedLocal", title: "S" } ] });
        const note = froca.notes["sharedLocal"];
        const root = renderWithContext(<NoteBadges />, fakeNoteContext({ note }));
        await flush();
        expect(root.querySelector(".share-badge .bx-share-alt")).toBeTruthy();
    });

    it("renders no share badge when the note is not shared", async () => {
        const note = buildNote({ id: "notShared", title: "N" });
        const root = renderWithContext(<NoteBadges />, fakeNoteContext({ note }));
        await flush();
        expect(root.querySelector(".share-badge")).toBeNull();
    });
});

// --- ClippedNoteBadge ------------------------------------------------------------------------------

describe("ClippedNoteBadge", () => {
    it("renders a clipped-note badge linking to the pageUrl label", async () => {
        const note = buildNote({ id: "clipped", title: "C", "#pageUrl": "https://clipped.example" });
        const root = renderWithContext(<NoteBadges />, fakeNoteContext({ note }));
        await flush();

        const badge = root.querySelector(".clipped-note-badge");
        expect(badge).toBeTruthy();
        expect(badge?.querySelector(".bx-globe")).toBeTruthy();
        expect(badge?.querySelector("a")?.getAttribute("href")).toBe("https://clipped.example");
    });

    it("renders a doc-url badge for a help note with a docUrl label", async () => {
        const note = buildNote({ id: "_helpDoc", title: "Help", "#docUrl": "https://docs.example" });
        const root = renderWithContext(<NoteBadges />, fakeNoteContext({ note }));
        await flush();

        const badge = root.querySelector(".doc-url-badge");
        expect(badge).toBeTruthy();
        expect(badge?.querySelector(".bx-file-find")).toBeTruthy();
        expect(badge?.querySelector("a")?.getAttribute("href")).toBe("https://docs.example");
        expect(root.querySelector(".clipped-note-badge")).toBeNull();
    });

    it("renders no clipped badge without a url label", async () => {
        const note = buildNote({ id: "noUrl", title: "N" });
        const root = renderWithContext(<NoteBadges />, fakeNoteContext({ note }));
        await flush();
        expect(root.querySelector(".clipped-note-badge")).toBeNull();
        expect(root.querySelector(".doc-url-badge")).toBeNull();
    });
});

// --- ExecuteBadge ----------------------------------------------------------------------------------

describe("ExecuteBadge", () => {
    it("renders an execute-script badge for a JS code note and triggers runActiveNote on click", async () => {
        const note = buildNote({ id: "scriptNote", title: "Script", type: "code", "#executeButton": "true" });
        Object.assign(note, { mime: "application/javascript;env=frontend" });
        const noteContext = fakeNoteContext({ note });
        const root = renderWithContext(<NoteBadges />, noteContext);
        await flush();

        const badge = root.querySelector(".execute-badge");
        expect(badge).toBeTruthy();
        expect(badge?.querySelector(".bx-play")).toBeTruthy();

        const triggerCommand = vi.spyOn(parent ?? new Component(), "triggerCommand").mockReturnValue(undefined);
        (badge as HTMLElement | null)?.click();
        expect(triggerCommand).toHaveBeenCalledWith("runActiveNote");
    });

    it("renders an execute-sql badge for an SQLite note with executeDescription", async () => {
        const note = buildNote({ id: "sqlNote", title: "SQL", type: "code", "#executeDescription": "Run it" });
        Object.assign(note, { mime: "text/x-sqlite;schema=trilium" });
        const root = renderWithContext(<NoteBadges />, fakeNoteContext({ note }));
        await flush();
        expect(root.querySelector(".execute-badge .bx-play")).toBeTruthy();
    });

    it("renders an execute-sql badge using the default SQL tooltip (no description)", async () => {
        const note = buildNote({ id: "sqlNoDesc", title: "SQL", type: "code", "#executeButton": "true" });
        Object.assign(note, { mime: "text/x-sqlite;schema=trilium" });
        const root = renderWithContext(<NoteBadges />, fakeNoteContext({ note }));
        await flush();
        expect(root.querySelector(".execute-badge .bx-play")).toBeTruthy();
    });

    it("renders no execute badge for a non-executable note", async () => {
        const note = buildNote({ id: "plain", title: "P", "#executeButton": "true" });
        const root = renderWithContext(<NoteBadges />, fakeNoteContext({ note }));
        await flush();
        expect(root.querySelector(".execute-badge")).toBeNull();
    });

    it("renders no execute badge for an executable note without description/button", async () => {
        const note = buildNote({ id: "scriptNoFlag", title: "S", type: "code" });
        Object.assign(note, { mime: "application/javascript;env=backend" });
        const root = renderWithContext(<NoteBadges />, fakeNoteContext({ note }));
        await flush();
        expect(root.querySelector(".execute-badge")).toBeNull();
    });
});

// --- SaveStatusBadge -------------------------------------------------------------------------------

describe("SaveStatusBadge", () => {
    function renderSaveBadge(saveState: unknown) {
        const noteContext = fakeNoteContext({ getContextData: vi.fn((key: string) => key === "saveState" ? saveState : undefined) });
        return renderWithContext(<SaveStatusBadge />, noteContext);
    }

    it("shows the initial save state and survives the debounce timer", () => {
        vi.useFakeTimers();
        try {
            const root = renderSaveBadge({ state: "saved" });
            // The initial useState value is the current saveState, so the badge renders immediately.
            const badge = root.querySelector(".save-status-badge");
            expect(badge).toBeTruthy();
            expect(badge?.classList.contains("saved")).toBe(true);
            expect(badge?.querySelector(".bx-check")).toBeTruthy();
            // Letting the debounce timer fire re-applies the same state without disappearing.
            act(() => { vi.advanceTimersByTime(200); });
            expect(root.querySelector(".save-status-badge")).toBeTruthy();
        } finally {
            vi.useRealTimers();
        }
    });

    it("maps each save state to its icon", () => {
        for (const [ state, iconClass ] of [
            [ "saving", "bx-loader" ],
            [ "unsaved", "bx-pencil" ],
            [ "error", "bxs-error" ]
        ] as const) {
            vi.useFakeTimers();
            try {
                const root = renderSaveBadge({ state });
                act(() => { vi.advanceTimersByTime(200); });
                const badge = root.querySelector(".save-status-badge");
                expect(badge?.classList.contains(state)).toBe(true);
                expect(badge?.querySelector(`.${iconClass}`)).toBeTruthy();
            } finally {
                vi.useRealTimers();
            }
            if (container) { render(null, container); container.remove(); container = undefined; }
        }
    });

    it("renders nothing when there is no save state", () => {
        vi.useFakeTimers();
        try {
            const root = renderSaveBadge(undefined);
            act(() => { vi.advanceTimersByTime(200); });
            expect(root.querySelector(".save-status-badge")).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });
});
