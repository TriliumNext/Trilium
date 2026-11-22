import { afterEach, describe, expect, it, vi } from "vitest";

import appContext from "../components/app_context";
import type NoteContext from "../components/note_context";
import type TabManager from "../components/tab_manager";
import protectedSessionHolder from "../services/protected_session_holder";
import { buildNote } from "../test/easy-froca";
import TabRowWidget from "./tab_row";

vi.mock("../services/i18n", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../services/i18n")>()),
    t: (key: string) => key
}));

describe("TabRowWidget.updateTabTitle", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    async function renderTitle(isUnlocked: boolean) {
        vi.spyOn(protectedSessionHolder, "isProtectedSessionAvailable").mockReturnValue(isUnlocked);
        const note = buildNote({ title: "Secret" });
        note.isProtected = true;
        const context = {
            note,
            ntxId: "ntx",
            getNavigationTitle: async () => note.title
        } as unknown as NoteContext;
        const $tab = $(`<div><div class="note-tab-title"></div></div>`);

        await new TabRowWidget().updateTabTitle($tab, [ context ], "ntx", false);
        return $tab;
    }

    it("shows Protected and a lock in caption and tooltip while locked", async () => {
        const $locked = await renderTitle(false);
        const $segment = $locked.find(".note-tab-segment");
        const label = $segment.find(".protected-title").text();
        expect(label).toBe("protected_session.locked_note_title");
        expect($segment.children().last().is(".protected-icon.bx-lock-alt")).toBe(true);
        expect($segment.text()).not.toContain("Secret");
        expect($locked.attr("data-tab-title")).toBe($segment.html());
        expect($segment.html()).toContain("bx-lock-alt");

        const $unlocked = await renderTitle(true);
        expect($unlocked.find(".note-tab-segment").text()).toBe("Secret");
        expect($unlocked.find(".protected-icon").length).toBe(0);
        expect($unlocked.attr("data-tab-title")).toBe("Secret");
    });
});

describe("TabRowWidget tab activation", () => {
    const originalTabManager = appContext.tabManager;

    afterEach(() => {
        appContext.tabManager = originalTabManager;
        document.body.replaceChildren();
    });

    it("switches on a mouse press and on the release of a touch", () => {
        const activateTabContext = vi.fn();
        const mainContexts: { ntxId: string }[] = [];
        appContext.tabManager = {
            activateTabContext,
            getMainNoteContexts: () => mainContexts
        } as unknown as TabManager;
        const widget = new TabRowWidget();
        document.body.append(widget.render()[0]);
        for (const ntxId of [ "mouse-tab", "touch-tab" ]) {
            mainContexts.push({ ntxId });
            widget.addTab(ntxId);
        }

        /** Presses and releases the tab, returning the activations made before the release. */
        const tap = (ntxId: string, pointerType: string, pointerId: number) => {
            const handle = widget.$widget
                .find(`.note-tab[data-ntx-id="${ntxId}"] .note-tab-drag-handle`)[0];
            expect(handle).toBeInstanceOf(HTMLElement);
            handle.dispatchEvent(new PointerEvent("pointerdown",
                { bubbles: true, pointerType, pointerId }));
            const pressed = [ ...activateTabContext.mock.calls ];
            window.dispatchEvent(new PointerEvent("pointerup", { pointerType, pointerId }));
            return pressed;
        };

        expect(tap("mouse-tab", "mouse", 1)).toEqual([ [ "mouse-tab" ] ]);
        expect(activateTabContext.mock.calls).toEqual([ [ "mouse-tab" ] ]);

        activateTabContext.mockClear();
        expect(tap("touch-tab", "touch", 2)).toEqual([]);
        expect(activateTabContext.mock.calls).toEqual([ [ "touch-tab" ] ]);
    });

    // Draggabilly listens to touch events alone where the window has `ontouchstart`, as on an iPad, whose
    // touchpad sends pointer and mouse events only. The stub hears none of them.
    it("switches on a touchpad press of an iPad", async () => {
        vi.resetModules();
        vi.doMock("draggabilly", () => ({
            default: class { on() {} destroy() {} }
        }));
        try {
            const { default: freshAppContext } = await import("../components/app_context");
            const { default: FreshTabRowWidget } = await import("./tab_row");
            const activateTabContext = vi.fn();
            freshAppContext.tabManager = {
                activateTabContext,
                getMainNoteContexts: () => [ { ntxId: "pad-tab" } ]
            } as unknown as TabManager;
            const widget = new FreshTabRowWidget();
            document.body.append(widget.render()[0]);
            widget.addTab("pad-tab");

            const handle = widget.$widget.find('.note-tab[data-ntx-id="pad-tab"] .note-tab-drag-handle')[0];
            expect(handle).toBeInstanceOf(HTMLElement);
            handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse", pointerId: 3 }));
            expect(activateTabContext.mock.calls).toEqual([ [ "pad-tab" ] ]);
        } finally {
            vi.doUnmock("draggabilly");
            document.body.replaceChildren();
        }
    });
});

describe("TabRowWidget context menus", () => {
    afterEach(() => {
        document.body.replaceChildren();
        vi.doUnmock("../menus/context_menu");
        vi.doUnmock("../menus/recent_changes_menu_items");
        vi.doUnmock("../services/search");
    });

    it("loads the menu modules only once a tab is right-clicked", async () => {
        // The spec's own static import of `tab_row` loaded the menus, so this one starts from fresh modules.
        vi.resetModules();
        const loaded = new Set<string>();
        const show = vi.fn();
        vi.doMock("../menus/context_menu", () => {
            loaded.add("context_menu");
            return { default: { show } };
        });
        vi.doMock("../menus/recent_changes_menu_items", () => {
            loaded.add("recent_changes_menu_items");
            return { getRecentChangesMenuItems: async () => [] };
        });
        vi.doMock("../services/search", () => {
            loaded.add("search");
            return { default: { searchForNotes: async () => [] } };
        });
        const { default: freshAppContext } = await import("../components/app_context");
        const { default: FreshTabRowWidget } = await import("./tab_row");

        const mainContexts = [ { ntxId: "tab", pinned: false, isEmpty: () => false } ];
        freshAppContext.tabManager = {
            getMainNoteContexts: () => mainContexts,
            noteContexts: mainContexts,
            recentlyClosedTabs: []
        } as unknown as TabManager;
        const widget = new FreshTabRowWidget();
        document.body.append(widget.render()[0]);
        widget.addTab("tab");
        expect([ ...loaded ]).toEqual([]);

        const tab = widget.$widget.find(`.note-tab[data-ntx-id="tab"]`)[0];
        expect(tab).toBeInstanceOf(HTMLElement);
        tab.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(show).toHaveBeenCalledOnce());
        expect([ ...loaded ]).toEqual([ "context_menu" ]);
        const titles = show.mock.calls[0][0].items.map((item: { title?: string }) => item.title);
        expect(titles).toContain("tab_row.close");

        await widget.showNewTabContextMenu(0, 0);
        expect(show).toHaveBeenCalledTimes(2);
        expect([ ...loaded ].sort()).toEqual([ "context_menu", "recent_changes_menu_items", "search" ]);
    });
});

describe("TabRowWidget tab restore", () => {
    const originalTabManager = appContext.tabManager;

    afterEach(() => {
        appContext.tabManager = originalTabManager;
        vi.restoreAllMocks();
    });

    it("shows the restored tabs together once their titles are set", async () => {
        const mainContexts = [ { ntxId: "first" }, { ntxId: "second" } ];
        appContext.tabManager = {
            tabsRestored: false,
            getMainNoteContexts: () => mainContexts
        } as unknown as TabManager;
        const widget = new TabRowWidget();
        widget.render();
        for (const { ntxId } of mainContexts) {
            widget.addTab(ntxId);
        }
        expect(widget.$widget.hasClass("tabs-restoring")).toBe(true);
        expect(widget.$widget.find(".note-tab").length).toBe(2);
        expect(widget.$widget.find(".note-tab-was-just-added").length).toBe(0);

        let finishTitles = () => {};
        const updateTab = vi.spyOn(widget, "updateTab").mockReturnValue(
            new Promise<void>((resolve) => { finishTitles = resolve; }));
        const restored = widget.tabsRestoredEvent();
        expect(updateTab.mock.calls.map(([ $tab ]) => $tab.attr("data-ntx-id")))
            .toEqual([ "first", "second" ]);
        expect(widget.$widget.hasClass("tabs-restoring")).toBe(true);

        finishTitles();
        await restored;
        expect(widget.$widget.hasClass("tabs-restoring")).toBe(false);

        (appContext.tabManager as { tabsRestored: boolean }).tabsRestored = true;
        const later = new TabRowWidget();
        later.render();
        expect(later.$widget.hasClass("tabs-restoring")).toBe(false);
    });

    it("shows the tabs restored before it was rendered, with the active one marked", async () => {
        const mainContexts = [ { ntxId: "first" }, { ntxId: "second" } ];
        appContext.tabManager = {
            tabsRestored: true,
            getMainNoteContexts: () => mainContexts,
            getActiveContext: () => mainContexts[1]
        } as unknown as TabManager;
        const widget = new TabRowWidget();
        widget.render();
        const updateTab = vi.spyOn(widget, "updateTab").mockResolvedValue(undefined);
        vi.spyOn(widget, "refreshTab").mockImplementation(() => {});

        await widget.showExistingTabs();

        expect(widget.$widget.find(".note-tab").toArray().map((tab) => tab.getAttribute("data-ntx-id")))
            .toEqual([ "first", "second" ]);
        expect(updateTab).toHaveBeenCalledTimes(2);
        expect(widget.getTabById("second").attr("active")).toBe("");
    });

    it("adds no second tab for one it heard of before showing the existing tabs", async () => {
        const mainContexts = [ { ntxId: "first" }, { ntxId: "second" } ];
        appContext.tabManager = {
            tabsRestored: true,
            getMainNoteContexts: () => mainContexts,
            getActiveContext: () => mainContexts[0]
        } as unknown as TabManager;
        const widget = new TabRowWidget();
        widget.render();
        vi.spyOn(widget, "updateTab").mockResolvedValue(undefined);
        vi.spyOn(widget, "refreshTab").mockImplementation(() => {});
        widget.newNoteContextCreatedEvent({ noteContext: mainContexts[0] as unknown as NoteContext });

        await widget.showExistingTabs();

        expect(widget.$widget.find(".note-tab").toArray().map((tab) => tab.getAttribute("data-ntx-id")))
            .toEqual([ "first", "second" ]);
    });
});
