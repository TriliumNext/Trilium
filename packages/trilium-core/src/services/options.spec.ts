import { describe, expect, it } from "vitest";

import becca from "../becca/becca.js";
import { getContext } from "./context.js";
import optionService from "./options.js";
import { getSql } from "./sql/index.js";

let counter = 0;

/** Returns an option name that is guaranteed unique within this shared fixture DB. */
function uniqueName(): string {
    counter++;
    return `optionsSpecTmp${counter}`;
}

function readFromDb(name: string): string | null {
    const row = getSql().getRowOrNull<{ value: string }>(
        "SELECT value FROM options WHERE name = ?",
        [name]
    );
    return row?.value ?? null;
}

describe("options service (real DB)", () => {
    describe("getOptionOrNull / getOption", () => {
        it("returns the stored value for a seeded option", () => {
            // The fixture DB seeds standard options such as mainFontSize.
            const value = optionService.getOptionOrNull("mainFontSize" as any);
            expect(value).not.toBeNull();
            expect(optionService.getOption("mainFontSize" as any)).toBe(value);
        });

        it("returns null from getOptionOrNull for a non-existent option", () => {
            expect(optionService.getOptionOrNull("doesNotExistOption" as any)).toBeNull();
        });

        it("throws from getOption for a non-existent option", () => {
            expect(() => optionService.getOption("doesNotExistOption" as any)).toThrow(
                /doesn't exist/
            );
        });
    });

    describe("getOptionInt", () => {
        it("parses an integer-valued option", () => {
            const name = uniqueName();
            getContext().init(() => optionService.createOption(name as any, "42", false));

            expect(optionService.getOptionInt(name as any)).toBe(42);
        });

        it("returns the supplied default when the value cannot be parsed", () => {
            const name = uniqueName();
            getContext().init(() => optionService.createOption(name as any, "not-a-number", false));

            expect(optionService.getOptionInt(name as any, 7)).toBe(7);
        });

        it("throws when the value cannot be parsed and no default is given", () => {
            const name = uniqueName();
            getContext().init(() => optionService.createOption(name as any, "garbage", false));

            expect(() => optionService.getOptionInt(name as any)).toThrow(/into integer/);
        });
    });

    describe("getOptionBool", () => {
        it("parses 'true' and 'false' into booleans", () => {
            const trueName = uniqueName();
            const falseName = uniqueName();
            getContext().init(() => {
                optionService.createOption(trueName as any, "true", false);
                optionService.createOption(falseName as any, "false", false);
            });

            expect(optionService.getOptionBool(trueName as any)).toBe(true);
            expect(optionService.getOptionBool(falseName as any)).toBe(false);
        });

        it("throws for a value that is neither 'true' nor 'false'", () => {
            const name = uniqueName();
            getContext().init(() => optionService.createOption(name as any, "yes", false));

            expect(() => optionService.getOptionBool(name as any)).toThrow(/into boolean/);
        });
    });

    describe("createOption", () => {
        it("persists a new option with its sync flag in becca and the DB", () => {
            const syncedName = uniqueName();
            const localName = uniqueName();

            getContext().init(() => {
                optionService.createOption(syncedName as any, "synced-value", true);
                optionService.createOption(localName as any, "local-value", false);
            });

            expect(becca.getOption(syncedName)?.value).toBe("synced-value");
            expect(becca.getOption(syncedName)?.isSynced).toBe(true);
            expect(becca.getOption(localName)?.isSynced).toBe(false);

            expect(readFromDb(syncedName)).toBe("synced-value");
            expect(readFromDb(localName)).toBe("local-value");
        });
    });

    describe("setOption", () => {
        it("updates the value of an existing option", () => {
            const name = uniqueName();
            getContext().init(() => optionService.createOption(name as any, "initial", false));

            getContext().init(() => optionService.setOption(name as any, "changed"));

            expect(optionService.getOption(name as any)).toBe("changed");
            expect(readFromDb(name)).toBe("changed");
        });

        it("creates the option (local-only) when it does not yet exist", () => {
            const name = uniqueName();

            getContext().init(() => optionService.setOption(name as any, "created-by-set"));

            expect(optionService.getOption(name as any)).toBe("created-by-set");
            expect(becca.getOption(name)?.isSynced).toBe(false);
            expect(readFromDb(name)).toBe("created-by-set");
        });
    });

    describe("getOptions / getOptionMap", () => {
        it("includes a freshly created option in both the list and the map", () => {
            const name = uniqueName();
            getContext().init(() => optionService.createOption(name as any, "in-collection", false));

            const all = optionService.getOptions();
            expect(all.some((o) => o.name === name && o.value === "in-collection")).toBe(true);

            const map = optionService.getOptionMap();
            expect(map[name as keyof typeof map]).toBe("in-collection");
            // Map and list expose the same set of option names.
            expect(Object.keys(map).length).toBe(all.length);
        });
    });
});
