import { HOME_NOTE_ID_PREFIX, USERS_NOTE_ID } from "@triliumnext/commons";
import { t } from "i18next";

import becca from "../becca/becca.js";
import type BBranch from "../becca/entities/bbranch.js";
import type BNote from "../becca/entities/bnote.js";
import { getUserId } from "./context.js";
import eventService from "./events.js";
import noteService from "./notes.js";
import { getSql } from "./sql/index.js";
import userService from "./user_service.js";
import ws from "./ws.js";

/** The ID of a user's home note, derived from the user so that no column has to store it. */
export function getHomeNoteId(userId: string) {
    return `${HOME_NOTE_ID_PREFIX}${userId}`;
}

/**
 * The home of the user in CLS, which stands in for `root` as the parent of their top-level notes.
 * Returns `null` for the primary admin and for work without a user in CLS, which both keep `root`.
 */
export function getActingUserHomeNoteId(): string | null {
    const userId = getUserId();
    if (!userId || userId === userService.getAdminUserId()) {
        return null;
    }

    return becca.getNote(getHomeNoteId(userId))?.noteId ?? null;
}

/** Returns the user's home note, creating it (and the Users note) when missing. */
function ensureUserHome(userId: string, username: string): BNote {
    const existing = becca.getNote(getHomeNoteId(userId));
    if (existing) {
        return existing;
    }

    return getSql().transactional(() => noteService.createNewNote({
        noteId: getHomeNoteId(userId),
        parentNoteId: getOrCreateUsersNote().noteId,
        ownerId: userId,
        title: username,
        type: "text",
        content: "",
        attributes: [{ type: "label", name: "iconClass", value: "bx bx-user" }]
    }).note);
}

/**
 * Gives every user except the primary admin a home. The primary admin's notes stay under `root`,
 * so a single-user instance gets no Users note.
 */
function ensureUserHomes() {
    const users = getSql().getRows<{ userId: string; username: string }>(
        "SELECT userId, username FROM users WHERE isDeleted = 0 AND userId != ? ORDER BY dateCreated",
        [userService.getAdminUserId()]
    );

    for (const { userId, username } of users) {
        ensureUserHome(userId, username);
    }
}

function renameUserHome(userId: string, username: string) {
    const home = becca.getNote(getHomeNoteId(userId));
    if (home && home.title !== username) {
        home.title = username;
        home.save();
    }
}

/**
 * The home at the top of the user's tree, which their client shows as "My notes": only members have
 * one, since an admin sees the whole tree, with their home under the Users note.
 */
function getTopLevelHomeNoteId(userId: string): string | undefined {
    if (userService.isUserAdmin(userId)) {
        return undefined;
    }

    return getSql().getValue<string>(
        "SELECT noteId FROM notes WHERE noteId = ? AND isDeleted = 0", [getHomeNoteId(userId)]
    ) ?? undefined;
}

/**
 * Whether the note is the Users note or a user's home. Access to them cannot be given: a grant covers
 * everything below, so it would hand over a user's notes, or everyone's, including those yet to come.
 */
function isHomeOrUsersNote(noteId: string): boolean {
    return noteId === USERS_NOTE_ID || isHomeNote(noteId);
}

/**
 * Whether the note is a user's home, looked up among the users since a note ID can be forced. Its
 * title follows the username (`renameUserHome()`), so it cannot be renamed by hand.
 */
function isHomeNote(noteId: string): boolean {
    return !!getSql().getValue<number>(
        "SELECT 1 FROM users WHERE ? = ? || userId", [noteId, HOME_NOTE_ID_PREFIX]
    );
}

export default {
    ensureUserHome, ensureUserHomes, renameUserHome, getTopLevelHomeNoteId, isHomeOrUsersNote, isHomeNote
};

function getOrCreateUsersNote(): BNote {
    const existing = becca.getNote(USERS_NOTE_ID);
    if (existing) {
        return existing;
    }

    return noteService.createNewNote({
        noteId: USERS_NOTE_ID,
        parentNoteId: "root",
        ownerId: userService.getAdminUserId(),
        title: t("user_homes.users-title"),
        type: "book",
        content: "",
        attributes: [{ type: "label", name: "iconClass", value: "bx bx-group" }]
    }).note;
}

// Shared with me exists only in the member's view, so a branch that moves a note onto or off it
// produces no entity change their client could apply; the client reloads its tree instead.
for (const event of [ eventService.ENTITY_CREATED, eventService.ENTITY_DELETED ]) {
    eventService.subscribe(event, ({ entityName, entity }) => {
        const userId = getUserId();
        if (entityName === "branches" && userId && changesSharedWithMe(entity as BBranch, userId)) {
            ws.reloadFrocaForUser(userId, "shared with me changed");
        }
    });
}

/**
 * Whether adding or removing `branch` changes what Shared with me lists: the note keeps other
 * branches, and the member can see none of their parents.
 */
function changesSharedWithMe(branch: BBranch, userId: string) {
    const view = becca.getView();
    const note = becca.allNotes[branch.noteId];
    if (!view || !note || note.noteId.startsWith("_") || note.noteId === getHomeNoteId(userId)
            || !view.canSeeNote(note.noteId) || !view.canSeeNote(branch.parentNoteId)) {
        return false;
    }

    const others = note.allParentBranches.filter((other) => other.branchId !== branch.branchId && !other.isDeleted);
    return others.length > 0 && !others.some((other) => view.canSeeNote(other.parentNoteId));
}
