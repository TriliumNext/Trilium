import { beforeEach, describe, expect, it, vi } from "vitest";

/** A fresh module each time, since what it holds is deliberately process-wide. */
async function freshModule() {
    vi.resetModules();
    return import("./setup_auth.js");
}

beforeEach(() => vi.resetModules());

describe("the token that unlocks a wizard standing over a knowledge base", () => {
    it("holds nothing until the password has bought one", async () => {
        // What the request layer puts on every call, and `null` is what keeps the header off every
        // page but an unlocked wizard.
        const { getSetupAuthToken } = await freshModule();

        expect(getSetupAuthToken()).toBeNull();
    });

    it("hands back what it was given, for as long as the page lives", async () => {
        const { getSetupAuthToken, setSetupAuthToken } = await freshModule();

        setSetupAuthToken("a-token");

        expect(getSetupAuthToken()).toBe("a-token");
    });

    it("keeps nothing across a reload, which asks for the password again", async () => {
        // Held in memory only, which is the right answer for a screen that can erase a knowledge
        // base and is often left open on a shared machine.
        const first = await freshModule();
        first.setSetupAuthToken("a-token");

        const reloaded = await freshModule();

        expect(reloaded.getSetupAuthToken()).toBeNull();
    });
});
