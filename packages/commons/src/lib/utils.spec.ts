import { deferred } from "./utils.js";

describe("#deferred", () => {
    it("should return a promise", () => {
        const result = deferred();
        expect(result).toBeInstanceOf(Promise);
    });
    // TriliumNextTODO: Add further tests!
});
