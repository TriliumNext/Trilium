import { USERS_NOTE_ID } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import becca from "../becca/becca.js";
import cloningService from "./cloning.js";
import * as cls from "./context.js";
import noteService from "./notes.js";
import { getSql } from "./sql/index.js";
import treeService from "./tree.js";
import userHomes, { getHomeNoteId } from "./user_homes.js";
import userService from "./user_service.js";

describe("user homes", () => {
    it("creates nothing while the primary admin is the only user", () => {
        const adminId = cls.init(() => userService.getAdminUserId());
        getSql().execute("UPDATE users SET isDeleted = 1 WHERE userId != ?", [ adminId ]);

        cls.init(() => userHomes.ensureUserHomes());

        expect(becca.getNote(USERS_NOTE_ID)).toBeNull();
    });

    it("gives every other user a home under the admin-owned Users note", () => {
        const adminId = cls.init(() => userService.getAdminUserId());
        const memberId = cls.init(() => userService.createUser("home-member-spec", null, false));
        const otherAdminId = cls.init(() => userService.createUser("home-admin-spec", null, true));

        cls.init(() => userHomes.ensureUserHomes());

        const usersNote = becca.getNoteOrThrow(USERS_NOTE_ID);
        expect(usersNote.ownerId).toBe(adminId);
        expect(usersNote.getParentNotes().map((parent) => parent.noteId)).toEqual([ "root" ]);

        const memberHome = becca.getNoteOrThrow(getHomeNoteId(memberId));
        expect(memberHome).toMatchObject({ title: "home-member-spec", ownerId: memberId });
        expect(memberHome.getParentNotes().map((parent) => parent.noteId)).toEqual([ USERS_NOTE_ID ]);
        expect(becca.getNote(getHomeNoteId(otherAdminId))?.ownerId).toBe(otherAdminId);
        expect(becca.getNote(getHomeNoteId(adminId))).toBeNull();

        // A second pass, as on every startup, finds nothing to add.
        const childCount = usersNote.getChildNotes().length;
        cls.init(() => userHomes.ensureUserHomes());
        expect(usersNote.getChildNotes()).toHaveLength(childCount);
    });

    it("names the home at the top of the tree for members only", () => {
        const memberId = cls.init(() => userService.createUser("home-top-member-spec", null, false));
        const adminId = cls.init(() => userService.createUser("home-top-admin-spec", null, true));
        cls.init(() => userHomes.ensureUserHome(memberId, "home-top-member-spec"));
        cls.init(() => userHomes.ensureUserHome(adminId, "home-top-admin-spec"));
        const homelessId = cls.init(() => userService.createUser("home-top-homeless-spec", null, false));

        expect(cls.init(() => userHomes.getTopLevelHomeNoteId(memberId))).toBe(getHomeNoteId(memberId));
        // An admin sees the whole tree, where their home sits under the Users note.
        expect(cls.init(() => userHomes.getTopLevelHomeNoteId(adminId))).toBeUndefined();
        expect(cls.init(() => userHomes.getTopLevelHomeNoteId(homelessId))).toBeUndefined();
    });

    it("renames a home along with its user", () => {
        const memberId = cls.init(() => userService.createUser("home-rename-spec", null, false));
        cls.init(() => userHomes.ensureUserHome(memberId, "home-rename-spec"));

        cls.init(() => userHomes.renameUserHome(memberId, "home-renamed-spec"));

        expect(becca.getNoteOrThrow(getHomeNoteId(memberId)).title).toBe("home-renamed-spec");
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

        // A user who has no home yet keeps root.
        const homelessId = cls.init(() => userService.createUser("home-create-homeless-spec", null, false));
        const homelessNote = await asUser(homelessId, () => noteService.createNewNote({
            parentNoteId: "root", ownerId: homelessId, title: "homeless into root", content: "", type: "text"
        }).note);
        expect(homelessNote.getParentNotes().map((parent) => parent.noteId)).toEqual([ "root" ]);
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

    it("refuses a member's new note that reuses the ID of a note they cannot see", async () => {
        const aliceId = cls.init(() => userService.createUser("forced-alice-spec", null, false));
        const bobId = cls.init(() => userService.createUser("forced-bob-spec", null, false));
        const aliceHome = cls.init(() => userHomes.ensureUserHome(aliceId, "forced-alice-spec"));
        const bobHome = cls.init(() => userHomes.ensureUserHome(bobId, "forced-bob-spec"));
        const secret = createOwnedNote(bobHome.noteId, bobId, "bob secret");

        await expect(asUser(aliceId, () => noteService.createNewNote({
            noteId: secret.noteId, parentNoteId: aliceHome.noteId, title: "taken", content: "", type: "text"
        }))).rejects.toThrow(`Note '${secret.noteId}' already exists.`);
        const row = cls.init(() => getSql().getRow(
            "SELECT title, ownerId FROM notes WHERE noteId = ?", [ secret.noteId ]
        ));
        expect(row).toEqual({ title: "bob secret", ownerId: bobId });
    });
});

function createOwnedNote(parentNoteId: string, ownerId: string, title: string) {
    return cls.init(() => noteService.createNewNote({ parentNoteId, ownerId, title, content: "", type: "text" }).note);
}

/** Runs `fn` as a request by the user would: with their `userId` in CLS. */
function asUser<T>(userId: string, fn: () => T): Promise<T> {
    return cls.init(async () => {
        cls.set("userId", userId);
        return fn();
    });
}
