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
        { userId: "carol", username: "carol", avatarHue: 30 },
        { userId: "dave", username: "dave", avatarHue: 40 }
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

    /** The rows of the user picker, which opens as a menu in the page's body. */
    async function openUserPicker() {
        await click(container.querySelector(".note-access-add-user .dropdown-toggle"));
        return pickerRows();
    }

    function pickerRows() {
        return [ ...document.body.querySelectorAll(".note-access-user-menu .dropdown-item") ];
    }

    const nameOf = (row: Element) => row.querySelector(".tn-menu-name")?.textContent;

    it("lists the owner and the grants, offering only users without one", async () => {
        expect(get).toHaveBeenCalledWith("notes/project/access");

        const rows = [ ...container.querySelectorAll(".note-access-row") ];
        expect(rows.map((row) => row.querySelector(".note-access-username")?.textContent)).toEqual([ "olivia", "bob" ]);
        expect(rows[0].querySelector(".note-access-owner-badge")).not.toBeNull();

        const toggle = container.querySelector(".note-access-add-user .dropdown-toggle");
        expect(toggle?.querySelector(".note-access-user-name")?.textContent).toBe("carol");
        expect(toggle?.querySelector(".user-avatar")).not.toBeNull();

        const rowsOffered = await openUserPicker();
        expect(rowsOffered.map(nameOf)).toEqual([ "carol", "dave" ]);
        expect(rowsOffered.every((row) => row.querySelector(".user-avatar"))).toBe(true);

        // Typing filters the users, keeping their avatars.
        const filter = document.body.querySelector<HTMLInputElement>(".note-access-user-menu input.tn-menu-filter-input");
        if (!filter) throw new Error("The picker has no filter.");
        await act(async () => {
            filter.value = "d";
            filter.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await vi.waitFor(() => expect(pickerRows().map(nameOf)).toEqual([ "dave" ]));
        expect(pickerRows()[0].querySelector(".user-avatar")).not.toBeNull();
    });

    it("grants, changes and removes access", async () => {
        const add = container.querySelector(".note-access-add");
        await click((await openUserPicker()).find((row) => row.textContent?.includes("dave")));
        expect(container.querySelector(".note-access-add-user .note-access-user-name")?.textContent).toBe("dave");
        await click(buttonLabeled(add, "note_access.can_edit"));
        await click(buttonLabeled(add, "note_access.add"));
        expect(put).toHaveBeenLastCalledWith("notes/project/access/dave", { canWrite: true });

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
