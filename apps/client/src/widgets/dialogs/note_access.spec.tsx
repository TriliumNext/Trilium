import type { NoteAccessResponse } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
import Component from "../../components/component";
import froca from "../../services/froca";
import server from "../../services/server";
import tree from "../../services/tree";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import NoteAccessDialog from "./note_access";

vi.mock("../../services/i18n", () => ({
    t: (key: string) => key
}));

const access: NoteAccessResponse = {
    owner: { userId: "owner", username: "olivia", avatarHue: 10 },
    grants: [ { userId: "bob", username: "bob", avatarHue: 20, canWrite: false } ],
    users: [
        { userId: "bob", username: "bob", avatarHue: 20 },
        { userId: "carol", username: "carol", avatarHue: 30 }
    ]
};

describe("NoteAccessDialog", () => {
    let container: HTMLElement;
    let get: ReturnType<typeof vi.spyOn>;
    let put: ReturnType<typeof vi.spyOn>;
    let remove: ReturnType<typeof vi.spyOn>;
    let reloadNotes: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
        const host = new Component();
        get = vi.spyOn(server, "get").mockResolvedValue(access);
        put = vi.spyOn(server, "put").mockResolvedValue(undefined);
        remove = vi.spyOn(server, "remove").mockResolvedValue(undefined);
        vi.spyOn(tree, "getNoteTitle").mockResolvedValue("Project");
        reloadNotes = vi.spyOn(froca, "reloadNotes").mockResolvedValue(undefined);
        vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined);
        container = renderInto(
            <ParentComponent.Provider value={host}>
                <NoteAccessDialog />
            </ParentComponent.Provider>
        );
        await act(async () => {
            void host.handleEventInChildren("showNoteAccess", { noteId: "project", selectedOrActiveBranchIds: [] });
        });
    });

    async function click(element: Element | null | undefined) {
        if (!element) throw new Error("Nothing to click.");
        await act(async () => {
            element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
    }

    function buttonLabeled(scope: Element | null, text: string) {
        return [ ...scope?.querySelectorAll("button") ?? [] ].find((button) => button.textContent?.trim() === text);
    }

    it("lists the owner and the grants, offering only users without one", () => {
        expect(get).toHaveBeenCalledWith("notes/project/access");

        const rows = [ ...container.querySelectorAll(".note-access-row") ];
        expect(rows.map((row) => row.querySelector(".note-access-username")?.textContent)).toEqual([ "olivia", "bob" ]);
        expect(rows[0].querySelector(".note-access-owner-badge")).not.toBeNull();

        const options = [ ...container.querySelectorAll(".note-access-add-user option") ];
        expect(options.map((option) => option.textContent)).toEqual([ "carol" ]);
    });

    it("grants, changes and removes access", async () => {
        const add = container.querySelector(".note-access-add");
        await click(buttonLabeled(add, "note_access.can_edit"));
        await click(buttonLabeled(add, "note_access.add"));
        expect(put).toHaveBeenLastCalledWith("notes/project/access/carol", { canWrite: true });

        const bobRow = container.querySelectorAll(".note-access-row")[1];
        await click(buttonLabeled(bobRow, "note_access.can_edit"));
        expect(put).toHaveBeenLastCalledWith("notes/project/access/bob", { canWrite: true });

        await click(bobRow.querySelector(".note-access-remove"));
        expect(remove).toHaveBeenCalledWith("notes/project/access/bob");
        expect(get).toHaveBeenCalledTimes(4);
        // The tree's access icon follows each change.
        expect(reloadNotes).toHaveBeenCalledTimes(3);
        expect(reloadNotes).toHaveBeenLastCalledWith([ "project" ]);
    });
});
