import { USERS_NOTE_ID } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { getBecca, warmBeccaForUser } from "../becca/becca.js";
import Becca from "../becca/becca-interface.js";
import { loadBeccaForUser } from "../becca/becca_loader.js";
import cloningService from "./cloning.js";
import * as cls from "./context.js";
import noteService from "./notes.js";
import permissionService from "./permission_service.js";
import { getSql } from "./sql/index.js";
import treeService from "./tree.js";
import userHomes, { getHomeNoteId, SHARED_WITH_ME_NOTE_ID } from "./user_homes.js";
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
            parentNoteId: memberHome.noteId, ownerId: memberId, title: "home-view-member-note", content: "", type: "text"
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

    it("lists notes shared with a member that they cannot otherwise reach under Shared with me", async () => {
        const aliceId = cls.init(() => userService.createUser("shared-alice-spec", null, false));
        const bobId = cls.init(() => userService.createUser("shared-bob-spec", null, false));
        const aliceHome = cls.init(() => userHomes.ensureUserHome(aliceId, "shared-alice-spec"));
        const bobHome = cls.init(() => userHomes.ensureUserHome(bobId, "shared-bob-spec"));
        const project = createOwnedNote(bobHome.noteId, bobId, "shared project");
        const spec = createOwnedNote(project.noteId, bobId, "shared spec");

        expect((await loadFor(aliceId)).notes[SHARED_WITH_ME_NOTE_ID]).toBeUndefined();

        cls.init(() => {
            permissionService.setUserAccess(project.noteId, aliceId, false);
            // A grant inside an already shared subtree adds nothing to the list.
            permissionService.setUserAccess(spec.noteId, aliceId, false);
        });
        const aliceDraft = createOwnedNote(project.noteId, aliceId, "alice draft");
        let aliceBecca = await loadFor(aliceId);
        const sharedWithMe = aliceBecca.notes[SHARED_WITH_ME_NOTE_ID];
        expect(sharedWithMe?.isVirtual).toBe(true);
        expect(sharedWithMe?.getParentNotes().map((parent) => parent.noteId)).toEqual([ "root" ]);
        expect(sharedWithMe?.getChildNotes().map((child) => child.noteId)).toEqual([ project.noteId ]);
        expect(aliceBecca.getBranchFromChildAndParent(project.noteId, SHARED_WITH_ME_NOTE_ID)?.isVirtual).toBe(true);
        expect(aliceBecca.notes[spec.noteId]?.getParentNotes().map((parent) => parent.noteId)).toEqual([ project.noteId ]);
        expect((await loadFor(bobId)).notes[SHARED_WITH_ME_NOTE_ID]).toBeUndefined();

        // Placing the note in her own tree takes it off the list.
        cls.init(() => cloningService.cloneNoteToParentNote(project.noteId, aliceHome.noteId));
        aliceBecca = await loadFor(aliceId);
        expect(aliceBecca.notes[SHARED_WITH_ME_NOTE_ID]).toBeUndefined();
        expect(aliceBecca.notes[project.noteId]?.getParentNotes().map((parent) => parent.noteId)).toEqual([ aliceHome.noteId ]);

        // Once the access is gone, her own note under it stays within reach.
        cls.init(() => {
            permissionService.revokeUserAccess(project.noteId, aliceId);
            permissionService.revokeUserAccess(spec.noteId, aliceId);
        });
        aliceBecca = await loadFor(aliceId);
        expect(aliceBecca.notes[project.noteId]).toBeUndefined();
        expect(aliceBecca.notes[SHARED_WITH_ME_NOTE_ID]?.getChildNotes().map((child) => child.noteId)).toEqual([ aliceDraft.noteId ]);
    });

    it("pastes a note into a member's home", async () => {
        const aliceId = cls.init(() => userService.createUser("paste-alice-spec", null, false));
        const bobId = cls.init(() => userService.createUser("paste-bob-spec", null, false));
        const aliceHome = cls.init(() => userHomes.ensureUserHome(aliceId, "paste-alice-spec"));
        const bobHome = cls.init(() => userHomes.ensureUserHome(bobId, "paste-bob-spec"));
        const project = createOwnedNote(bobHome.noteId, bobId, "pasted project");
        cls.init(() => permissionService.setUserAccess(project.noteId, aliceId, false));

        const result = await asUser(aliceId, () => cloningService.cloneNoteToBranch(
            project.noteId, `root_${aliceHome.noteId}`
        ));
        expect(result.success).toBe(true);
        const placed = cls.init(() => getSql().getValue(
            "SELECT 1 FROM branches WHERE noteId = ? AND parentNoteId = ? AND isDeleted = 0",
            [ project.noteId, aliceHome.noteId ]
        ));
        expect(placed).toBe(1);
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

/** Loads a fresh Becca for the user, as the first request of their session does. */
async function loadFor(userId: string): Promise<Becca> {
    const userBecca = new Becca();
    await cls.init(() => {
        cls.set("userId", userId);
        return loadBeccaForUser(userBecca, userId, false);
    });
    return userBecca;
}

function createOwnedNote(parentNoteId: string, ownerId: string, title: string) {
    return cls.init(() => noteService.createNewNote({ parentNoteId, ownerId, title, content: "", type: "text" }).note);
}

/** Runs `fn` as a request by the user would: with their `userId` in CLS and their Becca warmed. */
function asUser<T>(userId: string, fn: () => T): Promise<T> {
    return cls.init(async () => {
        cls.set("userId", userId);
        await warmBeccaForUser(userId);
        return fn();
    });
}
