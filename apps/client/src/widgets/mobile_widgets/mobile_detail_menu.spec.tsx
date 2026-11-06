import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import type NoteContext from "../../components/note_context";
import server from "../../services/server";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { NoteContextContext, ParentComponent } from "../react/react_utils";
import MobileDetailMenu from "./mobile_detail_menu";

vi.mock("../react/modal_focustrap", () => ({ suspendModalFocusTraps: () => () => {} }));

vi.mock("../../services/i18n", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/i18n")>()),
    t: (key: string, opts?: { count?: number }) => (
        opts?.count === undefined ? key : `${key}:${opts.count}`
    )
}));

vi.mock("../../services/keyboard_actions", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../services/keyboard_actions")>();
    return {
        ...original,
        default: { ...original.default, getAction: async () => ({ effectiveShortcuts: [] }) }
    };
});

describe("MobileDetailMenu", () => {
    it("counts a note's files and leaves merge history out of that count", async () => {
        const note = buildNote({ title: "Phone", type: "text", content: "<p>Hi</p>" });
        vi.spyOn(note, "getAttachments").mockResolvedValue([
            { role: "file" },
            { role: "mergeUndo" },
            { role: "mergeUndoBlob" }
        ] as never);
        vi.spyOn(server, "get").mockImplementation(async (url: string) => {
            if (url.includes("backlink-count")) {
                return { count: 0 };
            }
            return [];
        });
        const noteContext = {
            ntxId: "ntx-mobile",
            note,
            noteId: note.noteId,
            notePath: note.noteId,
            hoistedNoteId: "root",
            viewScope: { viewMode: "source" },
            isMainContext: () => true,
            getMainContext: () => ({ getSubContexts: () => [] })
        } as unknown as NoteContext;
        const container = renderInto(
            <ParentComponent.Provider value={new Component()}>
                <NoteContextContext.Provider value={noteContext}>
                    <MobileDetailMenu />
                </NoteContextContext.Provider>
            </ParentComponent.Provider>
        );

        await act(async () => {
            container.querySelector<HTMLButtonElement>("button")?.click();
        });
        await vi.waitFor(() => {
            expect(document.body.textContent).toContain("status_bar.attachments:1");
        });
    });
});
