import { beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../entities/fnote";

const mocks = vi.hoisted(() => ({
    openInNewTab: vi.fn(),
    openInSameTab: vi.fn(),
    handleLinkContextMenuItem: vi.fn()
}));

vi.mock("../../components/app_context", () => ({
    default: {
        tabManager: {
            openInNewTab: mocks.openInNewTab,
            openInSameTab: mocks.openInSameTab,
            getActiveContext: () => ({ hoistedNoteId: "activeHoist" })
        }
    }
}));
vi.mock("../../menus/link_context_menu", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../menus/link_context_menu")>();
    return {
        default: { ...original.default, handleLinkContextMenuItem: mocks.handleLinkContextMenuItem }
    };
});

import { launchCustomNoteLauncher } from "./GenericButtons";

const { openInNewTab, openInSameTab, handleLinkContextMenuItem } = mocks;
const launcherNote = { noteId: "_lbLauncher" } as FNote;

function launch(
    evt: Partial<MouseEvent>, targetNoteId: string | null = "n1", hoist?: string, openMode?: string
) {
    return launchCustomNoteLauncher(evt as MouseEvent, {
        launcherNote,
        getTargetNoteId: () => targetNoteId,
        getHoistedNoteId: hoist ? () => hoist : undefined,
        getOpenMode: openMode !== undefined ? () => openMode : undefined
    });
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("launchCustomNoteLauncher", () => {
    it("opens a ctrl-click or a middle-click in a new tab after the active one", async () => {
        await launch({ which: 1, ctrlKey: true });
        expect(openInNewTab).toHaveBeenLastCalledWith("n1", "activeHoist", false, "afterCurrent");

        await launch({ which: 2 }, "n2", "launcherHoist");
        expect(openInNewTab).toHaveBeenLastCalledWith("n2", "launcherHoist", false, "afterCurrent");

        // Shift activates the new tab.
        await launch({ which: 2, shiftKey: true });
        expect(openInNewTab).toHaveBeenLastCalledWith("n1", "activeHoist", true, "afterCurrent");

        expect(openInNewTab).toHaveBeenCalledTimes(3);
        expect(openInSameTab).not.toHaveBeenCalled();
    });

    it("opens a plain click in the same tab, and ignores a right click or no target", async () => {
        await launch({ which: 1 });
        expect(openInSameTab).toHaveBeenCalledExactlyOnceWith("n1", "activeHoist");

        await launch({ which: 3 });
        await launch({ which: 1, ctrlKey: true }, null);
        expect(openInSameTab).toHaveBeenCalledTimes(1);
        expect(openInNewTab).not.toHaveBeenCalled();
    });

    it("opens a plain click in the open mode, but not a Ctrl or middle click", async () => {
        await launch({ which: 1 }, "n1", undefined, "newTab");
        expect(openInNewTab).toHaveBeenLastCalledWith("n1", "activeHoist", true, "afterCurrent");

        const evt = { which: 1 };
        for (const [ openMode, command ] of [
            [ "newSplit", "openNoteInNewSplit" ],
            [ "newWindow", "openNoteInNewWindow" ],
            [ "quickEdit", "openNoteInPopup" ]
        ]) {
            await launch(evt, "n1", "launcherHoist", openMode);
            expect(handleLinkContextMenuItem)
                .toHaveBeenLastCalledWith(command, evt, "n1", {}, "launcherHoist");
        }

        // `currentTab`, an unknown value and an empty one open the note in the current tab.
        for (const openMode of [ "currentTab", "newtab", "" ]) {
            await launch({ which: 1 }, "n1", undefined, openMode);
        }
        expect(openInSameTab).toHaveBeenCalledTimes(3);

        // Ctrl and the middle button still open a tab in the background.
        await launch({ which: 1, ctrlKey: true }, "n1", undefined, "quickEdit");
        await launch({ which: 2 }, "n1", undefined, "newWindow");
        expect(openInNewTab).toHaveBeenLastCalledWith("n1", "activeHoist", false, "afterCurrent");
        expect(openInNewTab).toHaveBeenCalledTimes(3);
        expect(handleLinkContextMenuItem).toHaveBeenCalledTimes(3);
    });
});
