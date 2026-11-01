import { describe, expect, it } from "vitest";

import * as cls from "./context.js";
import { getSql } from "./sql/index.js";
import userService from "./user_service.js";

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
        expect(admin).toMatchObject({ isAdmin: true });
        expect(member).toMatchObject({ username: "signed-in-spec", isAdmin: false });
        expect(member?.avatarHue).toBeGreaterThanOrEqual(0);
        expect(member?.avatarHue).not.toBe(admin?.avatarHue);

        expect(cls.init(() => userService.getSignedInUser(undefined))).toBeUndefined();
        expect(cls.init(() => userService.getSignedInUser("no-such-user"))).toBeUndefined();
    });
});
