import { becca, type BNote, getSql, ValidationError } from "@triliumnext/core";
import {
    hashShareEditPassword, MIN_SHARE_EDIT_PASSWORD_LENGTH, SHARE_ATTACHMENTS_LABEL,
    SHARE_EDIT_LABEL, SHARE_EDIT_PASSWORD_LABEL
} from "@triliumnext/core/src/collab/share_edit.js";
import type { Request } from "express";
import { t } from "i18next";

const SHARE_EDIT_LABELS = [ SHARE_EDIT_LABEL, SHARE_EDIT_PASSWORD_LABEL, SHARE_ATTACHMENTS_LABEL ];

interface ShareEditBody {
    enabled?: unknown;
    /** A new password; `open` lets anyone with the link edit instead. */
    password?: unknown;
    open?: unknown;
    attachments?: unknown;
}

/**
 * Sets guest editing for the note and the notes below it, as the Shared badge's menu asks, with
 * labels of its own only where they differ from what it inherits (User Guide: Sharing).
 */
async function setShareEdit(req: Request<{ noteId: string }>) {
    const note = becca.getNoteOrThrow(req.params.noteId);
    const body = (req.body ?? {}) as ShareEditBody;
    const inherits = (name: string) =>
        note.getParentNotes().some((parent) => parent.isLabelTruthy(name));
    if (body.enabled !== true) {
        // The route is asynchronous, so it opens the transaction whose commit tells the clients.
        getSql().transactional(() => {
            for (const name of SHARE_EDIT_LABELS) {
                note.removeLabel(name);
            }
            if (inherits(SHARE_EDIT_LABEL)) {
                setInheritableLabel(note, SHARE_EDIT_LABEL, "false");
            }
        });
        return { enabled: false };
    }

    let passwordHash: string | null = null;
    if (typeof body.password === "string") {
        if (body.password.length < MIN_SHARE_EDIT_PASSWORD_LENGTH) {
            throw new ValidationError(
                t("share_edit.password-too-short", { min: MIN_SHARE_EDIT_PASSWORD_LENGTH }));
        }
        passwordHash = await hashShareEditPassword(body.password);
    }
    const becomesRoot = passwordHash !== null || body.open === true;
    const owned = note.getOwnedLabel(SHARE_EDIT_LABEL);
    const ownsEditing = !!owned && owned.value !== "false";
    if (!becomesRoot && !ownsEditing && !inherits(SHARE_EDIT_LABEL)) {
        throw new ValidationError(t("share_edit.choose-access"));
    }

    getSql().transactional(() => {
        if (becomesRoot) {
            setInheritableLabel(note, SHARE_EDIT_LABEL, "");
            note.removeLabel(SHARE_EDIT_PASSWORD_LABEL);
            const lockedAbove = note.getParentNotes()
                .some((parent) => !!parent.getLabelValue(SHARE_EDIT_PASSWORD_LABEL));
            if (passwordHash !== null || lockedAbove) {
                setInheritableLabel(note, SHARE_EDIT_PASSWORD_LABEL, passwordHash ?? "");
            }
        } else if (!ownsEditing) {
            note.removeLabel(SHARE_EDIT_LABEL);
        }
        if (typeof body.attachments === "boolean") {
            note.removeLabel(SHARE_ATTACHMENTS_LABEL);
            if (inherits(SHARE_ATTACHMENTS_LABEL) !== body.attachments) {
                setInheritableLabel(note, SHARE_ATTACHMENTS_LABEL, body.attachments ? "" : "false");
            }
        }
    });

    return {
        enabled: true,
        needsPassword: !!note.getLabelValue(SHARE_EDIT_PASSWORD_LABEL),
        attachments: note.isLabelTruthy(SHARE_ATTACHMENTS_LABEL)
    };
}

function setInheritableLabel(note: BNote, name: string, value: string) {
    const label = note.getOwnedLabel(name);
    if (!label) {
        note.addLabel(name, value, true);
    } else if (label.value !== value || !label.isInheritable) {
        label.value = value;
        label.isInheritable = true;
        label.save();
    }
}

export default {
    setShareEdit
};
