/**
 * @module
 *
 * The notification routes. The body of a refusal is its code alone. Every route refuses on a
 * database that has not opened: during a first sync the middleware lets every request pass.
 */
import type { NotificationErrorBody, NotificationErrorCode } from "@triliumnext/commons";

import type { Request, Response } from "../../http_interface";
import { getLog } from "../../services/log.js";
import { getNotificationService } from "../../services/notifications/index.js";
import { NotificationError } from "../../services/notifications/model.js";
import type { NotificationProducer } from "../../services/notifications/service.js";
import {
    readCustomSound, resetCustomSound, saveCustomSound
} from "../../services/notifications/sound.js";
import sqlInit from "../../services/sql_init.js";
import { serveContentWithRanges } from "../partial_content.js";

/** The status of each refusal. Every other code is a malformed request, with status 400. */
const STATUS_OF_CODE: Partial<Record<NotificationErrorCode, number>> = {
    "not-found": 404,
    "stale-revision": 409,
    "budget": 409,
    "daily-budget": 409,
    "full": 409,
    "category-off": 409,
    "not-initialized": 409,
    "transient-limit": 409,
    "not-owner": 409
};

/** `?after=<notificationId>`: one page of the view. */
function getNotifications(req: Request<Record<string, string>, { after?: string }>) {
    return answer(() => getNotificationService().getPage(req.query.after));
}

function createNotification(req: Request) {
    return answer(() => {
        const { outcome, notification } = getNotificationService()
            .create(req.body, getClientProducer(req));
        return outcome === "categoryOff" ? refuse("category-off") : { notification };
    });
}

/** `{ patch, expected? }`. */
function updateNotification(req: Request<{ id: string }>) {
    return answer(() => ({
        notification: getNotificationService()
            .update(req.params.id, req.body?.patch, getClientProducer(req), req.body?.expected)
    }));
}

/** `{ refs, state }`. */
function setNotificationState(req: Request) {
    return answer(() => {
        getNotificationService().setState(req.body?.refs, req.body?.state);
        return undefined;
    });
}

/** `{ refs, reason }`. */
function dismissNotifications(req: Request) {
    return answer(() => getNotificationService().dismiss(req.body?.refs, req.body?.reason));
}

/** `{ notification, token? }`: creates, replaces or keeps alive a transient notification. */
function putTransientNotification(req: Request<{ id: string }>) {
    return answer(() => ({
        token: getNotificationService().putTransient(req.params.id, req.body?.notification,
            getClientProducer(req), req.body?.token)
    }));
}

/** `{ token }`: ends a transient notification. */
function dismissTransientNotification(req: Request<{ id: string }>) {
    return answer(() => {
        getNotificationService().dismissTransient(req.params.id, req.body?.token);
        return undefined;
    });
}

/**
 * A multipart upload of the custom sound, in the field `upload`. It answers for itself: an upload
 * route needs `route()`, whose result handler drops the status of a refusal in standalone.
 */
function uploadSound(req: Request, res: Response) {
    const refusal = answer(() => {
        if (!req.file?.buffer) {
            return refuse("invalid-input");
        }
        saveCustomSound(req.file.buffer);
        return null;
    });
    return refusal ? sendRefusal(res, refusal) : res.sendStatus(204);
}

function resetSound() {
    return answer(() => {
        resetCustomSound();
        return undefined;
    });
}

/**
 * Serves the custom sound in the byte ranges that a media element asks for, with the MIME type
 * that its bytes name and `nosniff`. Without a sound that plays it answers 404, and the client
 * plays the default sound.
 */
function getSound(req: Request, res: Response) {
    const sound = sqlInit.isDbInitialized() ? readCustomSound() : null;
    if (!sound) {
        return sendRefusal(res, [ 404, { code: "not-found" } ]);
    }

    res.setHeader("X-Content-Type-Options", "nosniff");
    return serveContentWithRanges(req, res, {
        content: sound.content,
        fileName: sound.fileName,
        mimeType: sound.mime,
        etag: sound.blobId
    });
}

/** All clients are one producer, and each session has a budget of its own. */
function getClientProducer(req: Request): NotificationProducer {
    return { kind: "client", sessionId: req.sessionID };
}

/**
 * Runs a route on an opened database. Another error than a refusal is logged by its stack frames
 * and thrown again without its message, so that the transaction of the route rolls back.
 */
function answer<T>(run: () => T): T | [ number, NotificationErrorBody ] {
    if (!sqlInit.isDbInitialized()) {
        return refuse("not-initialized");
    }

    try {
        return run();
    } catch (e) {
        if (e instanceof NotificationError && e.code !== "internal") {
            return refuse(e.code);
        }
        getLog().error(`A notification route failed: internal.${getStackFrames(e)}`);
        throw new Error("internal");
    }
}

function refuse(code: NotificationErrorCode): [ number, NotificationErrorBody ] {
    return [ STATUS_OF_CODE[code] ?? 400, { code } ];
}

/** Writes a refusal, for a route that writes its own response. */
function sendRefusal(res: Response, [ status, body ]: [ number, NotificationErrorBody ]) {
    return res.setHeader("Content-Type", "application/json; charset=utf-8").status(status)
        .send(JSON.stringify(body));
}

/** The frames of an error's stack, without its message. */
function getStackFrames(error: unknown) {
    const stack = error instanceof Error ? error.stack ?? "" : "";
    const frames = stack.split("\n").filter((line) => line.trimStart().startsWith("at "));
    return frames.map((frame) => `\n${frame}`).join("");
}

export default {
    getNotifications,
    createNotification,
    updateNotification,
    setNotificationState,
    dismissNotifications,
    putTransientNotification,
    dismissTransientNotification,
    uploadSound,
    resetSound,
    getSound
};
