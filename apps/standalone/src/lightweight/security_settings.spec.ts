import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    acquireSecuritySettings,
    DEFAULT_SECURITY_SETTINGS,
    isWritableSettingName,
    resolveSecuritySettings,
    SecuritySettingsStore,
    toCoreConfig
} from "./security_settings.js";

/**
 * The origin's private filesystem, with the part of it this depends on: an OPFS sync access handle
 * takes an exclusive lock, which is what keeps the page — where a frontend script runs — out of a
 * file the worker holds.
 */
class FakeFile {
    bytes = new Uint8Array(0);
    heldBy: string | null = null;
}

const files = new Map<string, FakeFile>();

/** The error a browser raises for a file another context has open. */
function lockedError(): DOMException {
    const error = Object.assign(new Error("locked"), { name: "NoModificationAllowedError" });
    return error as unknown as DOMException;
}

function fileHandleFor(name: string) {
    return {
        // Reading a file this way takes no lock, so a browser grants it whoever else holds the
        // file — which is why the contents are only ever read through the handle below.
        async getFile() {
            const file = files.get(name);
            return { arrayBuffer: async () => (file?.bytes ?? new Uint8Array(0)).buffer };
        },
        async createSyncAccessHandle() {
            const file = files.get(name);
            if (!file) {
                throw new Error("NotFoundError");
            }
            if (file.heldBy) {
                throw lockedError();
            }
            file.heldBy = "worker";

            return {
                getSize: () => file.bytes.length,
                read: (into: Uint8Array) => {
                    into.set(file.bytes.subarray(0, into.length));
                    return Math.min(into.length, file.bytes.length);
                },
                write: (from: Uint8Array) => {
                    file.bytes = new Uint8Array(from);
                    return from.length;
                },
                truncate: () => { file.bytes = new Uint8Array(0); },
                flush: () => {},
                close: () => { file.heldBy = null; }
            };
        }
    };
}

function fakeRoot() {
    return {
        async getFileHandle(name: string, opts?: { create?: boolean }) {
            if (!files.has(name)) {
                if (!opts?.create) {
                    throw new Error("NotFoundError");
                }
                files.set(name, new FakeFile());
            }
            return fileHandleFor(name);
        }
    } as unknown as FileSystemDirectoryHandle;
}

const getRoot = async () => fakeRoot();

/** What the file says on disk, as the next start would read it. */
function fileContents(): string {
    const file = files.get("security.json");
    return file ? new TextDecoder().decode(file.bytes) : "";
}

/** Writes the file the way something else would: a previous start, or an attacker. */
function writeFile(contents: string): void {
    const file = files.get("security.json") ?? new FakeFile();
    file.bytes = new TextEncoder().encode(contents);
    files.set("security.json", file);
}

beforeEach(() => {
    files.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("what a start runs with", () => {
    it("is nothing enabled when there is no file, and leaves one for later writes", async () => {
        const store = await acquireSecuritySettings({ getRoot });

        expect(store.read()).toEqual(DEFAULT_SECURITY_SETTINGS);
        expect(store.isWritable).toBe(true);
        expect(files.has("security.json")).toBe(true);
    });

    it("is what the file says, once something agreed to it", async () => {
        const store = await acquireSecuritySettings({ getRoot });

        expect(store.setSetting("backendScriptingEnabled", true)).toBe(true);
        expect(store.read()).toEqual({ backendScriptingEnabled: true, sqlConsoleEnabled: false });

        // What the next start reads, rather than what this one remembers.
        expect(JSON.parse(fileContents())).toEqual({
            backendScriptingEnabled: true,
            sqlConsoleEnabled: false
        });
    });

    it("keeps the settings apart, so agreeing to one grants only that one", async () => {
        const store = await acquireSecuritySettings({ getRoot });

        store.setSetting("sqlConsoleEnabled", true);

        expect(store.read()).toEqual({ backendScriptingEnabled: false, sqlConsoleEnabled: true });
    });

    it("can be taken back", async () => {
        const store = await acquireSecuritySettings({ getRoot });

        store.setSetting("backendScriptingEnabled", true);
        expect(store.setSetting("backendScriptingEnabled", false)).toBe(true);

        expect(store.read().backendScriptingEnabled).toBe(false);
    });

    it("becomes the config core is started with, and overrides nothing else", () => {
        expect(toCoreConfig({ backendScriptingEnabled: true, sqlConsoleEnabled: false })).toEqual({
            General: { instanceName: "", readOnly: false },
            Sync: { syncServerHost: "", syncServerTimeout: "", syncProxy: "" },
            Security: {
                backendScriptingEnabled: true,
                sqlConsoleEnabled: false,
                // The file holds the two scripting flags; LAN access stays where core defaults it.
                allowLanAccess: false
            }
        });
    });
});

describe("a file that says something other than yes or no", () => {
    // Every one of these is what a forged or half-written file looks like, and none of them is a
    // decision the user made. The type of the value is the whole check: a truthy `"false"` would
    // otherwise enable backend scripting.
    it.each([
        [ "a string", `{"backendScriptingEnabled": "true"}` ],
        [ "the string false, which is truthy", `{"backendScriptingEnabled": "false"}` ],
        [ "a number", `{"backendScriptingEnabled": 1}` ],
        [ "an object", `{"backendScriptingEnabled": {}}` ],
        [ "an array", `{"backendScriptingEnabled": [true]}` ],
        [ "null", `{"backendScriptingEnabled": null}` ],
        [ "a nested shape", `{"Security": {"backendScriptingEnabled": true}}` ],
        [ "not an object at all", `"backendScriptingEnabled"` ],
        [ "a bare true", `true` ],
        [ "an array of settings", `[{"backendScriptingEnabled": true}]` ],
        [ "not JSON", `backendScriptingEnabled=true` ],
        [ "half a file", `{"backendScriptingEnabled": tr` ],
        [ "nothing at all", `` ]
    ])("grants nothing when it holds %s", async (_case, contents) => {
        writeFile(contents);

        const store = await acquireSecuritySettings({ getRoot });

        expect(store.read()).toEqual(DEFAULT_SECURITY_SETTINGS);
    });

    it("grants only the settings it names, whatever else it carries", () => {
        const settings = resolveSecuritySettings(JSON.stringify({
            backendScriptingEnabled: true,
            // A file that names something else is not a way to reach it: only these two are read,
            // and only these two are written back.
            allowLanAccess: true,
            readOnly: true,
            instanceName: "elsewhere"
        }));

        expect(settings).toEqual({ backendScriptingEnabled: true, sqlConsoleEnabled: false });
    });

    it("drops what it did not put there, rather than carrying it forward", async () => {
        writeFile(JSON.stringify({ sqlConsoleEnabled: true, allowLanAccess: true }));
        const store = await acquireSecuritySettings({ getRoot });

        store.setSetting("backendScriptingEnabled", true);

        expect(JSON.parse(fileContents())).toEqual({
            backendScriptingEnabled: true,
            sqlConsoleEnabled: true
        });
    });
});

describe("a change that is not one of the two", () => {
    it.each([
        [ "a setting that is not kept here", "allowLanAccess" ],
        [ "the prototype", "__proto__" ],
        [ "a constructor", "constructor" ],
        [ "a method name", "toString" ],
        [ "nothing", "" ],
        [ "a number", 1 ],
        [ "an object", { backendScriptingEnabled: true } ],
        [ "nothing at all", undefined ],
        [ "null", null ]
    ])("is refused when the name is %s", async (_case, name) => {
        const store = await acquireSecuritySettings({ getRoot });

        expect(store.setSetting(name, true)).toBe(false);
        expect(store.read()).toEqual(DEFAULT_SECURITY_SETTINGS);
        expect(fileContents()).toBe("");
    });

    it.each([
        [ "a string", "true" ],
        [ "a number", 1 ],
        [ "an object", {} ],
        [ "nothing at all", undefined ],
        [ "null", null ]
    ])("is refused when the value is %s", async (_case, enabled) => {
        const store = await acquireSecuritySettings({ getRoot });

        expect(store.setSetting("backendScriptingEnabled", enabled)).toBe(false);
        expect(store.read()).toEqual(DEFAULT_SECURITY_SETTINGS);
    });

    it("leaves the prototype alone when the name was aiming at it", async () => {
        const store = await acquireSecuritySettings({ getRoot });

        store.setSetting("__proto__", true);

        expect(({} as Record<string, unknown>).backendScriptingEnabled).toBeUndefined();
        expect(Object.prototype).not.toHaveProperty("backendScriptingEnabled");
    });

    it("knows which names are settings", () => {
        expect(isWritableSettingName("backendScriptingEnabled")).toBe(true);
        expect(isWritableSettingName("sqlConsoleEnabled")).toBe(true);
        expect(isWritableSettingName("allowLanAccess")).toBe(false);
        expect(isWritableSettingName("__proto__")).toBe(false);
    });
});

describe("the lock the file is only trustworthy behind", () => {
    it("is held for as long as the store lives, so nothing else can write the file", async () => {
        await acquireSecuritySettings({ getRoot });

        // What the page would be doing: the same file, from a context that does not own the
        // database. While the worker holds it, the browser refuses.
        await expect(fileHandleFor("security.json").createSyncAccessHandle())
            .rejects.toMatchObject({ name: "NoModificationAllowedError" });
    });

    it("is waited for, since a reload starts this worker before the last let go", async () => {
        writeFile(JSON.stringify({ backendScriptingEnabled: true }));
        const file = files.get("security.json");
        if (!file) {
            throw new Error("the file should exist");
        }
        file.heldBy = "the previous worker";
        setTimeout(() => { file.heldBy = null; }, 30);

        const store = await acquireSecuritySettings({ getRoot, pollMs: 5, deadlineMs: 5_000 });

        expect(store.isWritable).toBe(true);
        expect(store.read().backendScriptingEnabled).toBe(true);
    });

    it("grants nothing when it was never taken, whatever the file says", async () => {
        // The shape of an attack this cannot otherwise win: hold the file open from the page so
        // the worker cannot lock it, having written it to say yes. Refusing to read an unlocked
        // file costs the user the toggle until the tabs are closed; honouring it would cost them
        // the guarantee.
        writeFile(JSON.stringify({ backendScriptingEnabled: true, sqlConsoleEnabled: true }));
        const file = files.get("security.json");
        if (file) {
            file.heldBy = "a page that will not let go";
        }

        const store = await acquireSecuritySettings({ getRoot, pollMs: 1, deadlineMs: 10 });

        expect(store.isWritable).toBe(false);
        expect(store.read()).toEqual(DEFAULT_SECURITY_SETTINGS);
        expect(store.setSetting("backendScriptingEnabled", true)).toBe(false);
    });

    it("gives up immediately on a failure waiting cannot fix", async () => {
        files.set("security.json", new FakeFile());
        const root = {
            getFileHandle: async () => ({
                createSyncAccessHandle: async () => {
                    const name = "NotSupportedError";
                    throw Object.assign(new Error("no such capability"), { name });
                }
            })
        } as unknown as FileSystemDirectoryHandle;

        const store = await acquireSecuritySettings({
            getRoot: async () => root,
            // Long enough that a retry loop would outlast the test.
            deadlineMs: 60_000,
            pollMs: 1_000
        });

        expect(store.isWritable).toBe(false);
    });

    it("grants nothing when there is no private filesystem to keep it in", async () => {
        const store = await acquireSecuritySettings({
            getRoot: async () => { throw new Error("no OPFS here"); }
        });

        expect(store.isWritable).toBe(false);
        expect(store.read()).toEqual(DEFAULT_SECURITY_SETTINGS);
    });

    it("grants nothing when the file cannot be read", () => {
        const store = new SecuritySettingsStore({
            getSize: () => { throw new Error("the handle went away"); }
        } as unknown as FileSystemSyncAccessHandle);

        expect(store.read()).toEqual(DEFAULT_SECURITY_SETTINGS);
    });

    it("reports a write that did not land as refused", () => {
        const store = new SecuritySettingsStore({
            getSize: () => 0,
            read: () => 0,
            truncate: () => {},
            write: () => { throw new Error("out of space"); },
            flush: () => {}
        } as unknown as FileSystemSyncAccessHandle);

        expect(store.setSetting("backendScriptingEnabled", true)).toBe(false);
    });

    it("reports a write that landed only partly as refused too", () => {
        // `write()` answers with a byte count rather than throwing when it runs short, and the
        // truncate before it has already happened, so what is left on disk is part of a setting.
        // The next start reads that as no settings at all, and the toggle has to say so rather
        // than claim the change was saved.
        const store = new SecuritySettingsStore({
            getSize: () => 0,
            read: () => 0,
            truncate: () => {},
            write: (bytes: Uint8Array) => bytes.length - 1,
            flush: () => {}
        } as unknown as FileSystemSyncAccessHandle);

        expect(store.setSetting("backendScriptingEnabled", true)).toBe(false);
    });
});
