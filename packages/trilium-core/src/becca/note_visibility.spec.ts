import { USERS_NOTE_ID } from "@triliumnext/commons";
import { beforeAll, describe, expect, it } from "vitest";

import { NotFoundError } from "../errors.js";
import cloningService from "../services/cloning.js";
import * as cls from "../services/context.js";
import noteService from "../services/notes.js";
import permissionService from "../services/permission_service.js";
import searchService from "../services/search/services/search.js";
import { getSql } from "../services/sql/index.js";
import userHomes, { getHomeNoteId } from "../services/user_homes.js";
import userService from "../services/user_service.js";
import dateUtils from "../services/utils/date.js";
import becca from "./becca.js";
import type BNote from "./entities/bnote.js";

/** Standalone has no users, so every scope there acts for the instance and nothing is filtered. */
const isBrowserRuntime = typeof self !== "undefined";

const SHARED_WITH_ME_NOTE_ID = "_sharedWithMe";

/**
 * Bob's home holds a project he shares with Alice, a secret he does not, and a note cloned into
 * both. Dave reaches a document through his group. The admin keeps a note of their own under
 * `root`, and Carol is an admin besides the primary one.
 */
interface Fixture {
    aliceId: string;
    bobId: string;
    carolId: string;
    daveId: string;
    aliceHome: BNote;
    bobHome: BNote;
    project: BNote;
    spec: BNote;
    secret: BNote;
    clone: BNote;
    template: BNote;
    teamDoc: BNote;
    adminNote: BNote;
}

let f: Fixture;

describe.skipIf(isBrowserRuntime)("note visibility", () => {
    beforeAll(() => {
        f = cls.initAsSystem(() => {
            const suffix = Date.now();
            const aliceId = userService.createUser(`vis-alice-${suffix}`, null, false);
            const bobId = userService.createUser(`vis-bob-${suffix}`, null, false);
            const carolId = userService.createUser(`vis-carol-${suffix}`, null, true);
            const daveId = userService.createUser(`vis-dave-${suffix}`, null, false);
            const aliceHome = userHomes.ensureUserHome(aliceId, `vis-alice-${suffix}`);
            const bobHome = userHomes.ensureUserHome(bobId, `vis-bob-${suffix}`);
            userHomes.ensureUserHome(daveId, `vis-dave-${suffix}`);

            bobHome.addAttribute("label", "visInherited", "fromBobHome", true);
            const template = createNote(bobHome.noteId, bobId, "vis template");
            template.addLabel("visTemplateLabel", "fromTemplate");

            const project = createNote(bobHome.noteId, bobId, "vis shared project");
            project.addRelation("template", template.noteId);
            const spec = createNote(project.noteId, bobId, "vis shared spec");
            const secret = createNote(bobHome.noteId, bobId, "vis bob secret");
            secret.addRelation("visPointsAt", project.noteId);
            project.addRelation("visSeeAlso", secret.noteId);
            const clone = createNote(secret.noteId, bobId, "vis cloned note");
            cloningService.cloneNoteToParentNote(clone.noteId, project.noteId);
            const teamDoc = createNote(bobHome.noteId, bobId, "vis team doc");
            const adminNote = createNote("root", userService.getAdminUserId(), "vis admin note");

            permissionService.setUserAccess(project.noteId, aliceId, false);
            const groupId = `visTeam${suffix}`;
            const now = dateUtils.utcNowDateTime();
            getSql().execute("INSERT INTO user_groups (groupId, name, dateCreated, utcDateModified) VALUES (?, ?, ?, ?)",
                [ groupId, groupId, now, now ]);
            getSql().execute("INSERT INTO user_group_members (userId, groupId, dateCreated) VALUES (?, ?, ?)",
                [ daveId, groupId, now ]);
            permissionService.grantPermission(teamDoc.noteId, null, groupId, false);

            return {
                aliceId, bobId, carolId, daveId, aliceHome, bobHome, project, spec, secret, clone, template,
                teamDoc, adminNote
            };
        });
    });

    it("shows a member their own notes, what is shared with them, root and the system notes, and nothing else", () => {
        asUser(f.aliceId, () => {
            for (const note of [ f.aliceHome, f.project, f.spec, f.clone ]) {
                expect(becca.getNote(note.noteId), note.title).toBe(note);
                expect(note.noteId in becca.notes).toBe(true);
            }
            expect(becca.getNote("root")).not.toBeNull();
            expect(becca.getNote("_hidden")).not.toBeNull();

            const hidden = [ f.bobHome, f.secret, f.template, f.teamDoc, f.adminNote ];
            for (const note of hidden) {
                expect(becca.getNote(note.noteId), note.title).toBeNull();
                expect(becca.notes[note.noteId]).toBeUndefined();
                expect(note.noteId in becca.notes).toBe(false);
                expect(() => becca.getNoteOrThrow(note.noteId)).toThrow(NotFoundError);
            }
            expect(becca.getNote(USERS_NOTE_ID)).toBeNull();
            expect(becca.getNote(getHomeNoteId(f.bobId))).toBeNull();

            const listed = new Set(Object.keys(becca.notes));
            expect(listed.has(f.project.noteId)).toBe(true);
            expect(hidden.some((note) => listed.has(note.noteId))).toBe(false);
            expect(becca.getNotes([ f.project.noteId, f.secret.noteId ], true).map((note) => note.noteId))
                .toEqual([ f.project.noteId ]);
        });
    });

    it("shows admins and system scopes every note", () => {
        for (const view of [ () => asUser(f.carolId, visibleOf), () => cls.initAsSystem(visibleOf) ]) {
            expect(view()).toEqual([ true, true, true, true ]);
        }

        function visibleOf() {
            return [ f.secret, f.adminNote, f.teamDoc, f.project ].map((note) => becca.getNote(note.noteId) === note);
        }
    });

    it("reaches a note shared with a group through its members only", () => {
        expect(asUser(f.daveId, () => becca.getNote(f.teamDoc.noteId))).toBe(f.teamDoc);
        expect(asUser(f.aliceId, () => becca.getNote(f.teamDoc.noteId))).toBeNull();
        expect(asUser(f.daveId, () => becca.getNote(f.project.noteId))).toBeNull();
    });

    it("shows the owner of a note what others add below it", () => {
        const { added, addedChild } = cls.initAsSystem(() => {
            const added = createNote(f.teamDoc.noteId, f.daveId, "vis added by dave");
            return { added, addedChild: createNote(added.noteId, f.daveId, "vis added below by dave") };
        });

        asUser(f.bobId, () => {
            expect(becca.getNote(added.noteId)).toBe(added);
            expect(becca.getNote(addedChild.noteId)).toBe(addedChild);
            expect(f.teamDoc.getChildNotes().map((note) => note.noteId)).toContain(added.noteId);
        });
        expect(asUser(f.aliceId, () => becca.getNote(added.noteId))).toBeNull();
    });

    it("hides the branches and attributes of notes a member cannot see", () => {
        asUser(f.aliceId, () => {
            const secretBranch = becca.getBranchFromChildAndParent(f.secret.noteId, f.bobHome.noteId);
            const projectBranch = becca.getBranchFromChildAndParent(f.project.noteId, f.bobHome.noteId);
            const specBranch = becca.getBranchFromChildAndParent(f.spec.noteId, f.project.noteId);
            expect(secretBranch).toBeFalsy();
            expect(projectBranch).toBeFalsy();
            expect(specBranch).toBeTruthy();

            const branchNoteIds = new Set(Object.values(becca.branches).map((branch) => branch.noteId));
            expect(branchNoteIds.has(f.spec.noteId)).toBe(true);
            expect(branchNoteIds.has(f.secret.noteId)).toBe(false);

            const secretRelation = f.secret.getOwnedRelation("visPointsAt");
            expect(secretRelation).toBeTruthy();
            expect(becca.getAttribute(secretRelation?.attributeId ?? "")).toBeNull();
            expect(Object.values(becca.attributes).some((attr) => attr.noteId === f.secret.noteId)).toBe(false);
            expect(becca.findAttributes("relation", "visPointsAt")).toEqual([]);
            expect(becca.findAttributes("relation", "visSeeAlso").map((attr) => attr.noteId)).toEqual([ f.project.noteId ]);
        });
    });

    it("leaves out the parents, children and relations a member cannot see", () => {
        asUser(f.aliceId, () => {
            expect(f.project.getParentNotes().map((note) => note.noteId)).toEqual([ SHARED_WITH_ME_NOTE_ID ]);
            expect(f.clone.getParentNotes().map((note) => note.noteId)).toEqual([ f.project.noteId ]);
            expect(f.clone.getParentBranches().map((branch) => branch.parentNoteId)).toEqual([ f.project.noteId ]);
            expect(f.clone.parents.map((note) => note.noteId)).toEqual([ f.project.noteId ]);
            expect(f.project.getChildNotes().map((note) => note.noteId).sort())
                .toEqual([ f.spec.noteId, f.clone.noteId ].sort());

            const rootChildren = becca.getNoteOrThrow("root").getChildNotes().map((note) => note.noteId);
            expect(rootChildren).toContain(f.aliceHome.noteId);
            expect(rootChildren).not.toContain(f.adminNote.noteId);
            expect(rootChildren).not.toContain(USERS_NOTE_ID);

            expect(f.project.getTargetRelations().map((attr) => attr.noteId)).not.toContain(f.secret.noteId);
            // The relation is the project's own, so it stays; its target is out of reach.
            const seeAlso = f.project.getOwnedRelation("visSeeAlso");
            expect(seeAlso).toBeTruthy();
            expect(seeAlso?.targetNote).toBeFalsy();
        });
    });

    it("still applies what a shared note inherits from notes the member cannot see", () => {
        asUser(f.aliceId, () => {
            expect(f.project.getLabelValue("visInherited")).toBe("fromBobHome");
            expect(f.spec.getLabelValue("visInherited")).toBe("fromBobHome");
            expect(f.project.getLabelValue("visTemplateLabel")).toBe("fromTemplate");
        });
    });

    it("puts a member's home at the top of their tree, and an admin's view under the Users note", () => {
        asUser(f.aliceId, () => {
            expect(f.aliceHome.getParentNotes().map((note) => note.noteId)).toEqual([ "root" ]);
            expect(becca.getBranchFromChildAndParent(f.aliceHome.noteId, "root")?.isVirtual).toBe(true);
        });
        asUser(f.carolId, () => {
            expect(f.aliceHome.getParentNotes().map((note) => note.noteId)).toEqual([ USERS_NOTE_ID ]);
            expect(becca.getNote(SHARED_WITH_ME_NOTE_ID)).toBeNull();
        });
    });

    it("lists under Shared with me what a member can see but not reach, and nothing once they can", () => {
        asUser(f.aliceId, () => {
            const sharedWithMe = becca.getNote(SHARED_WITH_ME_NOTE_ID);
            expect(sharedWithMe?.isVirtual).toBe(true);
            expect(sharedWithMe?.getParentNotes().map((note) => note.noteId)).toEqual([ "root" ]);
            expect(sharedWithMe?.getChildNotes().map((note) => note.noteId)).toEqual([ f.project.noteId ]);

            // The tree route reaches the note and its icon through the branch and the attribute
            // maps; neither may add it to the Becca every user reads.
            const rootBranch = becca.getBranchFromChildAndParent(SHARED_WITH_ME_NOTE_ID, "root");
            expect(rootBranch?.childNote).toBe(sharedWithMe);
            const icon = sharedWithMe?.getOwnedLabel("iconClass");
            expect(icon).toBeTruthy();
            expect(becca.getAttribute(icon?.attributeId ?? "")).toBe(icon);
        });
        expect(SHARED_WITH_ME_NOTE_ID in becca.allNotes).toBe(false);
        // Nothing is shared with Bob, so he has no list.
        expect(asUser(f.bobId, () => becca.getNote(SHARED_WITH_ME_NOTE_ID))).toBeNull();
    });

    it("follows changes to notes and grants at once", () => {
        const later = cls.initAsSystem(() => createNote(f.project.noteId, f.bobId, "vis added later"));
        expect(asUser(f.aliceId, () => f.project.getChildNotes().map((note) => note.noteId))).toContain(later.noteId);

        cls.initAsSystem(() => permissionService.setUserAccess(f.secret.noteId, f.aliceId, false));
        expect(asUser(f.aliceId, () => becca.getNote(f.secret.noteId))).toBe(f.secret);

        cls.initAsSystem(() => permissionService.revokeUserAccess(f.secret.noteId, f.aliceId));
        expect(asUser(f.aliceId, () => becca.getNote(f.secret.noteId))).toBeNull();
    });

    it("finds only what a member can see", () => {
        const found = asUser(f.aliceId, () => searchService.searchNotes("vis").map((note) => note.noteId));
        expect(found).toContain(f.project.noteId);
        expect(found).not.toContain(f.secret.noteId);
        expect(found).not.toContain(f.adminNote.noteId);
        expect(found).not.toContain(f.template.noteId);
    });
});

function createNote(parentNoteId: string, ownerId: string, title: string) {
    return noteService.createNewNote({ parentNoteId, ownerId, title, content: "", type: "text" }).note;
}

/** Runs `fn` as a request by the user would: with their `userId` in CLS. */
function asUser<T>(userId: string, fn: () => T): T {
    return cls.init(() => {
        cls.set("userId", userId);
        return fn();
    });
}
