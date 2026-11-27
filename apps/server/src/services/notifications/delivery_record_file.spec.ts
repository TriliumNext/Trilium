import fs from "fs";
import path from "path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// The record is written for real, in a folder of its own.
vi.mock("../data_dir.js", async (importOriginal) => {
    const original = await importOriginal<typeof import("../data_dir.js")>();
    const { mkdtempSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    return {
        ...original,
        default: {
            ...original.default,
            TRILIUM_DATA_DIR: mkdtempSync(join(tmpdir(), "trilium-record-spec-"))
        }
    };
});

import dataDir from "../data_dir.js";
import { createDeliveryRecordFile } from "./delivery_record_file.js";

const RECORD_PATH = path.join(dataDir.TRILIUM_DATA_DIR, "notification-deliveries.json");

afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(RECORD_PATH, { recursive: true, force: true });
});

afterAll(() => fs.rmSync(dataDir.TRILIUM_DATA_DIR, { recursive: true, force: true }));

describe("the delivery record file", () => {
    it("reads nothing before the first write, and then what was written last", async () => {
        const record = createDeliveryRecordFile();

        expect(record.name).toBe("notification-deliveries.json");
        expect(await record.read()).toBeNull();
        await record.write("{ \"first\": true }");
        await record.write("{ \"second\": true }");

        expect(await record.read()).toBe("{ \"second\": true }");
        expect(fs.readdirSync(dataDir.TRILIUM_DATA_DIR)).toEqual([ path.basename(RECORD_PATH) ]);
        if (process.platform !== "win32") {
            expect(fs.statSync(RECORD_PATH).mode & 0o777).toBe(0o600);
        }
    });

    it("refuses a record that exists and cannot be read, naming the file alone", async () => {
        fs.mkdirSync(RECORD_PATH);

        await expect(createDeliveryRecordFile().read()).rejects.toThrow(
            /^notification-deliveries.json cannot be read: EISDIR$/);
    });

    it("keeps the old record when a write fails, and leaves no temporary file", async () => {
        const record = createDeliveryRecordFile();
        await record.write("old");
        vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(
            Object.assign(new Error(`ENOSPC: no space left on device, rename '${RECORD_PATH}'`),
                { code: "ENOSPC" }));

        await expect(record.write("new")).rejects.toThrow(
            /^notification-deliveries.json cannot be written: ENOSPC$/);
        expect(await record.read()).toBe("old");
        expect(fs.readdirSync(dataDir.TRILIUM_DATA_DIR)).toEqual([ path.basename(RECORD_PATH) ]);
    });

    it("writes where the folder cannot be flushed", async () => {
        const { open } = fs.promises;
        vi.spyOn(fs.promises, "open").mockImplementation((file, ...rest) => (
            file === dataDir.TRILIUM_DATA_DIR
                ? Promise.reject(Object.assign(new Error("EISDIR"), { code: "EISDIR" }))
                : open(file, ...rest)));

        await createDeliveryRecordFile().write("text");

        expect(await createDeliveryRecordFile().read()).toBe("text");
    });
});
