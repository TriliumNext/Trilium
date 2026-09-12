import type { Request } from "express";

import {
    acquire,
    PACKAGE_OPERATION_LOCK_NAME,
    release,
    renew
} from "../../services/package_operation_lock.js";

type LockAction = "acquire" | "renew" | "release";

function handle(req: Request) {
    const action = req.body?.action as LockAction | undefined;
    const name = req.body?.name || PACKAGE_OPERATION_LOCK_NAME;
    const token = req.body?.token;

    if (!["acquire", "renew", "release"].includes(action || "")) {
        return [400, { error: "action must be acquire, renew, or release" }];
    }
    if (name !== PACKAGE_OPERATION_LOCK_NAME) {
        return [400, { error: `name must be ${PACKAGE_OPERATION_LOCK_NAME}` }];
    }
    if ((action === "renew" || action === "release") && (typeof token !== "string" || !token || token.length > 128)) {
        return [400, { error: "token is required" }];
    }

    if (action === "acquire") {
        const result = acquire(name);
        return result.ok
            ? { token: result.token, expiresAt: result.expiresAt }
            : [409, { error: "operation is already in progress", expiresAt: result.expiresAt }];
    }

    if (action === "renew") {
        const result = renew(name, token!);
        return result.ok
            ? { expiresAt: result.expiresAt }
            : [409, { error: "operation lock is missing or owned by another client", expiresAt: result.expiresAt }];
    }

    return release(name, token!) ? {} : [409, { error: "operation lock is missing or owned by another client" }];
}

export default {
    handle
};
