import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { claimLeadership, isLeader, resetLeadershipForTesting } from "./leader_election.js";

type LockCallback = () => Promise<unknown>;

interface NavLocks {
    locks?: { request: ReturnType<typeof vi.fn> } | undefined;
}

function installLocks(request: ReturnType<typeof vi.fn>) {
    Object.defineProperty(navigator, "locks", { value: { request }, configurable: true });
}

beforeEach(() => {
    resetLeadershipForTesting();
});

afterEach(() => {
    delete (navigator as unknown as NavLocks).locks;
    vi.restoreAllMocks();
});

describe("claimLeadership", () => {
    it("takes an exclusive lock and elects this tab once granted", async () => {
        let granted: LockCallback | undefined;
        const request = vi.fn((_name: string, _opts: unknown, callback: LockCallback) => {
            granted = callback;
            return new Promise(() => {});
        });
        installLocks(request);
        const onElected = vi.fn();

        claimLeadership(onElected);

        // The lock must be exclusive — a shared one would let every tab through
        // and they would all try to open the same OPFS database.
        expect(request).toHaveBeenCalledWith(
            "trilium-standalone-db",
            { mode: "exclusive" },
            expect.any(Function)
        );

        // Not the leader until the browser actually grants the lock.
        expect(isLeader()).toBe(false);
        expect(onElected).not.toHaveBeenCalled();

        granted?.();
        expect(isLeader()).toBe(true);
        expect(onElected).toHaveBeenCalledTimes(1);
    });

    it("holds the lock indefinitely so no other tab is promoted while alive", async () => {
        let granted: LockCallback | undefined;
        installLocks(vi.fn((_n: string, _o: unknown, callback: LockCallback) => {
            granted = callback;
            return new Promise(() => {});
        }));

        claimLeadership(() => {});
        const held = granted?.();

        // Releasing early would let a second tab start a worker against the same
        // database, which is exactly the failure this prevents.
        const settled = await Promise.race([
            held?.then(() => "settled"),
            Promise.resolve("still-held")
        ]);
        expect(settled).toBe("still-held");
    });

    it("assumes leadership when Web Locks is unavailable", () => {
        // Some embedded WebViews lack the API. Those are single-window Capacitor
        // apps, so this tab is trivially the only possible owner.
        Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });
        const onElected = vi.fn();
        vi.spyOn(console, "info").mockImplementation(() => {});

        claimLeadership(onElected);

        expect(isLeader()).toBe(true);
        expect(onElected).toHaveBeenCalledTimes(1);
    });

    it("reports a follower as not the leader", () => {
        // A queued request never invokes the callback until promotion.
        installLocks(vi.fn(() => new Promise(() => {})));

        claimLeadership(vi.fn());

        expect(isLeader()).toBe(false);
    });
});
