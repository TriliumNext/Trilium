import type { CreateUserResponse, UserListItem } from "@triliumnext/commons";
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

        it("marks the primary admin and the caller, with booleans rather than SQLite integers", () => {
            const sess = adminSession();
            const result = cls.init(() => usersRoute.getUsers(req({}, {}, sess))) as UserListItem[];
            const self = result.find((user) => user.userId === sess.userId);
            expect(self).toMatchObject({ isAdmin: true, isPrimaryAdmin: true, isCurrentUser: true });
            expect(result.filter((user) => user.isCurrentUser)).toHaveLength(1);
        });
    });

    describe("updateUser", () => {
        function update(userId: string, body: Record<string, unknown>, sess = adminSession()) {
            return cls.init(() => usersRoute.updateUser(req(body, { userId }, sess)));
        }

        const statusOf = (result: unknown) => (Array.isArray(result) ? result[0] : undefined);

        it("rejects non-admins, unknown users and invalid input", () => {
            const memberId = cls.init(() => user_service.createUser("update-member-spec", null, false));

            expect(statusOf(update(memberId, { username: "x" }, { userId: memberId }))).toBe(403);
            expect(statusOf(update("does-not-exist", { username: "x" }))).toBe(404);
            expect(statusOf(update(memberId, { username: "  " }))).toBe(400);
            expect(statusOf(update(memberId, { isAdmin: "yes" }))).toBe(400);
            expect(statusOf(update(memberId, { username: "admin" }))).toBe(409);

            cls.init(() => user_service.deleteUser(memberId));
        });

        it("refuses to demote the primary admin or the caller", () => {
            const sess = adminSession();
            expect(statusOf(update(sess.userId as string, { isAdmin: false }))).toBe(400);

            const otherAdminId = cls.init(() => user_service.createUser("update-other-admin-spec", null, true));
            expect(statusOf(update(otherAdminId, { isAdmin: false }, { userId: otherAdminId }))).toBe(400);
            expect(cls.init(() => user_service.isUserAdmin(otherAdminId))).toBe(true);

            getSql().execute("UPDATE users SET isDeleted = 1 WHERE userId = ?", [otherAdminId]);
        });

        it("renames, changes the email and promotes or demotes a user", () => {
            const memberId = cls.init(() => user_service.createUser("update-target-spec", "old@example.com", false));

            expect(update(memberId, { username: " renamed-spec ", email: "", isAdmin: true })).toBeUndefined();
            expect(cls.init(() => user_service.getUserById(memberId))).toMatchObject({
                username: "renamed-spec", email: null, isAdmin: 1
            });

            // Keeping one's own username is not a clash with oneself.
            expect(update(memberId, { username: "renamed-spec", isAdmin: false })).toBeUndefined();
            expect(cls.init(() => user_service.isUserAdmin(memberId))).toBe(false);

            cls.init(() => user_service.deleteUser(memberId));
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

        it("creates a user with a setup link, which the list then reports as pending", () => {
            const sess = adminSession();
            const result = cls.init(() => usersRoute.createUser(req({ username: "new-spec-user", email: "spec@example.com", isAdmin: false }, {}, sess)));
            expect(result).toMatchObject({ setupLink: { token: expect.any(String), expiresAt: expect.any(String) } });

            const { userId, setupLink } = result as CreateUserResponse;
            const listed = (cls.init(() => usersRoute.getUsers(req({}, {}, sess))) as UserListItem[])
                .find((user) => user.userId === userId);
            expect(listed).toMatchObject({ hasPassword: false, setupLinkExpiresAt: setupLink.expiresAt });
        });
    });

    describe("createSetupLink", () => {
        const statusOf = (result: unknown) => (Array.isArray(result) ? result[0] : undefined);

        it("issues a new link for a user, but not for the primary admin, nor for non-admins", () => {
            const sess = adminSession();
            const memberId = cls.init(() => user_service.createUser("setup-link-spec", null, false));

            expect(cls.init(() => usersRoute.createSetupLink(req({}, { userId: memberId }, sess)))).toHaveProperty("token");
            expect(statusOf(cls.init(() => usersRoute.createSetupLink(req({}, { userId: sess.userId as string }, sess))))).toBe(400);
            expect(statusOf(cls.init(() => usersRoute.createSetupLink(req({}, { userId: "does-not-exist" }, sess))))).toBe(404);
            expect(statusOf(cls.init(() => usersRoute.createSetupLink(req({}, { userId: memberId }, { userId: memberId }))))).toBe(403);

            cls.init(() => user_service.deleteUser(memberId));
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
