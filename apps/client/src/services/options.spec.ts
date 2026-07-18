import { afterEach, describe, expect, it, vi } from "vitest";

import type { OptionNames } from "@triliumnext/commons";
import options from "./options.js";
import server from "./server.js";

// Cast helper: the methods are typed against the full OptionNames union, but the
// behavior under test is purely string-keyed, so any string is a valid stand-in.
const k = (name: string) => name as OptionNames;

describe("Options service", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("resolves the singleton once the canned options GET has loaded", async () => {
        // The constructor (non-share branch) issues server.get("options"); the global
        // mock returns {}. Awaiting the promise exercises load() and leaves arr = {}.
        await options.initializedPromise;

        // Establish the empty-record state explicitly via load({}) so this assertion does
        // not silently depend on this test running BEFORE the load()/set() tests that
        // mutate the shared singleton's backing record (the singleton is never reset
        // between tests). This makes the empty-names check order-independent.
        options.load({});
        expect(options.getNames()).toEqual([]);
    });

    it("load() replaces the backing record and feeds every reader", () => {
        options.load({
            str: "hello",
            jsonValid: '{"a":1}',
            jsonInvalid: "{not json}",
            jsonNonString: 5,
            intString: "42",
            intNumber: 7,
            floatString: "3.14",
            floatNumber: 9,
            boolTrue: "true",
            boolFalse: "false"
        });

        expect(options.getNames().sort()).toEqual([
            "boolFalse",
            "boolTrue",
            "floatNumber",
            "floatString",
            "intNumber",
            "intString",
            "jsonInvalid",
            "jsonNonString",
            "jsonValid",
            "str"
        ]);

        // get(): plain string passthrough
        expect(options.get(k("str"))).toBe("hello");

        // getJson(): valid string parses, invalid string is caught -> null, non-string -> null
        expect(options.getJson("jsonValid")).toEqual({ a: 1 });
        expect(options.getJson("jsonInvalid")).toBeNull();
        expect(options.getJson("jsonNonString")).toBeNull();
        expect(options.getJson("missing")).toBeNull();

        // getInt(): number returned as-is, string parsed, unsupported -> warn + null
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(options.getInt(k("intNumber"))).toBe(7);
        expect(options.getInt(k("intString"))).toBe(42);
        expect(options.getInt(k("missing"))).toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);

        // getFloat(): only strings parse, everything else -> null
        expect(options.getFloat(k("floatString"))).toBeCloseTo(3.14);
        expect(options.getFloat(k("floatNumber"))).toBeNull();
        expect(options.getFloat(k("missing"))).toBeNull();

        // is(): strict "true" comparison
        expect(options.is(k("boolTrue"))).toBe(true);
        expect(options.is(k("boolFalse"))).toBe(false);
    });

    it("set() mutates the in-memory record without touching the server", () => {
        const put = (server.put = vi.fn(async () => ({})) as typeof server.put);
        options.set(k("str"), "changed");
        expect(options.get(k("str"))).toBe("changed");
        expect(put).not.toHaveBeenCalled();
    });

    it("save() updates locally and PUTs only the changed key", async () => {
        const put = (server.put = vi.fn(async () => ({})) as typeof server.put);
        await options.save(k("str"), "saved");

        expect(options.get(k("str"))).toBe("saved");
        expect(put).toHaveBeenCalledWith("options", { str: "saved" });
    });

    it("saveMany() PUTs the whole record verbatim", async () => {
        const put = (server.put = vi.fn(async () => ({})) as typeof server.put);
        const payload = { a: "1", b: "2" } as unknown as Record<OptionNames, string>;
        await options.saveMany(payload);
        expect(put).toHaveBeenCalledWith("options", payload);
    });

    it("toggle() flips the boolean value and persists the negation", async () => {
        const put = (server.put = vi.fn(async () => ({})) as typeof server.put);

        options.set(k("flag"), "false");
        await options.toggle(k("flag"));
        expect(options.get(k("flag"))).toBe("true");
        expect(put).toHaveBeenLastCalledWith("options", { flag: "true" });

        await options.toggle(k("flag"));
        expect(options.get(k("flag"))).toBe("false");
        expect(put).toHaveBeenLastCalledWith("options", { flag: "false" });
    });

    it("readers tolerate an uninitialized record via optional chaining", async () => {
        // Re-import a fresh module copy with isShare=true so the constructor takes the
        // share branch (resolves immediately, never assigns arr).
        vi.resetModules();
        vi.doMock("./utils.js", async (orig) => ({
            ...(await orig<typeof import("./utils.js")>()),
            isShare: true
        }));

        const fresh = (await import("./options.js")).default;
        await fresh.initializedPromise; // share branch: Promise.resolve(), arr stays undefined

        expect(fresh.get(k("anything"))).toBeUndefined();
        expect(fresh.getNames()).toEqual([]);
        expect(fresh.getJson("anything")).toBeNull();

        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(fresh.getInt(k("anything"))).toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(fresh.getFloat(k("anything"))).toBeNull();

        // Asymmetry: get/getNames/getJson/getInt/getFloat all read `this.arr?.[key]`
        // and tolerate the uninitialized (undefined) record, but the remaining
        // accessors do NOT use optional chaining and therefore THROW on a fresh
        // share-branch instance where `arr` was never assigned:
        //   is()   -> `this.arr[key]`        (source line 64)
        //   set()  -> `this.arr[key] = ...`  (source line 68)
        //   save() -> calls set()            (source line 72)
        //   toggle() -> calls is() then save (source line 89)
        // Pin this real behavioral difference so a regression that added/removed the
        // optional chaining on either group would be caught.
        expect(() => fresh.is(k("anything"))).toThrow();
        expect(() => fresh.set(k("anything"), "v")).toThrow();
        await expect(fresh.save(k("anything"), "v")).rejects.toThrow();
        await expect(fresh.toggle(k("anything"))).rejects.toThrow();

        vi.doUnmock("./utils.js");
        vi.resetModules();
    });
});
