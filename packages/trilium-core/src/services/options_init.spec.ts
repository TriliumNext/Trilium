import type {
    DeviceRecordEntry,
    EntityChange,
    EtapiTokenRow,
    OptionDefinitions,
    OptionMap,
    OptionNames,
    OptionRow
} from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import becca from "../becca/becca.js";
import BEtapiToken from "../becca/entities/betapi_token.js";
import BOption from "../becca/entities/boption.js";
import { getConfig, initConfig } from "./config.js";
import consistencyChecks from "./consistency_checks.js";
import * as cls from "./context.js";
import { OPENED_DATABASE_SIGNS } from "./database_validation.js";
import entityChangesService from "./entity_changes.js";
import notes from "./notes.js";
import optionService from "./options.js";
import {
    getDefaultOptionSyncedFlag,
    getDeviceOptionNames,
    initDocumentOptions,
    initNotSyncedOptions,
    initStartupOptions,
    isDeviceOption,
    migrateSyncTimeoutFromMilliseconds
} from "./options_init.js";
import { getPlatform } from "./platform.js";
import { getSql } from "./sql/index.js";
import * as utils from "./utils/index.js";
import dateUtils from "./utils/date.js";

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

describe("initStartupOptions", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    /** Runs the startup defaults against `existing`, returning what they would create and set. */
    function runWith(existing: Record<string, string>, env: Record<string, string> = {}) {
        vi.spyOn(optionService, "getOptionMap").mockReturnValue(existing as OptionMap);
        vi.spyOn(getPlatform(), "getEnv").mockImplementation((key) => env[key]);
        const created = new Map<string, string>();
        const set = new Map<string, string>();
        vi.spyOn(optionService, "createOption").mockImplementation((name, value) => {
            created.set(name, String(value));
        });
        vi.spyOn(optionService, "setOption").mockImplementation((name, value) => {
            set.set(name, String(value));
        });
        initStartupOptions();
        return { created, set };
    }

    it("creates only the missing options", () => {
        const { created } = runWith({ locale: "de" });
        expect(created.has("locale")).toBe(false);
        expect(created.get("revisionSnapshotTimeInterval")).toBe("600");
    });

    it("derives defaults from the options already there", () => {
        vi.spyOn(utils, "isWindows").mockReturnValueOnce(true).mockReturnValue(false);
        const fresh = runWith({});
        expect(fresh.created.get("syncServerTimeoutTimeScale")).toBe("60");
        expect(fresh.created.get("zoomFactor")).toBe("0.9");
        expect(fresh.created.get("aiEnabled")).toBe("false");
        expect(fresh.created.get("codeNoteTheme")).toBe("default:vs-code-dark");
        expect(fresh.created.get("codeBlockTheme")).toBe("default:stackoverflow-dark");
        expect(fresh.set.size).toBe(0);

        const legacy = runWith({ syncServerTimeout: "120000", experimentalFeatures: "[\"llm\"]", theme: "light" });
        expect(legacy.set.get("syncServerTimeout")).toBe("120");
        expect(legacy.created.get("syncServerTimeoutTimeScale")).toBe("60");
        expect(legacy.created.get("zoomFactor")).toBe("1.0");
        expect(legacy.created.get("aiEnabled")).toBe("true");
        expect(legacy.created.get("codeNoteTheme")).toBe("default:vs-code-light");
        expect(legacy.created.get("codeBlockTheme")).toBe("default:stackoverflow-light");

        expect(runWith({ syncServerTimeout: "60", experimentalFeatures: "[]" }).created.get("aiEnabled")).toBe("false");
        for (const [ theme, expected ] of [
            [ "next-light", "default:vs-code-light" ],
            [ "dark", "default:vs-code-dark" ],
            [ "next-dark", "default:vs-code-dark" ]
        ]) {
            expect(runWith({ theme }).created.get("codeNoteTheme"), theme).toBe(expected);
        }
    });

    it("opens the start note, or the root in safe mode, when the environment asks for it", () => {
        const startNote = runWith({}, { TRILIUM_START_NOTE_ID: "abc123" }).set.get("openNoteContexts");
        expect(JSON.parse(startNote ?? "")).toEqual([ { notePath: "abc123", active: true } ]);

        const safeMode = runWith({}, { TRILIUM_SAFE_MODE: "true" }).set.get("openNoteContexts");
        expect(JSON.parse(safeMode ?? "")).toEqual([ { notePath: "root", active: true } ]);
    });
});

describe("the options of the device", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("names every option that the code declares local-only, and nothing else", async () => {
        const created = captureCreatedOptions();
        vi.spyOn(optionService, "getOptionMap").mockReturnValue({} as OptionMap);
        vi.spyOn(optionService, "setOption").mockImplementation(() => {});

        await initNotSyncedOptions(true, {});
        initDocumentOptions();
        initStartupOptions();

        const local = created.filter(({ isSynced }) => !isSynced).map(({ name }) => name);
        expect(local.filter((name) => !isDeviceOption(name))).toEqual([]);
        expect(getDeviceOptionNames().filter((name) => !local.includes(name as OptionNames)))
            .toEqual([]);
        expect(created.filter(({ isSynced, name }) => isSynced && isDeviceOption(name)))
            .toEqual([]);
    });

    it("creates no option that only an opening creates on the paths of setup", async () => {
        const created = captureCreatedOptions();

        await initNotSyncedOptions(false, {});
        initDocumentOptions();

        expect(created.map(({ name }) => name)
            .filter((name) => OPENED_DATABASE_SIGNS.includes(name))).toEqual([]);
    });
});

describe("the start step", () => {
    let snapshot: { options: Record<string, unknown>[]; changes: Record<string, unknown>[] };

    beforeEach(() => {
        snapshot = {
            options: getSql().getRows("SELECT * FROM options"),
            changes: getSql().getRows("SELECT * FROM entity_changes WHERE entityName = 'options'")
        };
        cls.init(() => optionService.setOption("startupRepairRecord", ""));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        cls.init(() => {
            const sql = getSql();
            sql.execute("DELETE FROM options");
            sql.execute("DELETE FROM entity_changes WHERE entityName = 'options'");
            for (const row of snapshot.options) {
                sql.replace("options", row);
            }
            for (const row of snapshot.changes) {
                sql.replace("entity_changes", row);
            }
        });
        for (const name of Object.keys(becca.options)) {
            delete becca.options[name];
        }
        for (const row of snapshot.options) {
            new BOption(row as unknown as OptionRow);
        }
    });

    it.each([ "row", "change" ] as const)("repairs planted device options, %s flag on", (flag) => {
        const documentSecret = optionService.getOption("documentSecret");
        plant("mfaMethod", "", flag);
        plant("syncServerHost", "https://peer.example", flag);
        plant("lastSyncedPull", "999", flag);
        plant("documentSecret", documentSecret, flag);
        plant("totpLastUsedStep", "99999999999", flag);

        runStartStep();

        expect(stored("mfaMethod")).toEqual({ value: "totp", isSynced: 0, isChangeSynced: 0 });
        expect(stored("syncServerHost")).toEqual({ value: "", isSynced: 0, isChangeSynced: 0 });
        expect(stored("lastSyncedPull")).toEqual({ value: "0", isSynced: 0, isChangeSynced: 0 });
        expect(stored("documentSecret"))
            .toEqual({ value: documentSecret, isSynced: 0, isChangeSynced: 0 });
        expect(stored("totpLastUsedStep")).toEqual({ value: "", isSynced: 0, isChangeSynced: 0 });
        // The planted address can have sent the following pull requests to the peer.
        expect(stored("syncIncomplete").value).toBe("true");
        expect(recordedNames()).toEqual(expect.arrayContaining(
            [ "mfaMethod", "syncServerHost", "lastSyncedPull", "documentSecret",
                "totpLastUsedStep", "syncIncomplete" ]));
    });

    it("writes the value of each rule into a planted row", () => {
        const peerDate = "2099-01-01 00:00:00.000Z";
        const planted: [ OptionNames, string ][] = [
            [ "initialized", "false" ], [ "lastSyncedPush", "999" ], [ "openNoteContexts", "[]" ],
            [ "lastDailyBackupDate", peerDate ], [ "lastWeeklyBackupDate", peerDate ],
            [ "lastMonthlyBackupDate", peerDate ], [ "theme", "peer-theme" ],
            [ "syncServerTimeout", "1" ], [ "syncProxy", "http://peer.example" ],
            [ "syncServerTimeoutTimeScale", "1" ], [ "dailyBackupEnabled", "false" ],
            [ "zoomFactor", "3.0" ], [ "keyboardShortcutsBackInNoteHistory", "[]" ]
        ];
        for (const [ name, value ] of planted) {
            plant(name, value, "row");
        }

        runStartStep();

        const values = Object.fromEntries(planted.map(([ name ]) => [ name, stored(name).value ]));
        expect(values).toMatchObject({
            initialized: "true", lastSyncedPush: "0", theme: "next", syncServerTimeout: "120",
            syncProxy: "", syncServerTimeoutTimeScale: "60", dailyBackupEnabled: "true"
        });
        expect(JSON.parse(values.openNoteContexts)).toEqual([ { notePath: "root", active: true } ]);
        for (const period of [ "Daily", "Weekly", "Monthly" ]) {
            const name = `last${period}BackupDate`;
            expect(Date.parse(values[name])).toBeLessThanOrEqual(Date.now());
        }
        expect([ "0.9", "1.0" ]).toContain(values.zoomFactor);
        expect(JSON.parse(values.keyboardShortcutsBackInNoteHistory)).not.toEqual([]);
        expect(recordedNames()).toEqual(expect.arrayContaining(planted.map(([ name ]) => name)));
    });

    it("records a planted syncIncomplete once, set false where nothing was pulled", () => {
        plant("syncServerHost", "", "none");
        plant("lastSyncedPull", "0", "none");
        plant("syncIncomplete", "false", "row");

        runStartStep();

        expect(stored("syncIncomplete").value).toBe("false");
        // Repaired twice in one start, counted once.
        expect(recordedCount("syncIncomplete")).toBe(1);
    });

    it("leaves in force what a peer planted with both flags off, which nothing tells apart", () => {
        plant("mfaMethod", "", "none");

        runStartStep();

        expect(stored("mfaMethod").value).toBe("");
        expect(recordedNames()).not.toContain("mfaMethod");
    });

    it("blocks the second factor when a peer stored a row of it, and keeps the row", () => {
        plant("totpEncryptedSecret", "peer-secret", "row");

        runStartStep();

        expect(stored("totpEncryptedSecret"))
            .toEqual({ value: "peer-secret", isSynced: 0, isChangeSynced: 0 });
        expect(optionService.getOption("secondFactorState")).toBe("blocked");
    });

    it("sets mfaMethod from the OpenID setup and encryptedRecoveryCodes from local codes", () => {
        const config = getConfig();
        initConfig({
            ...config,
            MultiFactorAuthentication: {
                oauthBaseUrl: "https://idp.example",
                oauthClientId: "id",
                oauthClientSecret: "secret"
            }
        });
        cls.init(() => getSql().execute(
            "INSERT INTO user_data (tmpID, userIDEncryptedDataKey) VALUES (0, 'key')"));
        try {
            plant("mfaMethod", "", "row");
            plant("recoveryCodesEncrypted", "codes", "none");
            plant("encryptedRecoveryCodes", "false", "row");

            runStartStep();

            expect(stored("mfaMethod").value).toBe("oauth");
            expect(stored("encryptedRecoveryCodes").value).toBe("true");
        } finally {
            initConfig(config);
            cls.init(() => getSql().execute("DELETE FROM user_data"));
        }

        plant("mfaMethod", "", "row");
        plant("recoveryCodesEncrypted", "", "none");
        plant("encryptedRecoveryCodes", "true", "row");
        runStartStep();
        expect(stored("mfaMethod").value).toBe("totp");
        expect(stored("encryptedRecoveryCodes").value).toBe("false");
    });

    it("writes initialized back, and waits for a sync where a server is set", () => {
        plant("syncServerHost", "https://sync.example", "none");
        plant("initialized", "false", "none");
        plant("syncIncomplete", "false", "none");

        runStartStep();

        expect(stored("initialized")).toEqual({ value: "true", isSynced: 0, isChangeSynced: 0 });
        expect(stored("syncIncomplete").value).toBe("true");
        expect(recordedNames()).toEqual(expect.arrayContaining(
            [ "initialized", "syncIncomplete" ]));
    });

    it("gives a planted syncIncomplete true where a sync server is set", () => {
        plant("syncServerHost", "https://sync.example", "none");
        plant("syncIncomplete", "false", "row");

        runStartStep();

        expect(stored("syncIncomplete")).toEqual({ value: "true", isSynced: 0, isChangeSynced: 0 });
    });

    it("puts right the options that no owner sets on an instance that never pulled", () => {
        plant("syncServerHost", "", "none");
        plant("lastSyncedPull", "0", "none");
        plant("autoFixConsistencyIssues", "false", "none");
        plant("syncIncomplete", "true", "none");

        runStartStep();

        expect(stored("autoFixConsistencyIssues").value).toBe("true");
        expect(stored("syncIncomplete").value).toBe("false");
        expect(recordedNames()).toEqual(expect.arrayContaining(
            [ "autoFixConsistencyIssues", "syncIncomplete" ]));
    });

    it("keeps the unfinished sync of an instance that pulled and has no sync server", () => {
        plant("syncServerHost", "", "none");
        plant("lastSyncedPull", "5", "none");
        plant("syncIncomplete", "true", "none");

        runStartStep();

        expect(stored("syncIncomplete").value).toBe("true");
        expect(recordedNames()).not.toContain("syncIncomplete");
    });

    it("queues for sync a change of another table that a peer stored as not synced", () => {
        const create = (title: string) => cls.init(() => notes.createNewNote({
            parentNoteId: "root", title, content: "", type: "text"
        }).note.noteId);
        const noteIds = [ create("kept-from-sync"), create("also-kept-from-sync") ];
        for (const noteId of noteIds) {
            cls.init(() => getSql().execute(/*sql*/`UPDATE entity_changes SET isSynced = 0
                WHERE entityName = 'notes' AND entityId = ?`, [ noteId ]));
        }
        const [ noteId ] = noteIds;
        const before = noteChange(noteId);

        runStartStep();

        const after = noteChange(noteId);
        expect(after.isSynced).toBe(1);
        expect(after.id).toBeGreaterThan(before.id ?? 0);
        expect(after.changeId).not.toBe(before.changeId);
        expect(noteChange(noteIds[1]).isSynced).toBe(1);
        expect(recordedCount("notes")).toBe(1);
    });

    it("dates a synced default that it creates at the epoch, and a local one now", () => {
        removeOption("headingStyle");
        removeOption("treeDensity");

        runStartStep();

        expect(getSql().getRow(
            "SELECT value, utcDateModified FROM options WHERE name = 'headingStyle'"))
            .toEqual({ value: "underline", utcDateModified: "1970-01-01 00:00:00.000Z" });
        expect(getSql().getValue(/*sql*/`SELECT utcDateChanged FROM entity_changes
            WHERE entityName = 'options' AND entityId = 'headingStyle'`))
            .toBe("1970-01-01 00:00:00.000Z");
        expect(getSql().getValue("SELECT utcDateModified FROM options WHERE name = 'treeDensity'"))
            .not.toBe("1970-01-01 00:00:00.000Z");
    });

    it("creates an option no owner sets, which older databases lack, without recording it", () => {
        removeOption("syncIncomplete");
        plant("syncServerHost", "", "none");
        plant("lastSyncedPull", "0", "none");

        runStartStep();

        expect(stored("syncIncomplete").value).toBe("false");
        expect(recordedNames()).not.toContain("syncIncomplete");
    });

    it("writes the change of every entity but an option as synced", async () => {
        const lastChangeId = getSql().getValue<number>(
            "SELECT COALESCE(MAX(id), 0) FROM entity_changes");
        cls.init(() => {
            const { note } = notes.createNewNote({
                parentNoteId: "root", title: "premise", content: "<p>x</p>", type: "text"
            });
            const attribute = note.addLabel("premise", "x");
            attribute.value = "y";
            attribute.save();
            const attachment = note.saveAttachment({
                role: "file", mime: "text/plain", title: "p.txt", content: "x"
            });
            note.saveRevision();
            note.title = "premise, changed";
            note.save();
            const token = new BEtapiToken(
                { name: "premise", tokenHash: "hash" } as EtapiTokenRow).save();
            token.markAsDeletedSimple();
            attachment.markAsDeleted();
            attribute.markAsDeleted();
            note.deleteNote();
        });
        await cls.init(() => consistencyChecks.runOnDemandChecks(true));

        expect(getSql().getRows(/*sql*/`SELECT entityName FROM entity_changes
            WHERE isSynced = 0 AND entityName != 'options' AND id > ?`, [ lastChangeId ]))
            .toEqual([]);
    });
});

type PlantedFlag = "row" | "change" | "none";

/** Stores an option value the way a sync peer could have left it before the upgrade. */
function plant(name: OptionNames, value: string, flag: PlantedFlag) {
    cls.init(() => {
        getSql().execute(/*sql*/`INSERT INTO options (name, value, isSynced, utcDateModified)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (name) DO UPDATE SET value = excluded.value, isSynced = excluded.isSynced`,
        [ name, value, flag === "row" ? 1 : 0, dateUtils.utcNowDateTime() ]);
        entityChangesService.putEntityChange({
            entityName: "options",
            entityId: name,
            hash: "planted",
            isErased: false,
            utcDateChanged: dateUtils.utcNowDateTime(),
            isSynced: flag === "change"
        });
        const option = becca.getOption(name)
            ?? new BOption({ name, value, isSynced: false, utcDateModified: "" });
        option.value = value;
    });
}

function runStartStep() {
    cls.init(() => getSql().transactional(() => initStartupOptions()));
}

function stored(name: OptionNames) {
    return getSql().getRow<{ value: string; isSynced: number; isChangeSynced: number }>(/*sql*/`
        SELECT options.value, options.isSynced, entity_changes.isSynced AS isChangeSynced
        FROM options
        JOIN entity_changes ON entity_changes.entityName = 'options'
            AND entity_changes.entityId = options.name
        WHERE options.name = ?`, [ name ]);
}

function recordedNames(): string[] {
    return readRecord().map(({ name }) => name);
}

/** How many starts repaired the name, by the record. */
function recordedCount(name: string) {
    return readRecord().find((entry) => entry.name === name)?.count;
}

function readRecord() {
    return JSON.parse(
        optionService.getOptionOrNull("startupRepairRecord") || "[]") as DeviceRecordEntry[];
}

function noteChange(noteId: string) {
    return getSql().getRow<EntityChange>(
        "SELECT * FROM entity_changes WHERE entityName = 'notes' AND entityId = ?", [ noteId ]);
}

function removeOption(name: OptionNames) {
    cls.init(() => {
        getSql().execute("DELETE FROM options WHERE name = ?", [ name ]);
        getSql().execute(
            "DELETE FROM entity_changes WHERE entityName = 'options' AND entityId = ?", [ name ]);
    });
    delete becca.options[name];
}
