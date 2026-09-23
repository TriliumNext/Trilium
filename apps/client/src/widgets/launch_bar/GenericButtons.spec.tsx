import { beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../entities/fnote";

const mocks = vi.hoisted(() => ({
    openInNewTab: vi.fn(),
    openInSameTab: vi.fn()
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

import { launchCustomNoteLauncher } from "./GenericButtons";

const { openInNewTab, openInSameTab } = mocks;
const launcherNote = { noteId: "_lbLauncher" } as FNote;

function launch(evt: Partial<MouseEvent>, targetNoteId: string | null = "n1", hoist?: string) {
    return launchCustomNoteLauncher(evt as MouseEvent, {
        launcherNote,
        getTargetNoteId: () => targetNoteId,
        getHoistedNoteId: hoist ? () => hoist : undefined
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
});
