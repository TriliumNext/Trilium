import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContextMenuEvent } from "./context_menu";

const mocks = vi.hoisted(() => ({
    show: vi.fn(),
    triggerCommand: vi.fn(),
    openContextWithNote: vi.fn(),
    isMobile: vi.fn(() => false),
    isDesktop: vi.fn(() => true),
    getClosestNtxId: vi.fn((): string | null => null),
    /** The splits of the active tab, which decide the "new split" vs "other split" wording. */
    subContexts: [ { ntxId: "ntx-first" }, { ntxId: "ntx-last" } ] as { ntxId: string }[],
    activeNtxId: "ntx-active" as string | null,
    /** False when no tab is open at all, which leaves both the hoisting and the split unresolvable. */
    hasActiveContext: true
}));

vi.mock("./context_menu", () => ({ default: { show: mocks.show } }));

vi.mock("../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("../services/utils", () => ({
    default: { isDesktop: mocks.isDesktop },
    isMobile: mocks.isMobile
}));

vi.mock("../widgets/widget_utils", () => ({ getClosestNtxId: mocks.getClosestNtxId }));

vi.mock("../components/app_context", () => ({
    default: {
        triggerCommand: mocks.triggerCommand,
        tabManager: {
            get activeNtxId() {
                return mocks.activeNtxId;
            },
            openContextWithNote: mocks.openContextWithNote,
            getActiveContext: () => mocks.hasActiveContext
                ? { hoistedNoteId: "hoistedNote", getSubContexts: () => mocks.subContexts }
                : undefined,
            getNoteContextById: () => ({
                getMainContext: () => ({ getSubContexts: () => mocks.subContexts })
            })
        }
    }
}));

import linkContextMenu from "./link_context_menu";

const VIEW_SCOPE = { viewMode: "attachments" as const, attachmentId: "att-1" };

function contextMenuEvent(target?: HTMLElement) {
    return { pageX: 12, pageY: 34, target } as unknown as ContextMenuEvent;
}

function handle(command: string | undefined, viewScope = {}, hoistedNoteId: string | null = null) {
    return linkContextMenu.handleLinkContextMenuItem(command, contextMenuEvent(), "root/n1", viewScope, hoistedNoteId);
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.isMobile.mockReturnValue(false);
    mocks.isDesktop.mockReturnValue(true);
    mocks.getClosestNtxId.mockReturnValue(null);
    mocks.subContexts = [ { ntxId: "ntx-first" }, { ntxId: "ntx-last" } ];
    mocks.activeNtxId = "ntx-active";
    mocks.hasActiveContext = true;
});

describe("getItems", () => {
    it("offers the four ways of opening a link, the split one worded for the layout", () => {
        const items = linkContextMenu.getItems(contextMenuEvent());

        expect(items.map((item) => "command" in item && item.command)).toEqual([
            "openNoteInNewTab", "openNoteInNewSplit", "openNoteInNewWindow", "openNoteInPopup"
        ]);
        // On the desktop the split always opens beside the current one.
        expect(items[1]).toMatchObject({ title: "link_context_menu.open_note_in_new_split" });

        // On mobile a tab holds one split at a time, so with one already open the link goes to the
        // *other* split rather than to a new one.
        mocks.isMobile.mockReturnValue(true);
        expect(linkContextMenu.getItems(contextMenuEvent())[1])
            .toMatchObject({ title: "link_context_menu.open_note_in_other_split" });

        mocks.subContexts = [ { ntxId: "ntx-only" } ];
        expect(linkContextMenu.getItems(contextMenuEvent())[1])
            .toMatchObject({ title: "link_context_menu.open_note_in_new_split" });
    });
});

describe("handleLinkContextMenuItem", () => {
    it("opens a new tab under the given hoisting, falling back to the active context's", () => {
        expect(handle("openNoteInNewTab", VIEW_SCOPE, "explicitHoist")).toBe(true);
        expect(mocks.openContextWithNote).toHaveBeenCalledWith("root/n1", {
            hoistedNoteId: "explicitHoist",
            viewScope: VIEW_SCOPE
        });

        handle("openNoteInNewTab");
        expect(mocks.openContextWithNote).toHaveBeenLastCalledWith("root/n1", {
            hoistedNoteId: "hoistedNote",
            viewScope: {}
        });
    });

    it("opens a split beside the last one, a window, and the popup — all carrying the view scope", () => {
        expect(handle("openNoteInNewSplit", VIEW_SCOPE)).toBe(true);
        expect(mocks.triggerCommand).toHaveBeenLastCalledWith("openNewNoteSplit", {
            ntxId: "ntx-last",
            notePath: "root/n1",
            hoistedNoteId: "hoistedNote",
            viewScope: VIEW_SCOPE
        });

        expect(handle("openNoteInNewWindow", VIEW_SCOPE)).toBe(true);
        expect(mocks.triggerCommand).toHaveBeenLastCalledWith("openInWindow", {
            notePath: "root/n1",
            hoistedNoteId: "hoistedNote",
            viewScope: VIEW_SCOPE
        });

        // The view scope is what lets the popup show an attachment rather than its owning note.
        expect(handle("openNoteInPopup", VIEW_SCOPE)).toBe(true);
        expect(mocks.triggerCommand).toHaveBeenLastCalledWith("openInPopup", {
            noteIdOrPath: "root/n1",
            viewScope: VIEW_SCOPE
        });
    });

    it("does nothing for a command it does not own, or a split with no context to open into", () => {
        expect(handle("someOtherCommand")).toBe(false);
        expect(handle(undefined)).toBe(false);

        // Nothing to resolve a context from: no pane under the pointer and no active tab either.
        mocks.isDesktop.mockReturnValue(false);
        mocks.activeNtxId = null;
        expect(handle("openNoteInNewSplit")).toBe(false);
        expect(mocks.triggerCommand).not.toHaveBeenCalled();
    });

    it("opens with no hoisting, and no split at all, when there is no tab open", () => {
        mocks.hasActiveContext = false;

        expect(handle("openNoteInNewTab")).toBe(true);
        expect(mocks.openContextWithNote).toHaveBeenCalledWith("root/n1", {
            hoistedNoteId: null,
            viewScope: {}
        });

        // On the desktop the split is resolved from that same missing tab.
        expect(handle("openNoteInNewSplit")).toBe(false);
        expect(mocks.triggerCommand).not.toHaveBeenCalled();
    });

    it("resolves the split from the event's own pane on mobile, and from the active tab otherwise", () => {
        mocks.isDesktop.mockReturnValue(false);
        mocks.getClosestNtxId.mockReturnValue("ntx-from-dom");
        const event = contextMenuEvent(document.createElement("div"));

        linkContextMenu.handleLinkContextMenuItem("openNoteInNewSplit", event, "root/n1");
        expect(mocks.triggerCommand).toHaveBeenLastCalledWith("openNewNoteSplit",
            expect.objectContaining({ ntxId: "ntx-from-dom" }));

        // Outside any note-context DOM (e.g. the mobile sidebar) the active context stands in.
        mocks.getClosestNtxId.mockReturnValue(null);
        linkContextMenu.handleLinkContextMenuItem("openNoteInNewSplit", event, "root/n1");
        expect(mocks.triggerCommand).toHaveBeenLastCalledWith("openNewNoteSplit",
            expect.objectContaining({ ntxId: "ntx-active" }));
    });
});

describe("openContextMenu", () => {
    it("shows the menu at the pointer and routes the chosen item with the link's own state", () => {
        linkContextMenu.openContextMenu("root/n1", contextMenuEvent(), VIEW_SCOPE, "explicitHoist");

        const shown = mocks.show.mock.calls[0][0];
        expect(shown).toMatchObject({ x: 12, y: 34 });
        expect(shown.items).toHaveLength(4);

        shown.selectMenuItemHandler({ command: "openNoteInPopup" });
        expect(mocks.triggerCommand).toHaveBeenCalledWith("openInPopup", {
            noteIdOrPath: "root/n1",
            viewScope: VIEW_SCOPE
        });
    });
});
