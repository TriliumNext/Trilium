import type { Request } from "express";
import { beforeEach, describe, expect, it } from "vitest";

import packageOperationLockRoute from "../routes/api/package_operation_lock.js";
import {
    acquire,
    PACKAGE_OPERATION_LOCK_TTL_MS,
    release,
    renew,
    resetForTests
} from "./package_operation_lock.js";

describe("package operation lock", () => {
    beforeEach(() => resetForTests());

    function request(body: Record<string, unknown>) {
        return packageOperationLockRoute.handle({ body } as Request);
    }

    it("allows one owner and rejects a second owner until release", () => {
        const first = acquire("community-packages", 1000);
        expect(first.ok).toBe(true);
        if (!first.ok) return;

        const second = acquire("community-packages", 1001);
        expect(second).toEqual({ ok: false, expiresAt: first.expiresAt });
        expect(release("community-packages", first.token!, 1002)).toBe(true);
        expect(acquire("community-packages", 1003).ok).toBe(true);
    });

    it("renews only for the current owner", () => {
        const first = acquire("community-packages", 1000);
        expect(first.ok).toBe(true);
        if (!first.ok) return;

        expect(renew("community-packages", "wrong-token", 2000).ok).toBe(false);
        const renewed = renew("community-packages", first.token!, 2000);
        expect(renewed).toEqual({
            ok: true,
            token: first.token,
            expiresAt: 2000 + PACKAGE_OPERATION_LOCK_TTL_MS
        });
    });

    it("allows a new owner after the lease expires", () => {
        const first = acquire("community-packages", 1000);
        expect(first.ok).toBe(true);
        const second = acquire("community-packages", first.ok ? first.expiresAt : 1000);
        expect(second.ok).toBe(true);
    });

    it("keeps unrelated lock names independent", () => {
        expect(acquire("community-packages", 1000).ok).toBe(true);
        expect(acquire("other-operation", 1000).ok).toBe(true);
    });

    it("validates the API action, lock name, and owner token", () => {
        expect(request({ action: "unknown" })).toEqual([400, { error: "action must be acquire, renew, or release" }]);
        expect(request({ action: "acquire", name: "other-operation" })).toEqual([400, { error: "name must be community-packages" }]);
        expect(request({ action: "renew", token: "" })).toEqual([400, { error: "token is required" }]);
        expect(request({ action: "release", token: "wrong-token" })).toEqual([409, { error: "operation lock is missing or owned by another client" }]);
    });

    it("serializes API owners and permits only the owner to release", () => {
        const first = request({ action: "acquire" });
        expect(first).toMatchObject({ token: expect.any(String), expiresAt: expect.any(Number) });
        const token = (first as { token: string }).token;

        expect(request({ action: "acquire" })).toEqual([409, { error: "operation is already in progress", expiresAt: expect.any(Number) }]);
        expect(request({ action: "release", token: "wrong-token" })).toEqual([409, { error: "operation lock is missing or owned by another client" }]);
        expect(request({ action: "release", token })).toEqual({});
        expect(request({ action: "acquire" })).toMatchObject({ token: expect.any(String), expiresAt: expect.any(Number) });
    });
});
