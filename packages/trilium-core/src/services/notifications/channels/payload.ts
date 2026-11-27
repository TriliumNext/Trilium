/**
 * @module
 *
 * The key of a delivery and the payload of an attempt, built from the stored row as the view
 * gives it. The builder never reads the private text.
 */
import type { NotificationChannelPayload } from "@triliumnext/commons";
import { t } from "i18next";

import becca from "../../../becca/becca.js";
import type BNotification from "../../../becca/entities/bnotification.js";
import { getCrypto } from "../../encryption/crypto.js";
import optionService from "../../options.js";
import { encodeUtf8 } from "../../utils/binary.js";
import {
    describeRow, getReferencedNoteId, makeTextPrivate, type ViewContext
} from "../model.js";
import { deriveKey } from "../protected_text.js";

const DELIVERY_KEY_LABEL = "trilium:delivery-key:v1";

/**
 * The key of a delivery: an HMAC of `<id>|<raisedAt>|<channelId>` under a key derived from
 * `documentSecret`. It is the same for every attempt and on every instance of the document, and it
 * does not show the caller's ID.
 */
export function getDeliveryKey(id: string, raisedAt: string, channelId: string) {
    const secret = encodeUtf8(optionService.getOption("documentSecret"));
    const key = deriveKey(secret, DELIVERY_KEY_LABEL);
    return getCrypto().hmac(key, encodeUtf8(`${id}|${raisedAt}|${channelId}`))
        .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/**
 * The payload of an attempt. A sensitive notification, and one whose delivery went out with the
 * public text before, gets its public text and no note ID.
 */
export function buildPayload(
    notification: BNotification,
    deliveryKey: string,
    context: ViewContext,
    isPublicOnly: boolean
): { payload: NotificationChannelPayload; isSensitive: boolean } {
    const entry = describeRow(notification, context);
    const isSensitive = entry.isSensitive || isPublicOnly;
    // The text of a row without the flag is not public once a delivery sent the public text alone.
    const content = isPublicOnly && !entry.isSensitive
        ? makeTextPrivate(entry.content).content
        : entry.content;
    const payload: NotificationChannelPayload = {
        key: deliveryKey,
        title: content.title || getNoteTitle(notification, isSensitive)
            || t(`notifications.payload-title-${notification.category}`),
        category: notification.category,
        attentionLevel: notification.attentionLevel,
        raisedAt: notification.raisedAt
    };
    if (content.description) {
        payload.description = content.description;
    }
    if (!isSensitive && notification.noteId !== null) {
        payload.noteId = notification.noteId;
    }
    return { payload, isSensitive };
}

/** The title of the note of a notification that is not sensitive and has no title of its own. */
function getNoteTitle(notification: BNotification, isSensitive: boolean) {
    const noteId = getReferencedNoteId(notification.noteId, notification.content);
    const note = noteId === null || isSensitive ? null : becca.getNote(noteId);
    return note && !note.isProtected ? note.title : "";
}
