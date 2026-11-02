import { t } from "i18next";

import { getBecca } from "../becca/becca.js";
import type BNote from "../becca/entities/bnote.js";
import { getUserId } from "./context.js";
import noteService from "./notes.js";
import { getSql } from "./sql/index.js";
import userService from "./user_service.js";

/**
 * The note that holds one home note per user. Only admins see it; a member sees their own home at
 * the top of their tree instead (see `loadBeccaForUser()`). The ID has no `_` prefix: code treats
 * `_`-prefixed notes as system notes, and the homes hold user content.
 */
export const USERS_NOTE_ID = "users";

/** The ID of a user's home note, derived from the user so that no column has to store it. */
export function getHomeNoteId(userId: string) {
    return `home_${userId}`;
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

    return getBecca().getNote(getHomeNoteId(userId))?.noteId ?? null;
}

/** Returns the user's home note, creating it (and the Users note) when missing. */
function ensureUserHome(userId: string, username: string): BNote {
    const existing = getBecca().getNote(getHomeNoteId(userId));
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
    const home = getBecca().getNote(getHomeNoteId(userId));
    if (home && home.title !== username) {
        home.title = username;
        home.save();
    }
}

export default { ensureUserHome, ensureUserHomes, renameUserHome };

function getOrCreateUsersNote(): BNote {
    const existing = getBecca().getNote(USERS_NOTE_ID);
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
