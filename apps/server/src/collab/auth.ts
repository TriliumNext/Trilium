import { becca, type BNote } from "@triliumnext/core";
import { isGuestEditableNote } from "@triliumnext/core/src/collab/guest_writes.js";
import { getShareEditPolicy, type ShareEditPolicy } from "@triliumnext/core/src/collab/share_edit.js";
import {
    isShareNoteReadable, isShareReady, shaca, shacaLoader
} from "@triliumnext/core/src/share/index.js";
import type SNote from "@triliumnext/core/src/share/shaca/entities/snote.js";
import type { NextFunction, Request, Response } from "express";
import { t } from "i18next";

/** What the access middleware resolved for a request; handlers read it with {@link getShareEditState}. */
export interface ShareEditState {
    note: BNote;
    shared: SNote;
    policy: ShareEditPolicy;
}

export type ShareEditResolution =
    | { status: 403 | 404; message: string }
    | {
        note: BNote;
        shared: SNote;
        /** `null` where the note's subtree is not open to editing. */
        policy: ShareEditPolicy | null;
        /**
         * Whether the session is the host's own, or holds a grant on the subtree issued under its
         * current password or open editing.
         */
        unlocked: boolean;
    };

const NOTE_ID_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

/**
 * Finds the shared note `noteId` as a guest sees it: readable on the share and editable by guests.
 * The host's own session is unlocked everywhere.
 */
export function resolveShareEdit(req: Request, noteId: unknown): ShareEditResolution {
    const notFound = {
        status: 404 as const, message: t("share_edit.note-not-found", { noteId: String(noteId) })
    };
    if (!isNoteIdParam(noteId) || !isShareReady()) {
        return notFound;
    }

    shacaLoader.ensureLoad();
    const shared = shaca.getNote(noteId);
    if (!shared || !isShareNoteReadable(noteId, { getHeader: (name) => req.header(name) })) {
        return notFound;
    }

    const note = becca.getNote(noteId);
    if (!note || !isGuestEditableNote(note)) {
        return { status: 403, message: t("share_edit.cannot-edit") };
    }

    const policy = getShareEditPolicy(shared);
    const grant = policy ? req.session.shareEdit?.[policy.rootNoteId] : undefined;
    const unlocked = !!policy && (!!req.session.loggedIn || grant?.key === policy.grantKey);
    return { note, shared, policy, unlocked };
}

/** The answer to a request that may not edit the note. */
export interface ShareEditRefusal {
    status: 401 | 403 | 404;
    /** `locked` tells the page to ask for the password again rather than retry. */
    body: { message: string; locked?: true };
}

/**
 * Resolves whether the session may edit the note `noteId` on its shared page now: the state a
 * handler writes with, or the refusal to answer.
 */
export function checkShareEditAccess(
    req: Request, noteId: unknown
): ShareEditState | ShareEditRefusal {
    const resolved = resolveShareEdit(req, noteId);
    if ("status" in resolved) {
        return { status: resolved.status, body: { message: resolved.message } };
    }

    const { note, shared, policy, unlocked } = resolved;
    if (!policy) {
        return { status: 403, body: { message: t("share_edit.cannot-edit") } };
    }
    if (!unlocked) {
        return { status: 401, body: { message: t("share_edit.unlock-first"), locked: true } };
    }

    return { note, shared, policy };
}

/** Refuses the request unless the session may edit the note `:noteId` on its shared page. */
export function shareEditAccess(req: Request, res: Response, next: NextFunction) {
    const access = checkShareEditAccess(req, req.params.noteId);
    if ("status" in access) {
        res.status(access.status).json(access.body);
        return;
    }

    res.locals.shareEdit = access;
    next();
}

export function getShareEditState(res: Response): ShareEditState {
    const state = res.locals.shareEdit as ShareEditState | undefined;
    if (!state) {
        throw new Error("shareEditAccess() did not run before this handler.");
    }

    return state;
}

/** Whether the value can be a note id. */
export function isNoteIdParam(value: unknown): value is string {
    return typeof value === "string" && NOTE_ID_PATTERN.test(value);
}
