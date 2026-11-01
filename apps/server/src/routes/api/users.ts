import type { CreateUserResponse, SetupLinkResponse, UserListItem } from "@triliumnext/commons";
import { date_utils, getSql, PrimaryAdminDeletionError, PrimaryAdminDemotionError, user_service } from "@triliumnext/core";
import type { Request } from "express";

import { revokeUserSessions } from "../session_parser.js";

function getCallerUser(req: Request) {
    const userId = req.session?.userId;
    return userId ? user_service.getUserById(userId) : null;
}

function getUsers(req: Request) {
    const caller = getCallerUser(req);
    if (!caller?.isAdmin) return [403, { message: "Admin access required." }];

    const adminUserId = user_service.getAdminUserId();
    return user_service.listUsers().map((user): UserListItem => ({
        userId: user.userId,
        username: user.username,
        email: user.email,
        isAdmin: !!user.isAdmin,
        isPrimaryAdmin: user.userId === adminUserId,
        isCurrentUser: user.userId === caller.userId,
        hasPassword: !!user.hasPassword,
        setupLinkExpiresAt: isSetupLinkValid(user.setupTokenExpiresAt) ? user.setupTokenExpiresAt : null,
        dateCreated: user.dateCreated
    }));
}

function createUser(req: Request) {
    const caller = getCallerUser(req);
    if (!caller?.isAdmin) return [403, { message: "Admin access required." }];

    const input = parseUserInput(req.body, true);
    if ("error" in input) return [400, { message: input.error }];
    const { username, email, isAdmin } = input;

    if (isUsernameTaken(username)) {
        return [409, { message: "A user with that username already exists." }];
    }

    const userId = user_service.createUser(username, email ?? null, isAdmin === true);
    const setupLink = user_service.createSetupLink(userId);
    return { userId, setupLink } satisfies CreateUserResponse;
}

/** Issues a new setup link for a user, replacing any earlier one; for a user with a password, a reset. */
function createSetupLink(req: Request<{ userId: string }>) {
    const caller = getCallerUser(req);
    if (!caller?.isAdmin) return [403, { message: "Admin access required." }];

    const { userId } = req.params;
    if (!user_service.getUserById(userId)) return [404, { message: "User not found." }];

    // The primary admin signs in with the instance password, which has its own way of being changed.
    if (userId === user_service.getAdminUserId()) {
        return [400, { message: "The primary admin signs in with the instance password." }];
    }

    return user_service.createSetupLink(userId) satisfies SetupLinkResponse;
}

function updateUser(req: Request<{ userId: string }>) {
    const caller = getCallerUser(req);
    if (!caller?.isAdmin) return [403, { message: "Admin access required." }];

    const { userId } = req.params;
    const target = user_service.getUserById(userId);
    if (!target) return [404, { message: "User not found." }];

    const input = parseUserInput(req.body, false);
    if ("error" in input) return [400, { message: input.error }];

    if (input.username !== undefined && isUsernameTaken(input.username, userId)) {
        return [409, { message: "A user with that username already exists." }];
    }

    if (input.isAdmin === false && target.isAdmin) {
        if (userId === caller.userId) {
            return [400, { message: "Cannot remove your own admin rights." }];
        }
        if (countActiveAdmins() <= 1) {
            return [400, { message: "Cannot remove admin rights from the last admin account." }];
        }
    }

    try {
        user_service.updateUser(userId, input);
    } catch (e: unknown) {
        if (e instanceof PrimaryAdminDemotionError) {
            return [400, { message: e.message }];
        }
        throw e;
    }
}

function deleteUser(req: Request<{ userId: string }>) {
    const caller = getCallerUser(req);
    if (!caller?.isAdmin) return [403, { message: "Admin access required." }];

    const { userId } = req.params;
    if (userId === caller.userId) {
        return [400, { message: "Cannot delete your own account." }];
    }

    const target = user_service.getUserById(userId);
    if (!target) return [404, { message: "User not found." }];

    if (target.isAdmin && countActiveAdmins() <= 1) {
        return [400, { message: "Cannot delete the last admin account." }];
    }

    try {
        user_service.deleteUser(userId);
    } catch (e: unknown) {
        if (e instanceof PrimaryAdminDeletionError) {
            return [400, { message: e.message }];
        }
        throw e;
    }

    revokeUserSessions(userId, "User deleted");
}

export default { getUsers, createUser, createSetupLink, updateUser, deleteUser };

interface ParsedUserInput {
    username?: string;
    email?: string | null;
    isAdmin?: boolean;
}

/**
 * Validates a create (every field may be given, `username` must be) or an update (only the fields
 * being changed). A blank email is stored as none.
 */
function parseUserInput(body: unknown, requireUsername: true): (ParsedUserInput & { username: string }) | { error: string };
function parseUserInput(body: unknown, requireUsername: false): ParsedUserInput | { error: string };
function parseUserInput(body: unknown, requireUsername: boolean): ParsedUserInput | { error: string } {
    const { username, email, isAdmin } = (body ?? {}) as Record<string, unknown>;
    const result: ParsedUserInput = {};

    if (username !== undefined || requireUsername) {
        if (typeof username !== "string" || username.trim() === "") {
            return { error: "username is required." };
        }
        result.username = username.trim();
    }

    if (email !== undefined) {
        if (email !== null && typeof email !== "string") {
            return { error: "email must be a string." };
        }
        result.email = typeof email === "string" && email.trim() !== "" ? email.trim() : null;
    }

    if (isAdmin !== undefined) {
        if (typeof isAdmin !== "boolean") {
            return { error: "isAdmin must be a boolean." };
        }
        result.isAdmin = isAdmin;
    }

    return result;
}

function isUsernameTaken(username: string, exceptUserId?: string) {
    return !!getSql().getValue<number>(
        "SELECT COUNT(*) FROM users WHERE username = ? AND isDeleted = 0 AND userId != ?",
        [username, exceptUserId ?? ""]
    );
}

function isSetupLinkValid(expiresAt: string | null) {
    return !!expiresAt && expiresAt > date_utils.utcNowDateTime();
}

function countActiveAdmins() {
    return getSql().getValue<number>("SELECT COUNT(*) FROM users WHERE isAdmin = 1 AND isDeleted = 0");
}
