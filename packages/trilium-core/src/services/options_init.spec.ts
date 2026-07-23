import type { OptionDefinitions, OptionNames } from "@triliumnext/commons";
import { afterEach, describe, expect, it, vi } from "vitest";

import optionService from "./options.js";
import { getDefaultOptionSyncedFlag, initNotSyncedOptions, migrateSyncTimeoutFromMilliseconds } from "./options_init.js";

describe("migrateSyncTimeoutFromMilliseconds", () => {
    it("returns null when no migration is needed (values < 1000 are already in seconds)", () => {
        expect(migrateSyncTimeoutFromMilliseconds(120)).toBeNull();
        expect(migrateSyncTimeoutFromMilliseconds(500)).toBeNull();
        expect(migrateSyncTimeoutFromMilliseconds(999)).toBeNull();
        expect(migrateSyncTimeoutFromMilliseconds(NaN)).toBeNull();
    });

    it("converts milliseconds to seconds and sets display scale", () => {
        // Value is always stored in seconds; scale is for display only
        // Divisible by 60 → display as minutes
        expect(migrateSyncTimeoutFromMilliseconds(60000)).toEqual({ value: 60, scale: 60 });    // 60s, display as 1 min
        expect(migrateSyncTimeoutFromMilliseconds(120000)).toEqual({ value: 120, scale: 60 });  // 120s, display as 2 min
        expect(migrateSyncTimeoutFromMilliseconds(3600000)).toEqual({ value: 3600, scale: 60 }); // 3600s, display as 60 min

        // Not divisible by 60 → display as seconds
        expect(migrateSyncTimeoutFromMilliseconds(1000)).toEqual({ value: 1, scale: 1 });
        expect(migrateSyncTimeoutFromMilliseconds(45000)).toEqual({ value: 45, scale: 1 });
        expect(migrateSyncTimeoutFromMilliseconds(90000)).toEqual({ value: 90, scale: 1 });

        // Rounds to nearest second
        expect(migrateSyncTimeoutFromMilliseconds(120500)).toEqual({ value: 121, scale: 1 });
    });
});

describe("initNotSyncedOptions", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    /**
     * Setting up an instance against a sync server goes through `sql_init#createDatabaseForSync`,
     * which calls this function on an empty database *before* the first pull. Every option created
     * here is therefore stamped with the current time, so a synced one beats the server's older
     * value in the purely timestamp-based conflict resolution of `sync_update#updateNormalEntity`
     * and is then pushed to every instance in the cluster: setting up one fresh client silently
     * resets a setting for all of them (#10626).
     *
     * Deliberately asserted over the whole set rather than for one known option, so that any future
     * synced option added to the sync-setup path is caught here.
     */
    it("creates no synced option, since it also runs when the database is created for sync", async () => {
        const created = captureCreatedOptions();

        await initNotSyncedOptions(false, {});

        expect(created.filter(({ isSynced }) => isSynced)).toEqual([]);
    });

    /**
     * An option created here as local-only while {@link defaultOptions} declares it synced (or vice
     * versa) produces a row whose sync flag depends on which code path created the database, which
     * in turn makes the sync content hash unreconcilable across instances.
     */
    it("uses the same sync flag as the default options table for the options it shares with it", async () => {
        const created = captureCreatedOptions();

        await initNotSyncedOptions(true, {});

        const mismatched = created
            .map(({ name, isSynced }) => ({ name, isSynced, declared: getDefaultOptionSyncedFlag(name) }))
            .filter(({ isSynced, declared }) => declared !== undefined && declared !== isSynced);
        expect(mismatched).toEqual([]);
    });
});

describe("getDefaultOptionSyncedFlag", () => {
    it("returns true for an option declared as synced", () => {
        expect(getDefaultOptionSyncedFlag("seenCallToActions")).toBe(true);
        expect(getDefaultOptionSyncedFlag("imageMaxWidthHeight")).toBe(true);
    });

    it("returns false for an option declared as local-only", () => {
        expect(getDefaultOptionSyncedFlag("zoomFactor")).toBe(false);
        expect(getDefaultOptionSyncedFlag("overrideThemeFonts")).toBe(false);
    });

    it("returns undefined for an option that is not part of the default definitions", () => {
        // `theme` is initialized in initNotSyncedOptions, not in the defaultOptions table.
        expect(getDefaultOptionSyncedFlag("theme")).toBeUndefined();
        expect(getDefaultOptionSyncedFlag("doesNotExistOption" as never)).toBeUndefined();
    });
});

interface CreatedOption {
    name: OptionNames;
    value: string;
    isSynced: boolean;
}

/**
 * Replaces `optionService.createOption` with a recorder, so that the option initialization can be
 * inspected without a database (and without the entity changes that creating one would produce).
 * Restored by the `afterEach` of the calling suite.
 */
function captureCreatedOptions(): CreatedOption[] {
    const created: CreatedOption[] = [];

    vi.spyOn(optionService, "createOption").mockImplementation(
        <T extends OptionNames>(name: T, value: string | OptionDefinitions[T], isSynced: boolean) => {
            created.push({ name, value: String(value), isSynced });
        }
    );

    return created;
}
