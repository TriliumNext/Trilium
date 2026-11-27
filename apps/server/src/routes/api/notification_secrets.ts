/**
 * @module
 *
 * The secret route of a webhook channel, served on the forwarding instance only: `GET` returns
 * the names of what is set, and `PUT` and `DELETE`, which ask for the password, change the
 * secrets file. The body of a refusal is its code alone.
 */
import type { NotificationErrorBody, NotificationErrorCode } from "@triliumnext/commons";
import { getLog, password as passwordService, sql_init as sqlInit, utils } from "@triliumnext/core";
import {
    isForwardingInstance
} from "@triliumnext/core/src/services/notifications/channels/forwarder.js";
import { NotificationError } from "@triliumnext/core/src/services/notifications/model.js";
import type { NextFunction, Request, Response } from "express";

import {
    applySecretPut,
    changeSecretEntry,
    getSecretView,
    parseSecretDelete,
    parseSecretPut
} from "../../services/notifications/notification_secrets.js";

type ChannelRequest = Request<{ channelId: string }>;

/** The status of each refusal. Every other code is a malformed request, with status 400. */
const STATUS_OF_CODE: Partial<Record<NotificationErrorCode, number>> = {
    "not-found": 404,
    "stale-revision": 409,
    "not-initialized": 409,
    "not-forwarding": 409,
    "password-not-set": 409,
    "internal": 500
};

/**
 * Refuses a change before its password is checked: on a database that has not opened, on an
 * instance that does not forward, and where no password is set.
 */
function checkSecretChange(_req: Request, res: Response, next: NextFunction) {
    const code = getRefusal() ?? (passwordService.isPasswordSet() ? null : "password-not-set");
    if (code) {
        const [ status, body ] = refuse(code);
        res.status(status).json(body);
        return;
    }
    next();
}

/** The names of what is set, never a value or part of the URL. */
function getSecret(req: ChannelRequest) {
    return answer(req, () => getSecretView(req.params.channelId));
}

/** `{ url?, headers?, network?, signingSecret?, values?, label?, template?, expected }`. */
function putSecret(req: ChannelRequest) {
    return answer(req, async () => {
        const { expected, change } = parseSecretPut(req.body);
        await changeSecretEntry(req.params.channelId, expected,
            (current) => applySecretPut(current, change));
        return await getSecretView(req.params.channelId);
    });
}

/** `{ expected }`. */
function deleteSecret(req: ChannelRequest) {
    return answer(req, async () => {
        const { expected } = parseSecretDelete(req.body);
        await changeSecretEntry(req.params.channelId, expected, () => null);
        return await getSecretView(req.params.channelId);
    });
}

/**
 * Runs a handler on the forwarding instance, on an opened database, for a valid channel ID. An
 * error that is not a refusal is logged by its stack frames alone and answered as `internal`.
 */
async function answer<T>(
    req: ChannelRequest,
    run: () => Promise<T>
): Promise<T | [ number, NotificationErrorBody ]> {
    const refusal = getRefusal();
    if (refusal) {
        return refuse(refusal);
    }
    if (!utils.isValidEntityId(req.params.channelId)) {
        return refuse("invalid-input");
    }

    try {
        return await run();
    } catch (e) {
        if (e instanceof NotificationError) {
            return refuse(e.code);
        }
        const frames = getStackFrames(e);
        getLog().error(`A secret route of notification channels failed: internal.${frames}`);
        return refuse("internal");
    }
}

function getRefusal(): NotificationErrorCode | null {
    if (!sqlInit.isDbInitialized()) {
        return "not-initialized";
    }
    return isForwardingInstance() ? null : "not-forwarding";
}

function refuse(code: NotificationErrorCode): [ number, NotificationErrorBody ] {
    return [ STATUS_OF_CODE[code] ?? 400, { code } ];
}

/** The frames of an error's stack, without its message. */
function getStackFrames(error: unknown) {
    const lines = String((error as Error).stack).split("\n");
    return lines.filter((line) => line.trimStart().startsWith("at "))
        .map((frame) => `\n${frame}`)
        .join("");
}

export default {
    checkSecretChange,
    getSecret,
    putSecret,
    deleteSecret
};
