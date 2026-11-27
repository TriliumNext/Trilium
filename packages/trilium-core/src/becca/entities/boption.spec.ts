import { describe, expect, it } from "vitest";

import becca from "../becca.js";
import BOption from "./boption.js";

describe("BOption", () => {
    it("registers itself in becca under the name of the row it is built from", () => {
        const option = new BOption({ name: "boptionSpec", value: "v", isSynced: true, utcDateModified: "2024-01-01 00:00:00.000Z" });

        expect(becca.options.boptionSpec).toBe(option);
        expect(option.getPojo()).toEqual({ name: "boptionSpec", value: "v", isSynced: true, utcDateModified: "2024-01-01 00:00:00.000Z" });
        delete becca.options.boptionSpec;
    });

    it("can be built empty and registers once filled from a row and initialized", () => {
        const option = new BOption();
        expect(option.name).toBeUndefined();
        expect(Object.keys(becca.options)).not.toContain("undefined");

        option.updateFromRow({ name: "boptionLater", value: "x", isSynced: false, utcDateModified: "2024-01-01 00:00:00.000Z" });
        option.init();

        expect(becca.options.boptionLater).toBe(option);
        expect(option.isSynced).toBe(false);
        delete becca.options.boptionLater;
    });
});
