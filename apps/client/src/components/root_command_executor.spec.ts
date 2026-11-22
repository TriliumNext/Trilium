import { beforeEach, describe, expect, it, vi } from "vitest";

import openService from "../services/open.js";
import utils from "../services/utils.js";
import { buildNote } from "../test/easy-froca.js";
import appContext from "./app_context.js";
import type NoteContext from "./note_context.js";
import RootCommandExecutor from "./root_command_executor.js";
import type TabManager from "./tab_manager.js";

describe("openNoteCustomCommand", () => {
    const executor = new RootCommandExecutor();

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("opens the command context's note with the application chooser", () => {
        const note = buildNote({ title: "Report", type: "file", mime: "application/pdf" });
        const contexts: Record<string, NoteContext> = { ntx1: { note } as NoteContext };
        appContext.tabManager = {
            getCommandContext: (ntxId?: string | null) => (ntxId ? contexts[ntxId] : undefined)
        } as unknown as TabManager;
        const openNoteCustom = vi.spyOn(openService, "openNoteCustom").mockResolvedValue(undefined);

        executor.openNoteCustomCommand({ ntxId: "ntx1" });
        expect(openNoteCustom).toHaveBeenCalledExactlyOnceWith(note.noteId);

        executor.openNoteCustomCommand({ ntxId: "missing" });
        expect(openNoteCustom).toHaveBeenCalledOnce();
    });
});

describe("showLaunchBarSubtreeCommand", () => {
    it("opens the launch bar of the layout in use, hoisted", async () => {
        vi.spyOn(utils, "getLaunchBarRootId").mockReturnValue("_lbRoot");
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined);

        await new RootCommandExecutor().showLaunchBarSubtreeCommand();
        expect(triggerCommand).toHaveBeenCalledExactlyOnceWith(
            "openInTreePopup", { noteIdOrPath: "_lbRoot", hoistedNoteId: "_lbRoot" });
    });
});
