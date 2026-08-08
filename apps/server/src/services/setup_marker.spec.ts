import { SETUP_MARKER_FILE_NAME } from "@triliumnext/commons";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

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
});
