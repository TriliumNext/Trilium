import { describe, expect, it } from "vitest";

import { getBecca, warmBeccaForUser } from "../becca/becca.js";
import Becca from "../becca/becca-interface.js";
import { loadBeccaForUser } from "../becca/becca_loader.js";
import cloningService from "./cloning.js";
import * as cls from "./context.js";
import noteService from "./notes.js";
import { getSql } from "./sql/index.js";
import treeService from "./tree.js";
import userHomes, { getHomeNoteId, USERS_NOTE_ID } from "./user_homes.js";
import userService from "./user_service.js";

describe("user homes", () => {
    it("creates nothing while the primary admin is the only user", () => {
        const adminId = cls.init(() => userService.getAdminUserId());
        getSql().execute("UPDATE users SET isDeleted = 1 WHERE userId != ?", [ adminId ]);

        cls.init(() => userHomes.ensureUserHomes());

        expect(getBecca().getNote(USERS_NOTE_ID)).toBeNull();
    });

    it("gives every other user a home under the admin-owned Users note", () => {
        const adminId = cls.init(() => userService.getAdminUserId());
        const memberId = cls.init(() => userService.createUser("home-member-spec", null, false));
        const otherAdminId = cls.init(() => userService.createUser("home-admin-spec", null, true));

        cls.init(() => userHomes.ensureUserHomes());

        const usersNote = getBecca().getNoteOrThrow(USERS_NOTE_ID);
        expect(usersNote.ownerId).toBe(adminId);
        expect(usersNote.getParentNotes().map((parent) => parent.noteId)).toEqual([ "root" ]);

        const memberHome = getBecca().getNoteOrThrow(getHomeNoteId(memberId));
        expect(memberHome).toMatchObject({ title: "home-member-spec", ownerId: memberId });
        expect(memberHome.getParentNotes().map((parent) => parent.noteId)).toEqual([ USERS_NOTE_ID ]);
        expect(getBecca().getNote(getHomeNoteId(otherAdminId))?.ownerId).toBe(otherAdminId);
        expect(getBecca().getNote(getHomeNoteId(adminId))).toBeNull();

        // A second pass, as on every startup, finds nothing to add.
        const childCount = usersNote.getChildNotes().length;
        cls.init(() => userHomes.ensureUserHomes());
        expect(usersNote.getChildNotes()).toHaveLength(childCount);
    });

    it("renames a home along with its user", () => {
        const memberId = cls.init(() => userService.createUser("home-rename-spec", null, false));
        cls.init(() => userHomes.ensureUserHome(memberId, "home-rename-spec"));

        cls.init(() => userHomes.renameUserHome(memberId, "home-renamed-spec"));

        expect(getBecca().getNoteOrThrow(getHomeNoteId(memberId)).title).toBe("home-renamed-spec");
    });

    it("shows a member their own home at the top level and hides everyone else's notes", async () => {
        const memberId = cls.init(() => userService.createUser("home-view-spec", null, false));
        const otherId = cls.init(() => userService.createUser("home-view-other-spec", null, false));
        const memberHome = cls.init(() => userHomes.ensureUserHome(memberId, "home-view-spec"));
        cls.init(() => userHomes.ensureUserHome(otherId, "home-view-other-spec"));
        const adminNote = cls.init(() => noteService.createNewNote({
            parentNoteId: "root", title: "home-view-admin-note", content: "", type: "text"
        }).note);
        const memberNote = cls.init(() => noteService.createNewNote({
            parentNoteId: memberHome.noteId, title: "home-view-member-note", content: "", type: "text"
        }).note);

        const memberBecca = new Becca();
        await cls.init(() => {
            cls.set("userId", memberId);
            return loadBeccaForUser(memberBecca, memberId, false);
        });

        const homeBranch = memberBecca.getBranchFromChildAndParent(memberHome.noteId, "root");
        expect(homeBranch?.isVirtual).toBe(true);
        expect(memberBecca.notes[memberNote.noteId]).toBeDefined();
        expect(memberBecca.notes._hidden).toBeDefined();
        expect(memberBecca.notes[USERS_NOTE_ID]).toBeUndefined();
        expect(memberBecca.notes[getHomeNoteId(otherId)]).toBeUndefined();
        expect(memberBecca.notes[adminNote.noteId]).toBeUndefined();
    });

    it("creates a user's top-level notes in their home, but the primary admin's under root", async () => {
        const memberId = cls.init(() => userService.createUser("home-create-spec", null, false));
        const memberHome = cls.init(() => userHomes.ensureUserHome(memberId, "home-create-spec"));

        const [ intoRoot, afterHome ] = await asUser(memberId, () => [
            noteService.createNewNote({ parentNoteId: "root", title: "into root", content: "", type: "text" }).note,
            noteService.createNewNoteWithTarget("after", `root_${memberHome.noteId}`, {
                parentNoteId: "root", title: "after home", content: ""
            }).note
        ]);
        expect(intoRoot.getParentNotes().map((parent) => parent.noteId)).toEqual([ memberHome.noteId ]);
        expect(afterHome.getParentNotes().map((parent) => parent.noteId)).toEqual([ memberHome.noteId ]);

        const adminNote = cls.init(() => noteService.createNewNote({
            parentNoteId: "root", title: "admin into root", content: "", type: "text"
        }).note);
        expect(adminNote.getParentNotes().map((parent) => parent.noteId)).toEqual([ "root" ]);
    });

    it("refuses to move or clone a user's note to the top level", async () => {
        const memberId = cls.init(() => userService.createUser("home-move-spec", null, false));
        const memberHome = cls.init(() => userHomes.ensureUserHome(memberId, "home-move-spec"));
        const note = cls.init(() => noteService.createNewNote({
            parentNoteId: memberHome.noteId, ownerId: memberId, title: "movable", content: "", type: "text"
        }).note);

        const [ move, clone ] = await asUser(memberId, () => [
            treeService.validateParentChild("root", note.noteId),
            cloningService.cloneNoteToParentNote(note.noteId, "root")
        ]);
        expect(move.success).toBe(false);
        expect(clone.success).toBe(false);
        expect(note.getParentNotes().map((parent) => parent.noteId)).toEqual([ memberHome.noteId ]);

        expect(cls.init(() => treeService.validateParentChild("root", note.noteId).success)).toBe(true);
    });
});

/** Runs `fn` as a request by the user would: with their `userId` in CLS and their Becca warmed. */
function asUser<T>(userId: string, fn: () => T): Promise<T> {
    return cls.init(async () => {
        cls.set("userId", userId);
        await warmBeccaForUser(userId);
        return fn();
    });
}
