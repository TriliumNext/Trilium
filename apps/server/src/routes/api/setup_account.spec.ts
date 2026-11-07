import { cls, getSql, user_service } from "@triliumnext/core";
import type { Request } from "express";
import { beforeAll, describe, expect, it } from "vitest";

import sqlInit from "../../services/sql_init.js";
import setupAccountRoute from "./setup_account.js";

function req(body: Record<string, unknown>) {
    return { body } as unknown as Request;
}

const statusOf = (result: unknown) => (Array.isArray(result) ? result[0] : undefined);

function check(token: unknown) {
    return cls.init(() => setupAccountRoute.getSetupAccount(req({ token })));
}

function complete(token: unknown, password1: unknown, password2: unknown = password1) {
    return cls.init(() => setupAccountRoute.completeSetupAccount(req({ token, password1, password2 })));
}

function storedPassword(userId: string) {
    return getSql().getRow<{ passwordHash: string | null; passwordSalt: string | null; setupTokenHash: string | null }>(
        "SELECT passwordHash, passwordSalt, setupTokenHash FROM users WHERE userId = ?", [userId]
    );
}

describe("Setup account API", () => {
    let counter = 0;

    beforeAll(async () => {
        sqlInit.initializeDb();
        await sqlInit.dbReady;
    });

    function newUserWithLink() {
        const userId = cls.init(() => user_service.createUser(`setup-spec-${++counter}`, null, false));
        const link = cls.init(() => user_service.createSetupLink(userId));
        return { userId, link };
    }

    it("tells the screen whose link it is, and refuses anything else", () => {
        const { userId, link } = newUserWithLink();

        expect(check(link.token)).toEqual({ username: `setup-spec-${counter}`, expiresAt: link.expiresAt });
        expect(statusOf(check("not-a-token"))).toBe(404);
        expect(statusOf(check(undefined))).toBe(404);

        // Only a hash is stored, never the token itself.
        expect(storedPassword(userId)?.setupTokenHash).not.toBe(link.token);
    });

    it("sets a salted password hash and spends the link", async () => {
        const { userId, link } = newUserWithLink();

        expect(await complete(link.token, "hunter22")).toBeUndefined();

        const stored = storedPassword(userId);
        expect(stored?.passwordHash).toBeTruthy();
        expect(stored?.passwordHash).not.toContain("hunter22");
        expect(stored?.passwordSalt).toBeTruthy();
        expect(stored?.setupTokenHash).toBeNull();
        expect(cls.init(() => user_service.getUserById(userId))?.hasPassword).toBe(1);

        expect(statusOf(await complete(link.token, "another1"))).toBe(404);
        expect(statusOf(check(link.token))).toBe(404);
    });

    it("validates the password before spending the link", async () => {
        const { link } = newUserWithLink();

        expect(statusOf(await complete(link.token, "hunter22", "hunter23"))).toBe(400);
        expect(statusOf(await complete(link.token, "abc"))).toBe(400);
        expect(statusOf(await complete(link.token, undefined))).toBe(400);

        expect(check(link.token)).toHaveProperty("username");
    });

    it("refuses expired links, links replaced by a newer one, and links of deleted users", async () => {
        const expired = newUserWithLink();
        getSql().execute("UPDATE users SET setupTokenExpiresAt = '2000-01-01 00:00:00.000Z' WHERE userId = ?", [expired.userId]);
        expect(statusOf(check(expired.link.token))).toBe(404);
        expect(statusOf(await complete(expired.link.token, "hunter22"))).toBe(404);

        const replaced = newUserWithLink();
        const newer = cls.init(() => user_service.createSetupLink(replaced.userId));
        expect(statusOf(check(replaced.link.token))).toBe(404);
        expect(check(newer.token)).toHaveProperty("username");

        const deleted = newUserWithLink();
        cls.init(() => user_service.deleteUser(deleted.userId));
        expect(statusOf(check(deleted.link.token))).toBe(404);
    });
});
