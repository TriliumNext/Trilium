import { beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../entities/fnote.js";
import protectedSessionHolder from "./protected_session_holder.js";
import server from "./server.js";

const glob = window.glob as unknown as { isProtectedSessionAvailable: boolean };

function fakeNote(isProtected: boolean): FNote {
    return { isProtected } as FNote;
}

describe("protected_session_holder", () => {
    beforeEach(() => {
        glob.isProtectedSessionAvailable = false;
        server.post = vi.fn(async () => ({})) as typeof server.post;
    });

    it("isProtectedSessionAvailable reflects the glob flag", () => {
        glob.isProtectedSessionAvailable = false;
        expect(protectedSessionHolder.isProtectedSessionAvailable()).toBe(false);
        glob.isProtectedSessionAvailable = true;
        expect(protectedSessionHolder.isProtectedSessionAvailable()).toBe(true);
    });

    it("enableProtectedSession sets the flag and touches the session", async () => {
        protectedSessionHolder.enableProtectedSession();
        expect(protectedSessionHolder.isProtectedSessionAvailable()).toBe(true);
        expect(server.post).toHaveBeenCalledWith("login/protected/touch");
    });

    it("resetProtectedSession posts the logout endpoint", async () => {
        await protectedSessionHolder.resetProtectedSession();
        expect(server.post).toHaveBeenCalledWith("logout/protected");
    });

    it("touchProtectedSession posts only when a session is available", async () => {
        await protectedSessionHolder.touchProtectedSession();
        expect(server.post).not.toHaveBeenCalled();

        glob.isProtectedSessionAvailable = true;
        await protectedSessionHolder.touchProtectedSession();
        expect(server.post).toHaveBeenCalledWith("login/protected/touch");
    });

    it("touchProtectedSessionIfNecessary touches only for a protected note in an available session", () => {
        // null note -> nothing
        protectedSessionHolder.touchProtectedSessionIfNecessary(null);
        expect(server.post).not.toHaveBeenCalled();

        // protected note but no session -> nothing
        protectedSessionHolder.touchProtectedSessionIfNecessary(fakeNote(true));
        expect(server.post).not.toHaveBeenCalled();

        // session available but note not protected -> nothing
        glob.isProtectedSessionAvailable = true;
        protectedSessionHolder.touchProtectedSessionIfNecessary(fakeNote(false));
        expect(server.post).not.toHaveBeenCalled();

        // protected note + available session -> touch
        protectedSessionHolder.touchProtectedSessionIfNecessary(fakeNote(true));
        expect(server.post).toHaveBeenCalledWith("login/protected/touch");
    });
});
