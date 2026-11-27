/**
 * @module
 *
 * The notification routes. The body of a refusal is its code alone. Every route refuses on a
 * database that has not opened: during a first sync the middleware lets every request pass.
 */
import type { NotificationErrorBody, NotificationErrorCode } from "@triliumnext/commons";

import type { Request } from "../../http_interface";
import { getLog } from "../../services/log.js";
import { getNotificationService } from "../../services/notifications/index.js";
import { NotificationError } from "../../services/notifications/model.js";
import type { NotificationProducer } from "../../services/notifications/service.js";
import sqlInit from "../../services/sql_init.js";

/** The status of each refusal. Every other code is a malformed request, with status 400. */
const STATUS_OF_CODE: Partial<Record<NotificationErrorCode, number>> = {
    "not-found": 404,
    "stale-revision": 409,
    "budget": 409,
    "daily-budget": 409,
    "full": 409,
    "category-off": 409,
    "not-initialized": 409
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
    dismissNotifications
};
