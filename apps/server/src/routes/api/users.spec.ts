import { cls, getSql, user_service } from "@triliumnext/core";
import type { Request } from "express";
import { beforeAll, describe, expect, it } from "vitest";

import sqlInit from "../../services/sql_init.js";
import usersRoute from "./users.js";

function req(body: Record<string, unknown> = {}, params: Record<string, string> = {}, session: Record<string, unknown> = {}) {
    return { body, params, session } as unknown as Request<{ userId: string }>;
}

function adminSession(): Record<string, unknown> {
    const adminUserId = getSql().getValue<string>("SELECT value FROM options WHERE name = 'adminUserId'");
    return { userId: adminUserId };
}

describe("Users API", () => {
    beforeAll(async () => {
        sqlInit.initializeDb();
        await sqlInit.dbReady;
    });

    describe("getUsers", () => {
        it("returns 403 when session has no userId", () => {
            const result = cls.init(() => usersRoute.getUsers(req()));
            expect(Array.isArray(result) ? result[0] : null).toBe(403);
        });

        it("returns 403 when session userId is not an admin", () => {
            const nonAdminId = cls.init(() => user_service.createUser("non-admin-spec", null, false));
            const result = cls.init(() => usersRoute.getUsers(req({}, {}, { userId: nonAdminId })));
            expect(Array.isArray(result) ? result[0] : null).toBe(403);
            cls.init(() => user_service.deleteUser(nonAdminId));
        });

        it("returns the user list for an admin session", () => {
            const result = cls.init(() => usersRoute.getUsers(req({}, {}, adminSession())));
            expect(Array.isArray(result)).toBe(true);
            expect(typeof (result as unknown[])[0]).not.toBe("number");
        });
    });

    describe("createUser", () => {
        it("returns 403 without admin session", () => {
            const result = cls.init(() => usersRoute.createUser(req({ username: "test" })));
            expect(Array.isArray(result) && result[0]).toBe(403);
        });

        it("returns 400 when username is missing or blank", () => {
            const sess = adminSession();
            const missing = cls.init(() => usersRoute.createUser(req({}, {}, sess)));
            expect(Array.isArray(missing) && missing[0]).toBe(400);

            const blank = cls.init(() => usersRoute.createUser(req({ username: "  " }, {}, sess)));
            expect(Array.isArray(blank) && blank[0]).toBe(400);
        });

        it("returns 409 on duplicate username", () => {
            const sess = adminSession();
            cls.init(() => usersRoute.createUser(req({ username: "dup-spec-user" }, {}, sess)));
            const result = cls.init(() => usersRoute.createUser(req({ username: "dup-spec-user" }, {}, sess)));
            expect(Array.isArray(result) && result[0]).toBe(409);
        });

        it("creates a user and returns a userId", () => {
            const sess = adminSession();
            const result = cls.init(() => usersRoute.createUser(req({ username: "new-spec-user", email: "spec@example.com", isAdmin: false }, {}, sess)));
            expect(result).toHaveProperty("userId");
        });
    });

    describe("deleteUser", () => {
        it("returns 403 without admin session", () => {
            const result = cls.init(() => usersRoute.deleteUser(req({}, { userId: "x" })));
            expect(Array.isArray(result) && result[0]).toBe(403);
        });

        it("returns 400 when trying to delete self", () => {
            const sess = adminSession();
            const result = cls.init(() => usersRoute.deleteUser(req({}, { userId: sess.userId as string }, sess)));
            expect(Array.isArray(result) && result[0]).toBe(400);
        });

        it("returns 400 when trying to delete the last admin", () => {
            const secondAdminId = cls.init(() => user_service.createUser("second-admin-spec", null, true));
            const sess = { userId: secondAdminId };

            const adminId = getSql().getValue<string>("SELECT value FROM options WHERE name = 'adminUserId'");
            const result = cls.init(() => usersRoute.deleteUser(req({}, { userId: adminId }, sess)));
            expect(Array.isArray(result) && result[0]).toBe(400);

            // Cleanup
            getSql().execute("UPDATE users SET isDeleted = 1 WHERE userId = ?", [secondAdminId]);
        });

        it("returns 404 for a non-existent userId", () => {
            const sess = adminSession();
            const result = cls.init(() => usersRoute.deleteUser(req({}, { userId: "does-not-exist" }, sess)));
            expect(Array.isArray(result) && result[0]).toBe(404);
        });

        it("soft-deletes a non-admin user", () => {
            const sess = adminSession();
            const created = cls.init(() => usersRoute.createUser(req({ username: "to-delete-spec" }, {}, sess)));
            expect(created).toHaveProperty("userId");
            const { userId } = created as { userId: string };

            cls.init(() => usersRoute.deleteUser(req({}, { userId }, sess)));

            const user = cls.init(() => user_service.getUserById(userId));
            expect(user).toBeNull();
        });
    });
});
