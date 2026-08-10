import { describe, expect, it } from "vitest";

import { getRunningSetupOperation, holdSetup, withSetupLock } from "./setup_lock.js";

/** A piece of work that only finishes when the test says so. */
function pending<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });

    return { promise, resolve, reject };
}

describe("setup lock", () => {
    it("refuses a second operation while one is running, rather than queuing it behind it", async () => {
        const first = pending<string>();
        const running = withSetupLock("restore-backup", () => first.promise);

        expect(getRunningSetupOperation()).toBe("restore-backup");
        await expect(withSetupLock("new-document", async () => "wiped")).rejects.toThrow(
            "Cannot start 'new-document': setup is already busy with 'restore-backup'."
        );

        first.resolve("restored");
        expect(await running).toBe("restored");
        expect(getRunningSetupOperation()).toBe(null);
    });

    it("frees setup when the operation fails, so the user can try something else", async () => {
        await expect(withSetupLock("sync-from-server", async () => { throw new Error("no such host"); }))
            .rejects.toThrow("no such host");

        expect(getRunningSetupOperation()).toBe(null);
        await expect(withSetupLock("new-document", async () => "created")).resolves.toBe("created");
    });

    it("reserves setup for an operation that has not started yet, until the hold is released", async () => {
        const release = holdSetup("restore-backup");

        expect(getRunningSetupOperation()).toBe("restore-backup");
        await expect(withSetupLock("new-document", async () => "wiped")).rejects.toThrow(/already busy/);
        expect(() => holdSetup("restore-backup")).toThrow(/already reserved/);

        release();

        expect(getRunningSetupOperation()).toBe(null);
        await expect(withSetupLock("new-document", async () => "created")).resolves.toBe("created");
    });

    it("lets the operation a hold was taken for actually run, which is the point of the hold", async () => {
        // The upload reserves setup, then the restore it was reserved for runs — and must not be
        // turned away by its own reservation.
        const release = holdSetup("restore-backup");

        await expect(withSetupLock("restore-backup", async () => "restored")).resolves.toBe("restored");

        // The hold outlives the attempt, so a second one (a corrected passphrase) is still covered.
        expect(getRunningSetupOperation()).toBe("restore-backup");
        await expect(withSetupLock("new-document", async () => "wiped")).rejects.toThrow(/already busy/);
        await expect(withSetupLock("restore-backup", async () => "restored again")).resolves.toBe("restored again");

        release();
        expect(getRunningSetupOperation()).toBe(null);
    });

    it("does not let a second run of the same operation join the first", async () => {
        const first = pending<string>();
        const running = withSetupLock("restore-backup", () => first.promise);

        await expect(withSetupLock("restore-backup", async () => "second")).rejects.toThrow(/already running/);

        first.resolve("first");
        await running;
    });

    it("refuses a hold while an operation is running", async () => {
        const first = pending<void>();
        const running = withSetupLock("new-document", () => first.promise);

        expect(() => holdSetup("restore-backup")).toThrow(/already busy with 'new-document'/);

        first.resolve();
        await running;
    });
});
