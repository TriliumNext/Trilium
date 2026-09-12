import { SETUP_MARKER_FILE_NAME } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { consumeSetupMarker, removeSetupMarker, writeSetupMarker } from "./setup_marker.js";

/** Stands in for the origin's private filesystem, which is where the marker lives here. */
let files: Map<string, string>;

beforeEach(() => {
    files = new Map();
    vi.stubGlobal("navigator", {
        storage: {
            getDirectory: async () => ({
                getFileHandle: async (name: string, opts?: { create?: boolean }) => {
                    if (!files.has(name)) {
                        if (!opts?.create) {
                            throw new Error("NotFoundError");
                        }
                        files.set(name, "");
                    }

                    return {
                        getFile: async () => ({ text: async () => files.get(name) ?? "" }),
                        createWritable: async () => ({
                            write: async (text: string) => { files.set(name, text); },
                            close: async () => {}
                        })
                    };
                },
                removeEntry: async (name: string) => {
                    if (!files.delete(name)) {
                        throw new Error("NotFoundError");
                    }
                }
            })
        }
    });
});

afterEach(() => vi.unstubAllGlobals());

describe("the marker a start finds", () => {
    it("is nothing at all on an ordinary start", async () => {
        await expect(consumeSetupMarker()).resolves.toBeNull();
    });

    it("is read and then gone, so the start after this one is an ordinary one", async () => {
        files.set(SETUP_MARKER_FILE_NAME, JSON.stringify({ lang: "ro", targetScreen: "restore-backup" }));

        await expect(consumeSetupMarker()).resolves.toEqual({ lang: "ro", targetScreen: "restore-backup" });
        expect(files.has(SETUP_MARKER_FILE_NAME)).toBe(false);
        await expect(consumeSetupMarker()).resolves.toBeNull();
    });

    it("is removed even when it could not be read, so a bad one cannot trap the instance", async () => {
        files.set(SETUP_MARKER_FILE_NAME, "half a file, written by a start that was interrupted");

        await expect(consumeSetupMarker()).resolves.toBeNull();
        expect(files.has(SETUP_MARKER_FILE_NAME)).toBe(false);
    });
});

describe("writing the marker", () => {
    it("leaves something the next start reads back as what was asked for", async () => {
        await writeSetupMarker({ lang: "de", targetScreen: "restore-backup" });

        await expect(consumeSetupMarker()).resolves.toEqual({ lang: "de", targetScreen: "restore-backup" });
    });

    it("can be taken back, whether or not there was one", async () => {
        await writeSetupMarker({ lang: "en" });
        await removeSetupMarker();
        expect(files.has(SETUP_MARKER_FILE_NAME)).toBe(false);

        // Removing what is not there is how a cancelled request ends, and is not a failure.
        await expect(removeSetupMarker()).resolves.toBeUndefined();
    });
});
