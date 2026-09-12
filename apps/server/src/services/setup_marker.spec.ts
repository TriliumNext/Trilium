import { SETUP_MARKER_FILE_NAME } from "@triliumnext/commons";
import { getSql } from "@triliumnext/core";
import fs from "fs";
import path from "path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import dataDirs from "./data_dir.js";
import { consumeSetupMarker, setupPlatform } from "./setup_marker.js";

const MARKER_PATH = path.join(dataDirs.TRILIUM_DATA_DIR, SETUP_MARKER_FILE_NAME);

function writeMarkerFile(contents: string) {
    fs.writeFileSync(MARKER_PATH, contents, "utf8");
}

afterEach(() => fs.rmSync(MARKER_PATH, { force: true }));

describe("the marker a start finds", () => {
    it("is nothing at all on an ordinary start", () => {
        expect(consumeSetupMarker()).toBeNull();
    });

    it("is read and then gone, so the start after this one is an ordinary one", () => {
        writeMarkerFile(JSON.stringify({ lang: "ro", targetScreen: "restore-backup" }));

        expect(consumeSetupMarker()).toEqual({ lang: "ro", targetScreen: "restore-backup" });
        expect(fs.existsSync(MARKER_PATH)).toBe(false);
        expect(consumeSetupMarker()).toBeNull();
    });

    it("still acts on one it could not delete, and says so", async () => {
        // A marker left behind sends the next start into the wizard as well, which is exactly the
        // trap deleting it on read avoids — so it is worth a line in the log rather than a silence.
        const { getLog } = await import("@triliumnext/core");
        writeMarkerFile(JSON.stringify({ lang: "de" }));
        const error = vi.spyOn(getLog(), "error").mockImplementation(() => {});
        vi.spyOn(fs, "rmSync").mockImplementation(() => {
            throw new Error("EACCES");
        });

        // What it asked for still stands: the start it belongs to should act on it either way.
        expect(consumeSetupMarker()).toEqual({ lang: "de" });
        expect(error).toHaveBeenCalledWith(expect.stringContaining("Could not remove the setup marker"));

        vi.restoreAllMocks();
    });

    it("is removed even when it could not be read, so a bad one cannot trap the instance", () => {
        writeMarkerFile("half a file, written by a start that was interrupted");

        expect(consumeSetupMarker()).toBeNull();
        expect(fs.existsSync(MARKER_PATH)).toBe(false);
    });
});

describe("writing the marker", () => {
    it("leaves something the next start reads back as what was asked for", async () => {
        await setupPlatform.writeMarker({ lang: "de", targetScreen: "restore-backup" });

        expect(fs.existsSync(MARKER_PATH)).toBe(true);
        expect(consumeSetupMarker()).toEqual({ lang: "de", targetScreen: "restore-backup" });
    });

    it("can be taken back, whether or not there was one", async () => {
        await setupPlatform.writeMarker({ lang: "en" });
        await setupPlatform.removeMarker();
        expect(fs.existsSync(MARKER_PATH)).toBe(false);

        // Removing what is not there is how a cancelled request ends, and is not a failure.
        await expect(setupPlatform.removeMarker()).resolves.toBeUndefined();
    });

    it("says whether one is waiting, which is all an owner has to go on until they restart", async () => {
        await expect(setupPlatform.hasMarker()).resolves.toBe(false);

        await setupPlatform.writeMarker({ lang: "en" });
        await expect(setupPlatform.hasMarker()).resolves.toBe(true);

        await setupPlatform.removeMarker();
        await expect(setupPlatform.hasMarker()).resolves.toBe(false);
    });
});

/**
 * Last in the file on purpose: this one really does erase the database, which for the rest of this
 * process means the fixture every other spec here would have been sharing.
 */
describe("erasing the database the wizard was booted away from", () => {
    afterAll(() => {
        // A `document.db` left behind in the test data directory is found by later runs, which then
        // fail on a database that has no schema. Closed before it is removed: on Windows an open
        // handle is enough to make the file undeletable, which is the very reason the erase this
        // spec covers detaches first.
        getSql().detachConnection();
        for (const file of documentFiles()) {
            fs.rmSync(file, { force: true });
        }
    });

    it("leaves an empty database open behind it, which is what the rest of the wizard writes to", async () => {
        await setupPlatform.removeDatabase();

        // Creating a document, taking a pushed sync seed and converging a sync all run against this
        // connection moments later. Detaching without putting one back failed every one of them
        // with "DB not open", on a screen with no way of saying so.
        expect(getSql().getValue("SELECT 1")).toBe(1);
        expect(fs.existsSync(dataDirs.DOCUMENT_PATH)).toBe(true);
    });

    it("takes the sidecars first, so a removal that stops part-way leaves a whole database", async () => {
        // The other order can leave a stale `-wal` beside a freshly created database of the same
        // name, which SQLite would try to replay into it.
        const removed: string[] = [];
        vi.spyOn(fs, "rmSync").mockImplementation((file) => {
            removed.push(String(file).replace(dataDirs.DOCUMENT_PATH, "<document>"));
        });

        await setupPlatform.removeDatabase();

        expect(removed).toEqual([ "<document>-wal", "<document>-shm", "<document>" ]);
        vi.restoreAllMocks();
    });

    it("comes back holding a connection even when the files would not go", async () => {
        // Reachable rather than theoretical: on Windows an antivirus scanner or a search indexer
        // holding the file is enough for EPERM. Left detached, every later request answers
        // "DB not open" until the application is restarted — including the ones the wizard needs to
        // report what went wrong and let the user try something else.
        vi.spyOn(fs, "rmSync").mockImplementation(() => {
            throw new Error("EPERM: operation not permitted");
        });

        await expect(setupPlatform.removeDatabase()).rejects.toThrow(/EPERM/);

        vi.restoreAllMocks();
        expect(getSql().getValue("SELECT 1")).toBe(1);
    });
});

function documentFiles(): string[] {
    const document = dataDirs.DOCUMENT_PATH;

    return [ document, `${document}-wal`, `${document}-shm` ];
}
