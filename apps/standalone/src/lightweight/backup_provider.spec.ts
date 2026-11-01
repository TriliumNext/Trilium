import { options } from "@triliumnext/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import StandaloneBackupService, {
    removeBackupLeftovers,
    type SnapshotPool
} from "./backup_provider.js";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("StandaloneBackupService", () => {
    function service() {
        return new StandaloneBackupService(options);
    }

    it("schedules nothing, since nothing is ever stored", () => {
        expect(() => service().scheduleBackups()).not.toThrow();
    });

    it("declines a stored backup with a warning, and without blocking the caller", async () => {
        // The pre-migration backup goes through here, and a migration must not be stopped by a
        // backup this platform simply does not have.
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        await expect(service().backupNow("before-migration")).resolves.toBe("");
        expect(warn.mock.calls.join("\n")).toMatch(/before-migration/);
    });

    it("has no backups to list and none to serve", async () => {
        expect(await service().getExistingBackups()).toEqual([]);
        expect(await service().getBackupContent()).toBeNull();
    });
});

describe("removeBackupLeftovers", () => {
    it("unlinks both of the old snapshot machinery's leftovers", () => {
        const unlinked: string[] = [];
        const pool: SnapshotPool = {
            unlink: (name: string) => {
                unlinked.push(name);
                return true;
            }
        };

        removeBackupLeftovers(pool);
        expect(unlinked).toEqual([ "/backup-snapshot.db", "/backup-snapshot.db-journal" ]);
    });

    it("never throws past a pool that refuses", () => {
        const refusing: SnapshotPool = {
            unlink: () => {
                throw new Error("in use");
            }
        };

        expect(() => removeBackupLeftovers(refusing)).not.toThrow();
    });
});
