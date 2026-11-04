import { describe, expect, it } from "vitest";

import * as cls from "./context.js";
import { getSql } from "./sql/index.js";
import userService from "./user_service.js";

describe("getCurrentUser", () => {
    it("looks up the user in CLS once per context and follows a change of user", () => {
        const adminId = cls.init(() => userService.getAdminUserId());
        const memberId = cls.init(() => userService.createUser("current-user-spec", null, false));

        cls.init(() => {
            expect(userService.getCurrentUser()).toBeNull();

            cls.set("userId", memberId);
            const member = userService.getCurrentUser();
            expect(member).toMatchObject({ userId: memberId, username: "current-user-spec", isAdmin: 0 });
            expect(userService.getCurrentUser()).toBe(member);

            cls.set("userId", adminId);
            expect(userService.getCurrentUser()).toMatchObject({ userId: adminId, isAdmin: 1 });
        });

        expect(cls.init(() => userService.getCurrentUser())).toBeNull();
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
