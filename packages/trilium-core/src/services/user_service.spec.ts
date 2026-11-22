import { describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "../errors.js";
import * as cls from "./context.js";
import { getSql } from "./sql/index.js";
import userService, { PrimaryAdminDemotionError } from "./user_service.js";

const isBrowserRuntime = typeof window !== "undefined";
if (isBrowserRuntime) {
    vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });
}

describe("getCurrentUser", () => {
    it("looks up the user in CLS once per context, follows a change of user and refuses a missing one", () => {
        const adminId = cls.init(() => userService.getAdminUserId());
        const memberId = cls.init(() => userService.createUser("current-user-spec", null, false));

        cls.init(() => {
            expect(() => userService.getCurrentUser()).toThrow(ForbiddenError);

            cls.set("userId", memberId);
            const member = userService.getCurrentUser();
            expect(member).toMatchObject({ userId: memberId, username: "current-user-spec", isAdmin: 0 });
            expect(userService.getCurrentUser()).toBe(member);

            cls.set("userId", adminId);
            expect(userService.getCurrentUser()).toMatchObject({ userId: adminId, isAdmin: 1 });

            const deletedId = userService.createUser("current-user-deleted-spec", null, false);
            userService.deleteUser(deletedId);
            cls.set("userId", deletedId);
            expect(() => userService.getCurrentUser()).toThrow(ForbiddenError);
        });

        expect(() => cls.init(() => userService.getCurrentUser())).toThrow(ForbiddenError);
    });
});

describe("getSignedInUser", () => {
    it("describes the signed-in user once someone other than the admin can sign in", async () => {
        const adminId = cls.init(() => userService.getAdminUserId());
        getSql().execute("UPDATE users SET passwordHash = NULL, passwordSalt = NULL WHERE userId != ?", [ adminId ]);

        // A single-user instance has nobody to tell apart.
        expect(cls.init(() => userService.getSignedInUser(adminId))).toBeUndefined();

        const memberId = cls.init(() => userService.createUser("signed-in-spec", null, false));
        const link = cls.init(() => userService.createSetupLink(memberId));
        expect(await cls.init(() => userService.completeSetup(link.token, "hunter22"))).toBe(true);

        const admin = cls.init(() => userService.getSignedInUser(adminId));
        const member = cls.init(() => userService.getSignedInUser(memberId));
        expect(admin).toMatchObject({ userId: adminId, isAdmin: true });
        expect(member).toMatchObject({ userId: memberId, username: "signed-in-spec", isAdmin: false });
        expect(member?.avatarHue).toBeGreaterThanOrEqual(0);
        expect(member?.avatarHue).not.toBe(admin?.avatarHue);

        expect(cls.init(() => userService.getSignedInUser(undefined))).toBeUndefined();
        expect(cls.init(() => userService.getSignedInUser("no-such-user"))).toBeUndefined();
    });
});

describe("updateUser", () => {
    it("updates a member, ignores an unknown user and keeps the primary admin an admin", () => {
        cls.init(() => {
            const adminId = userService.getAdminUserId();
            const memberId = userService.createUser("update-user-spec", "a@example.com", false);

            userService.updateUser(memberId, { isAdmin: true, email: null });
            expect(userService.getUserById(memberId)).toMatchObject({ username: "update-user-spec", email: null, isAdmin: 1 });
            userService.updateUser(memberId, { username: "update-user-renamed-spec", isAdmin: false });
            expect(userService.getUserById(memberId)).toMatchObject({ username: "update-user-renamed-spec", isAdmin: 0 });

            expect(() => userService.updateUser("no-such-user", { username: "ghost" })).not.toThrow();
            expect(userService.getUserById("no-such-user")).toBeNull();

            expect(() => userService.updateUser(adminId, { isAdmin: false })).toThrow(PrimaryAdminDemotionError);
            expect(userService.isUserAdmin(adminId)).toBe(true);
        });
    });
});

describe("setup links and passwords", () => {
    it("refuses an empty or spent link and accepts only a member's own password", async () => {
        const memberId = cls.init(() => userService.createUser("verify-password-spec", null, false));
        const link = cls.init(() => userService.createSetupLink(memberId));

        expect(cls.init(() => userService.getUserBySetupToken(""))).toBeNull();
        expect(await cls.init(() => userService.completeSetup("", "hunter22"))).toBe(false);
        expect(await cls.init(() => userService.completeSetup(link.token, "hunter22"))).toBe(true);
        expect(await cls.init(() => userService.completeSetup(link.token, "again"))).toBe(false);

        expect(await cls.init(() => userService.verifyUserPassword("verify-password-spec", "hunter22")))
            .toMatchObject({ userId: memberId, username: "verify-password-spec" });
        expect(await cls.init(() => userService.verifyUserPassword("verify-password-spec", "wrong"))).toBeNull();
        expect(await cls.init(() => userService.verifyUserPassword("no-such-username-spec", "hunter22"))).toBeNull();
    });
});
