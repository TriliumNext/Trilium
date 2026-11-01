/**
 * The pre-auth endpoints behind a user's setup link: checking the link when the screen opens, and
 * setting the password it was issued for. Both are reached without a session, so they sit behind the
 * login rate limiter, which counts only the failures.
 */
import type { SetupAccountInfo } from "@triliumnext/commons";
import { user_service } from "@triliumnext/core";
import type { Request } from "express";

/** Same floor as the instance password's set-password screen. */
export const MIN_PASSWORD_LENGTH = 4;

const INVALID_LINK = [404, { message: "This setup link is invalid, has expired or was already used." }] as const;

function getSetupAccount(req: Request) {
    const { token } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof token !== "string") return INVALID_LINK;

    const user = user_service.getUserBySetupToken(token);
    if (!user?.setupTokenExpiresAt) return INVALID_LINK;

    return { username: user.username, expiresAt: user.setupTokenExpiresAt } satisfies SetupAccountInfo;
}

async function completeSetupAccount(req: Request) {
    const { token, password1, password2 } = (req.body ?? {}) as Record<string, unknown>;

    if (typeof token !== "string" || typeof password1 !== "string" || typeof password2 !== "string") {
        return [400, { message: "token, password1 and password2 are required." }];
    }
    if (password1 !== password2) {
        return [400, { message: "Entered passwords don't match." }];
    }
    if (password1.length < MIN_PASSWORD_LENGTH) {
        return [400, { message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.` }];
    }

    if (!(await user_service.completeSetup(token, password1))) {
        return INVALID_LINK;
    }
}

export default { getSetupAccount, completeSetupAccount };
