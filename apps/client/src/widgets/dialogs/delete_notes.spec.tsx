import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import DeleteNotesDialog from "./delete_notes";

const server = vi.hoisted(() => ({
    get: vi.fn(async () => []),
    post: vi.fn()
}));

vi.mock("../../services/i18n", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../services/i18n")>(),
    t: (key: string, opts?: { count?: number }) => (opts?.count !== undefined ? `${key}:${opts.count}` : key)
}));
vi.mock("../../services/server", () => ({ default: server }));
vi.mock("../react/NoteLink", () => ({
    default: ({ notePath }: { notePath: string }) => <span className="note-link">{notePath}</span>
}));

describe("DeleteNotesDialog", () => {
    it("lists the notes to be deleted as read-only chips", async () => {
        const noteIdsToBeDeleted = [ "n1", "n2", "n3", "n4", "n5", "n6", "n7" ];
        server.post.mockResolvedValue({ brokenRelations: [], noteIdsToBeDeleted });
        const host = new Component();
        const container = renderInto(
            <ParentComponent.Provider value={host}>
                <DeleteNotesDialog />
            </ParentComponent.Provider>
        );

        await act(async () => {
            await host.handleEventInChildren("showDeleteNotesDialog", {
                branchIdsToDelete: [ "b1" ], callback: vi.fn(), forceDeleteAllClones: false
            });
        });
        // The preview is requested once the dialog has taken the branches.
        for (let attempt = 0; attempt < 5; attempt++) {
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 1));
            });
        }
        expect(server.post).toHaveBeenCalledWith("delete-notes-preview", expect.anything());

        const chips = [ ...container.querySelectorAll(".delete-notes-dialog .note-chips .tn-chip .note-link") ];
        expect(chips.map((chip) => chip.textContent)).toStrictEqual([ "n1", "n2", "n3", "n4", "n5" ]);
        expect(container.querySelector(".note-chips .note-chips-more")?.textContent).toBe("note_chips.more:2");
        expect([ ...container.querySelectorAll<HTMLButtonElement>(".note-chips .tn-chip-remove") ].every((b) => b.disabled))
            .toBe(true);
    });
});
