import { RecentChangeRow } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        static getOrCreateInstance(el: Element) { return Tooltip.getInstance(el) ?? new Tooltip(el); }
        element: Element;
        constructor(el: Element) { this.element = el; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
        update() {}
    }
    class Modal {
        static getInstance() { return null; }
        static getOrCreateInstance() { return new Modal(); }
        show() {}
        hide() {}
        dispose() {}
    }
    return { Tooltip, Modal, default: { Tooltip, Modal } };
});

vi.mock("../../services/dialog", () => ({
    default: { confirm: vi.fn(async () => true) },
    openDialog: vi.fn(async ($el: unknown) => $el)
}));
vi.mock("../../services/toast", () => ({ default: { showMessage: vi.fn(), showPersistent: vi.fn(), closePersistent: vi.fn() } }));
vi.mock("../../services/link", () => ({
    default: {
        createLink: vi.fn(async (notePath: string, opts: { title?: string }) => {
            const $el = $(`<a class="reference-link" href="#${notePath}">${opts?.title ?? notePath}</a>`);
            return $el;
        })
    }
}));
vi.mock("../../services/hoisted_note", () => ({
    default: { getHoistedNoteId: vi.fn(() => "root") }
}));

import appContext from "../../components/app_context";
import Component from "../../components/component";
import dialog from "../../services/dialog";
import froca from "../../services/froca";
import hoisted_note from "../../services/hoisted_note";
import link from "../../services/link";
import server from "../../services/server";
import toast from "../../services/toast";
import ws from "../../services/ws";
import { buildNote } from "../../test/easy-froca";
import { ParentComponent } from "../react/react_utils";
import RecentChangesDialog from "./recent_changes";

// --- Render harness (full component inside the Trilium parent provider) ---------------------------

let container: HTMLDivElement | undefined;
let parent: Component | undefined;

function renderDialog() {
    const localParent = new Component();
    const localContainer = document.createElement("div");
    parent = localParent;
    container = localContainer;
    document.body.appendChild(localContainer);
    act(() => render(
        <ParentComponent.Provider value={localParent}>
            <RecentChangesDialog />
        </ParentComponent.Provider>,
        localContainer
    ));
    return localContainer;
}

function fireEvent(name: string, data: unknown) {
    act(() => { (parent?.handleEventInChildren as (n: string, d: unknown) => void)?.(name, data); });
}

async function flush() {
    // The dialog has a multi-step async effect chain (recent-changes fetch → froca preload →
    // group → createLink per item), so settle several macrotask cycles.
    for (let i = 0; i < 6; i++) {
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    }
}

function makeChange(overrides: Partial<RecentChangeRow> = {}): RecentChangeRow {
    return {
        noteId: "n1",
        current_isDeleted: false,
        current_deleteId: "",
        current_title: "A Note",
        current_isProtected: false,
        title: "A Note",
        utcDate: "2026-06-05 10:00:00.000Z",
        date: "2026-06-05 10:00:00.000Z",
        ...overrides
    };
}

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
    Object.assign(server, {
        get: vi.fn(async () => []),
        post: vi.fn(async () => undefined),
        put: vi.fn(async () => undefined)
    });
    Object.assign(ws, { waitForMaxKnownEntityChangeId: vi.fn(async () => undefined), logError: vi.fn() });
    // The component preloads notes via froca.getNotes(ids, true); for non-cached (deleted) notes
    // this would hit the (throwing) mock server. Stub it as a no-op so rendering relies purely on
    // notes already injected via easy-froca and getNoteFromCache.
    vi.spyOn(froca, "getNotes").mockImplementation(async () => []);
    (dialog.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (hoisted_note.getHoistedNoteId as ReturnType<typeof vi.fn>).mockReturnValue("root");
    (link.createLink as ReturnType<typeof vi.fn>).mockImplementation(
        async (notePath: string, opts: { title?: string }) => $(`<a class="reference-link" href="#${notePath}">${opts?.title ?? notePath}</a>`)
    );
});

afterEach(() => {
    if (container) { act(() => render(null, container ?? document.createElement("div"))); container.remove(); container = undefined; }
    vi.restoreAllMocks();
});

// --- Tests ---------------------------------------------------------------------------------------

describe("RecentChangesDialog — empty / structure", () => {
    it("renders the dialog shell and the no-changes placeholder when there are no changes", async () => {
        Object.assign(server, { get: vi.fn(async () => []) });
        const el = renderDialog();

        // Before the event is fired, no fetch occurs (ancestorNoteId is undefined).
        expect(server.get).not.toHaveBeenCalled();

        fireEvent("showRecentChanges", {});
        await flush();

        expect(el.querySelector(".recent-changes-dialog")).toBeTruthy();
        // Empty fetch result → grouped map is empty → timeline is not rendered.
        expect(el.querySelector(".recent-changes-content")).toBeTruthy();
        expect(el.querySelector(".recent-changes-content ul")).toBeNull();
        // Falls back to the hoisted note id when no ancestorNoteId is supplied.
        expect(hoisted_note.getHoistedNoteId).toHaveBeenCalled();
        expect(server.get).toHaveBeenCalledWith("recent-changes/root");
    });

    it("uses the provided ancestorNoteId in the fetch URL", async () => {
        buildNote({ id: "anc", title: "Ancestor" });
        Object.assign(server, { get: vi.fn(async () => []) });
        renderDialog();
        fireEvent("showRecentChanges", { ancestorNoteId: "anc" });
        await flush();
        expect(server.get).toHaveBeenCalledWith("recent-changes/anc");
        expect(hoisted_note.getHoistedNoteId).not.toHaveBeenCalled();
    });
});

describe("RecentChangesDialog — timeline rendering", () => {
    it("groups changes by day, renders the time and a note link for an existing note", async () => {
        buildNote({ id: "n1", title: "A Note", children: [] });
        // Ensure a best note path exists (so notePath is non-null and NoteLink is used).
        const root = buildNote({ id: "root", title: "Root", children: [ { id: "n1", title: "A Note" } ] });
        // The child note already exists; rebuild relationship by adding n1 under root.
        expect(root.noteId).toBe("root");

        const changes = [
            makeChange({ noteId: "n1", date: "2026-06-05 10:00:00.000Z", current_title: "A Note" }),
            makeChange({ noteId: "n1", date: "2026-06-05 11:30:00.000Z", current_title: "A Note" }),
            makeChange({ noteId: "n1", date: "2026-06-04 09:00:00.000Z", current_title: "A Note" })
        ];
        Object.assign(server, { get: vi.fn(async () => changes) });

        const el = renderDialog();
        fireEvent("showRecentChanges", { ancestorNoteId: "root" });
        await flush();

        // Two distinct days → two day groups (each is a <div> with a <b> header + <ul>).
        const dayHeaders = el.querySelectorAll(".recent-changes-content > div b");
        expect(dayHeaders.length).toBe(2);
        // Three list items overall (2 on day one, 1 on day two).
        const items = el.querySelectorAll(".recent-changes-content li");
        expect(items.length).toBe(3);
        // The notes were preloaded via froca.getNotes (one call per fetch).
        expect(froca.getNotes).toHaveBeenCalled();
        // createLink was invoked for the existing (non-deleted) note.
        expect(link.createLink).toHaveBeenCalled();
        // The rendered note link markup is injected via RawHtml.
        const noteTitle = el.querySelector("li .note-title");
        expect(noteTitle).toBeTruthy();
        // The time span carries the raw date as a title attribute (first item of first day group).
        const timeSpan = el.querySelector("li span[title]");
        expect(timeSpan?.getAttribute("title")).toBe("2026-06-05 10:00:00.000Z");
    });

    it("renders the plain-title fallback span before the async link resolves", async () => {
        buildNote({ id: "root", title: "Root", children: [ { id: "n1", title: "A Note" } ] });
        // Make createLink hang so the NoteLink falls back to the plain <span> branch.
        (link.createLink as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}));
        Object.assign(server, { get: vi.fn(async () => [ makeChange({ noteId: "n1", current_title: "Hang Title" }) ]) });

        const el = renderDialog();
        fireEvent("showRecentChanges", { ancestorNoteId: "root" });
        await flush();

        const span = el.querySelector("li span.note-title");
        expect(span?.textContent).toBe("Hang Title");
    });

    it("renders the deleted-note link branch (no note path) with the undelete anchor", async () => {
        // No froca note for n-deleted → getNoteFromCache returns undefined → DeletedNoteLink branch.
        Object.assign(server, {
            get: vi.fn(async () => [
                makeChange({ noteId: "nd", current_isDeleted: true, current_title: "Gone Note", date: "2026-06-05 08:00:00.000Z" })
            ])
        });
        const el = renderDialog();
        fireEvent("showRecentChanges", { ancestorNoteId: "root" });
        await flush();

        const li = el.querySelector("li.deleted-note");
        expect(li).toBeTruthy();
        expect(li?.querySelector(".note-title")?.textContent).toBe("Gone Note");
        // The undelete anchor is present.
        expect(li?.querySelector("a[href='javascript:']")).toBeTruthy();
    });

    it("uses the deleted-note branch even for a cached note when isDeleted is true", async () => {
        buildNote({ id: "root", title: "Root", children: [ { id: "n2", title: "Cached" } ] });
        Object.assign(server, {
            get: vi.fn(async () => [ makeChange({ noteId: "n2", current_isDeleted: true, current_title: "Cached Deleted" }) ])
        });
        const el = renderDialog();
        fireEvent("showRecentChanges", { ancestorNoteId: "root" });
        await flush();
        // Even though n2 is cached, isDeleted forces the DeletedNoteLink (no .note-title from RawHtml link).
        expect(el.querySelector("li.deleted-note a[href='javascript:']")).toBeTruthy();
        // createLink should NOT be used for the deleted branch.
        expect(link.createLink).not.toHaveBeenCalled();
    });
});

describe("RecentChangesDialog — erase deleted notes", () => {
    it("posts the erase request and shows a toast, refreshing the list", async () => {
        const getMock = vi.fn(async () => []);
        Object.assign(server, { get: getMock, post: vi.fn(async () => undefined) });
        const el = renderDialog();
        fireEvent("showRecentChanges", { ancestorNoteId: "root" });
        await flush();

        const initialGetCalls = getMock.mock.calls.length;
        const eraseBtn = el.querySelector(".modal-header button") as HTMLButtonElement | null;
        expect(eraseBtn).toBeTruthy();
        await act(async () => { eraseBtn?.click(); await Promise.resolve(); });
        await flush();

        expect(server.post).toHaveBeenCalledWith("notes/erase-deleted-notes-now");
        expect(toast.showMessage).toHaveBeenCalled();
        // Bumping refreshCounter re-runs the effect → another GET.
        expect(getMock.mock.calls.length).toBeGreaterThan(initialGetCalls);
    });
});

describe("RecentChangesDialog — undelete flow", () => {
    async function openDeleted() {
        Object.assign(server, {
            get: vi.fn(async () => [ makeChange({ noteId: "nd", current_isDeleted: true, current_title: "Restore Me" }) ]),
            put: vi.fn(async () => undefined)
        });
        const el = renderDialog();
        fireEvent("showRecentChanges", { ancestorNoteId: "root" });
        await flush();
        return el;
    }

    it("confirms, undeletes via server.put, waits for sync, and activates the note", async () => {
        const setNote = vi.fn();
        const getActiveContext = vi.fn(() => ({ setNote }));
        Object.assign(appContext, { tabManager: { ...appContext.tabManager, getActiveContext } });

        const el = await openDeleted();
        const undeleteLink = el.querySelector("li.deleted-note a[href='javascript:']") as HTMLAnchorElement | null;
        await act(async () => { undeleteLink?.click(); await Promise.resolve(); });
        await flush();

        expect(dialog.confirm).toHaveBeenCalled();
        expect(server.put).toHaveBeenCalledWith("notes/nd/undelete");
        expect(ws.waitForMaxKnownEntityChangeId).toHaveBeenCalled();
        expect(setNote).toHaveBeenCalledWith("nd");
    });

    it("does nothing when the confirm dialog is declined", async () => {
        (dialog.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(false);
        const el = await openDeleted();
        const undeleteLink = el.querySelector("li.deleted-note a[href='javascript:']") as HTMLAnchorElement | null;
        await act(async () => { undeleteLink?.click(); await Promise.resolve(); });
        await flush();

        expect(dialog.confirm).toHaveBeenCalled();
        expect(server.put).not.toHaveBeenCalled();
        expect(ws.waitForMaxKnownEntityChangeId).not.toHaveBeenCalled();
    });

    it("handles the case where there is no active context after undelete", async () => {
        const getActiveContext = vi.fn(() => null);
        Object.assign(appContext, { tabManager: { ...appContext.tabManager, getActiveContext } });

        const el = await openDeleted();
        const undeleteLink = el.querySelector("li.deleted-note a[href='javascript:']") as HTMLAnchorElement | null;
        await act(async () => { undeleteLink?.click(); await Promise.resolve(); });
        await flush();

        expect(server.put).toHaveBeenCalledWith("notes/nd/undelete");
        expect(getActiveContext).toHaveBeenCalled();
    });
});

describe("RecentChangesDialog — closing", () => {
    it("clears shown state when the modal hidden event fires", async () => {
        Object.assign(server, { get: vi.fn(async () => []) });
        const el = renderDialog();
        fireEvent("showRecentChanges", { ancestorNoteId: "root" });
        await flush();
        const modalEl = el.querySelector(".recent-changes-dialog") as HTMLElement | null;
        act(() => { modalEl?.dispatchEvent(new Event("hidden.bs.modal", { bubbles: true })); });
        await flush();
        // The dialog shell remains in the DOM; assert it didn't throw and is still present.
        expect(el.querySelector(".recent-changes-dialog")).toBeTruthy();
    });
});
