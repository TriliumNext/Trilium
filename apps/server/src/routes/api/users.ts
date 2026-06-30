import { PrimaryAdminDeletionError, user_service } from "@triliumnext/core";
import { getSql } from "@triliumnext/core";
import type { Request } from "express";

function getCallerUser(req: Request) {
    const userId = req.session?.userId;
    return userId ? user_service.getUserById(userId) : null;
}

function getUsers(req: Request) {
    const caller = getCallerUser(req);
    if (!caller?.isAdmin) return [403, { message: "Admin access required." }];
    return user_service.listUsers();
}

function createUser(req: Request) {
    const caller = getCallerUser(req);
    if (!caller?.isAdmin) return [403, { message: "Admin access required." }];

    const { username, email, isAdmin } = req.body as { username?: unknown; email?: unknown; isAdmin?: unknown };
    if (typeof username !== "string" || username.trim() === "") {
        return [400, { message: "username is required." }];
    }
    if (isAdmin !== undefined && typeof isAdmin !== "boolean") {
        return [400, { message: "isAdmin must be a boolean." }];
    }
    const normalizedEmail = typeof email === "string" && email.trim() !== "" ? email.trim() : null;
    const trimmedUsername = username.trim();

    const exists = getSql().getValue<number>(
        "SELECT COUNT(*) FROM users WHERE username = ? AND isDeleted = 0",
        [trimmedUsername]
    );
    if (exists) {
        return [409, { message: "A user with that username already exists." }];
    }

    const userId = user_service.createUser(trimmedUsername, normalizedEmail, isAdmin === true);
    return { userId };
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

    if (target.isAdmin) {
        const activeAdminCount = getSql().getValue<number>(
            "SELECT COUNT(*) FROM users WHERE isAdmin = 1 AND isDeleted = 0"
        );
        if (activeAdminCount <= 1) {
            return [400, { message: "Cannot delete the last admin account." }];
        }
    }

    try {
        user_service.deleteUser(userId);
    } catch (e: unknown) {
        if (e instanceof PrimaryAdminDeletionError) {
            return [400, { message: e.message }];
        }
        throw e;
    }
}

export default { getUsers, createUser, deleteUser };
