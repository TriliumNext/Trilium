import { act } from "preact/test-utils";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapMock } from "../../test/mocks";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => bootstrapMock());
vi.mock("../../services/keyboard_actions", () => ({
    default: { getAction: vi.fn(async () => ({ effectiveShortcuts: [] })) },
    getActionSync: vi.fn(() => undefined)
}));
vi.mock("../../services/link", () => ({
    default: { parseNavigationStateFromUrl: vi.fn() }
}));
vi.mock("../../services/tree", () => ({
    default: { getNotePathTitle: vi.fn(async (p: string) => `title:${p}`) }
}));
vi.mock("../../menus/launcher_button_context_menu", () => ({
    showLauncherContextMenu: vi.fn()
}));
vi.mock("../../menus/context_menu", () => ({
    default: { show: vi.fn() }
}));

import contextMenu, { MenuCommandItem } from "../../menus/context_menu";
import { showLauncherContextMenu } from "../../menus/launcher_button_context_menu";
import froca from "../../services/froca";
import link from "../../services/link";
import tree from "../../services/tree";
import { buildNote } from "../../test/easy-froca";
import { renderComponent, resetFroca } from "../../test/render";
import HistoryNavigationButton, { handleHistoryContextMenu } from "./HistoryNavigation";

// --- Harness -------------------------------------------------------------------------------------

function renderButton(noteId: string, command: "backInNoteHistory" | "forwardInNoteHistory") {
    const note = froca.notes[noteId];
    return renderComponent(<HistoryNavigationButton launcherNote={note} command={command} />).container;
}

interface FakeNav {
    navigationLength: ReturnType<typeof vi.fn>;
    navigationGetAllEntries: ReturnType<typeof vi.fn>;
    navigationGetActiveIndex: ReturnType<typeof vi.fn>;
    navigationGoToIndex: ReturnType<typeof vi.fn>;
}

function installElectronNav(nav: Partial<FakeNav> = {}): FakeNav {
    const resolved: FakeNav = {
        navigationLength: nav.navigationLength ?? vi.fn(() => 0),
        navigationGetAllEntries: nav.navigationGetAllEntries ?? vi.fn(() => []),
        navigationGetActiveIndex: nav.navigationGetActiveIndex ?? vi.fn(() => 0),
        navigationGoToIndex: nav.navigationGoToIndex ?? vi.fn()
    };
    (window as unknown as Record<string, unknown>).electronApi = { navigation: resolved };
    return resolved;
}

const hadElectronApi = "electronApi" in window;

beforeEach(() => {
    resetFroca();
    vi.clearAllMocks();
    (tree.getNotePathTitle as ReturnType<typeof vi.fn>).mockImplementation(async (p: string) => `title:${p}`);
});

afterEach(() => {
    delete (window as unknown as Record<string, unknown>).electronApi;
});

// --- Component rendering --------------------------------------------------------------------------

describe("HistoryNavigationButton", () => {
    it("renders a launcher action button carrying the trigger command and the note icon/title", () => {
        buildNote({ id: "lb1", title: "Back", "#iconClass": "bx bx-left-arrow" });
        const root = renderButton("lb1", "backInNoteHistory");

        const btn = root.querySelector("button");
        expect(btn).not.toBeNull();
        expect(btn?.getAttribute("data-trigger-command")).toBe("backInNoteHistory");
        expect(btn?.className).toContain("launcher-button");
        // useLauncherIconAndTitle feeds the note's icon class onto the button.
        expect(btn?.className).toContain("bx-left-arrow");
    });

    it("right-click without electron API shows the launcher menu with no extra items", async () => {
        buildNote({ id: "lb2", title: "Fwd" });
        const root = renderButton("lb2", "forwardInNoteHistory");
        const btn = root.querySelector("button");

        await act(async () => {
            btn?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
            await Promise.resolve();
        });

        expect(showLauncherContextMenu).toHaveBeenCalledTimes(1);
        const call = (showLauncherContextMenu as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(call[2].extraItems).toEqual([]);
    });

    it("right-click with electron API forwards history items and routes onCommand to navigationGoToIndex", async () => {
        const nav = installElectronNav({
            navigationLength: vi.fn(() => 2),
            navigationGetAllEntries: vi.fn(() => [
                { url: "#root/a", title: "A" },
                { url: "#root/b", title: "B" }
            ]),
            navigationGetActiveIndex: vi.fn(() => 1)
        });
        (link.parseNavigationStateFromUrl as ReturnType<typeof vi.fn>).mockImplementation((url: string) => ({
            noteId: url.includes("a") ? "na" : "nb",
            notePath: url.slice(1)
        }));
        buildNote({ id: "na", title: "A" });
        buildNote({ id: "nb", title: "B" });
        buildNote({ id: "lb3", title: "Back" });

        const root = renderButton("lb3", "backInNoteHistory");
        const btn = root.querySelector("button");

        await act(async () => {
            btn?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
            await new Promise((r) => setTimeout(r, 0));
        });

        const call = (showLauncherContextMenu as ReturnType<typeof vi.fn>).mock.calls[0];
        const extraItems = call[2].extraItems as MenuCommandItem<string>[];
        expect(extraItems).toHaveLength(2);

        // Drive the onCommand callback the component passed.
        call[2].onCommand("0");
        expect(nav.navigationGoToIndex).toHaveBeenCalledWith(0);

        // Falsy command must not navigate.
        nav.navigationGoToIndex.mockClear();
        call[2].onCommand(undefined);
        expect(nav.navigationGoToIndex).not.toHaveBeenCalled();
    });
});

// --- handleHistoryContextMenu (drives getHistoryItems exhaustively) ------------------------------

describe("handleHistoryContextMenu", () => {
    function fakeMouseEvent() {
        const e = { preventDefault: vi.fn(), pageX: 11, pageY: 22 } as unknown as MouseEvent;
        return e;
    }

    it("returns early (no context menu) when navigation API is absent", async () => {
        // No electronApi installed -> api is undefined.
        const e = fakeMouseEvent();
        await handleHistoryContextMenu()(e);

        expect(e.preventDefault).toHaveBeenCalledTimes(1);
        expect(contextMenu.show).not.toHaveBeenCalled();
    });

    it("returns early when history has fewer than two entries", async () => {
        installElectronNav({ navigationLength: vi.fn(() => 1) });
        const e = fakeMouseEvent();
        await handleHistoryContextMenu()(e);
        expect(contextMenu.show).not.toHaveBeenCalled();
    });

    it("returns early when every entry is skipped (missing noteId / notePath)", async () => {
        installElectronNav({
            navigationLength: vi.fn(() => 2),
            navigationGetAllEntries: vi.fn(() => [
                { url: "x1", title: "X1" },
                { url: "x2", title: "X2" }
            ])
        });
        // First entry has no noteId, second has no notePath -> both skipped.
        (link.parseNavigationStateFromUrl as ReturnType<typeof vi.fn>)
            .mockReturnValueOnce({ notePath: "root/x1" })
            .mockReturnValueOnce({ noteId: "x2" });

        const e = fakeMouseEvent();
        await handleHistoryContextMenu()(e);
        expect(contextMenu.show).not.toHaveBeenCalled();
    });

    it("builds reversed items, marks the active index, attaches the cached icon, and navigates on select", async () => {
        const nav = installElectronNav({
            navigationLength: vi.fn(() => 3),
            navigationGetAllEntries: vi.fn(() => [
                { url: "#root/n0", title: "N0" },
                { url: "#root/n1", title: "N1" },
                { url: "#root/n2", title: "N2" }
            ]),
            navigationGetActiveIndex: vi.fn(() => 1)
        });
        (link.parseNavigationStateFromUrl as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
            const noteId = url.replace("#root/", "");
            return { noteId, notePath: `root/${noteId}` };
        });
        // Only n1 is in cache -> exercises both the cached-icon branch and the undefined branch.
        buildNote({ id: "n1", title: "N1", "#iconClass": "bx bx-star" });

        const e = fakeMouseEvent();
        await handleHistoryContextMenu()(e);

        expect(contextMenu.show).toHaveBeenCalledTimes(1);
        const opts = (contextMenu.show as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(opts.x).toBe(11);
        expect(opts.y).toBe(22);

        const items = opts.items as MenuCommandItem<string>[];
        // Reversed: indices 2,1,0 -> commands "2","1","0".
        expect(items.map((i) => i.command)).toEqual(["2", "1", "0"]);
        // Active index 1 -> that item is checked and disabled.
        const active = items.find((i) => i.command === "1");
        expect(active?.checked).toBe(true);
        expect(active?.enabled).toBe(false);
        // Cached note contributes an icon; uncached ones leave it undefined.
        expect(active?.uiIcon).toContain("bx-star");
        const inactive = items.find((i) => i.command === "0");
        expect(inactive?.checked).toBe(false);
        expect(inactive?.uiIcon).toBeUndefined();

        // selectMenuItemHandler parses the command and navigates.
        opts.selectMenuItemHandler({ command: "2" } as MenuCommandItem<string>);
        expect(nav.navigationGoToIndex).toHaveBeenCalledWith(2);

        // Item without a command must not navigate.
        nav.navigationGoToIndex.mockClear();
        opts.selectMenuItemHandler({ title: "x" } as MenuCommandItem<string>);
        expect(nav.navigationGoToIndex).not.toHaveBeenCalled();
    });

    it("caps the menu at HISTORY_LIMIT (20) items", async () => {
        const total = 25;
        const entries = Array.from({ length: total }, (_, i) => ({ url: `#root/h${i}`, title: `H${i}` }));
        installElectronNav({
            navigationLength: vi.fn(() => total),
            navigationGetAllEntries: vi.fn(() => entries),
            navigationGetActiveIndex: vi.fn(() => 0)
        });
        (link.parseNavigationStateFromUrl as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
            const noteId = url.replace("#root/", "");
            return { noteId, notePath: `root/${noteId}` };
        });

        const e = fakeMouseEvent();
        await handleHistoryContextMenu()(e);

        const opts = (contextMenu.show as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect((opts.items as MenuCommandItem<string>[]).length).toBe(20);
    });
});

afterAll(() => {
    if (!hadElectronApi) delete (window as unknown as Record<string, unknown>).electronApi;
});
