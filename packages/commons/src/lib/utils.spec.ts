import { deferred } from "./utils.js";
import { describe, expect, it } from "vitest";

describe("#deferred", () => {
    it("should return a promise", () => {
        const result = deferred();
        expect(result).toBeInstanceOf(Promise);
    });
    // TriliumNextTODO: Add further tests!
});
