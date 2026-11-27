import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SlotRecordPort from "./delivery_record_slots.js";

const SLOT_0 = "notification-deliveries.0.json";
const SLOT_1 = "notification-deliveries.1.json";

/** The files of the origin's private filesystem, by name. */
let files: Map<string, string>;
let isWriteFailing: boolean;

beforeEach(() => {
    files = new Map();
    isWriteFailing = false;
    vi.stubGlobal("navigator", {
        storage: {
            getDirectory: async () => ({
                getFileHandle: async (name: string, options?: { create?: boolean }) => {
                    if (!files.has(name)) {
                        if (!options?.create) {
                            throw new Error("NotFoundError");
                        }
                        files.set(name, "");
                    }
                    return {
                        getFile: async () => ({ text: async () => files.get(name) ?? "" }),
                        // As in a browser, the stream writes to a copy that only `close()` commits.
                        createWritable: async () => {
                            let copy = "";
                            return {
                                write: async (text: string) => {
                                    if (isWriteFailing) {
                                        throw new Error("QuotaExceededError");
                                    }
                                    copy += text;
                                },
                                close: async () => {
                                    files.set(name, copy);
                                },
                                abort: async () => undefined
                            };
                        }
                    };
                }
            })
        }
    });
});

afterEach(() => vi.unstubAllGlobals());

describe("SlotRecordPort", () => {
    it("reads back the newest write, writing the two slots in turn", async () => {
        const port = new SlotRecordPort();
        await expect(port.read()).resolves.toBeNull();

        await port.write("one");
        await port.write("two");
        expect([ ...files.keys() ].sort()).toEqual([ SLOT_0, SLOT_1 ]);
        await expect(new SlotRecordPort().read()).resolves.toBe("two");

        await port.write("three");
        expect(files.get(SLOT_0)).toContain("three");
        await expect(new SlotRecordPort().read()).resolves.toBe("three");
    });

    it("reads an empty slot as a missing one, as a first write cut short leaves it", async () => {
        files.set(SLOT_0, "");

        const port = new SlotRecordPort();
        await expect(port.read()).resolves.toBeNull();
        await port.write("one");
        await expect(new SlotRecordPort().read()).resolves.toBe("one");
    });

    it("falls back to the other slot when one is damaged, and throws when both are", async () => {
        const port = new SlotRecordPort();
        await port.write("one");
        await port.write("two");

        files.set(SLOT_1, "half a record");
        await expect(new SlotRecordPort().read()).resolves.toBe("one");

        files.set(SLOT_0, "{\"counter\":1,\"checksum\":\"wrong\",\"text\":\"one\"}");
        await expect(new SlotRecordPort().read()).rejects.toThrow("record");
    });

    it("leaves the slot as it was when a write fails", async () => {
        const port = new SlotRecordPort();
        await port.write("one");
        await port.write("two");
        const before = files.get(SLOT_0);

        isWriteFailing = true;
        await expect(port.write("three")).rejects.toThrow("QuotaExceededError");
        expect(files.get(SLOT_0)).toBe(before);
        await expect(new SlotRecordPort().read()).resolves.toBe("two");
    });
});
