import { describe, expect, it } from "vitest";

import utils from "./utils";

describe("#isDev", () => {
    it("should export a boolean", () => {
        expect(utils.isDev).toBeTypeOf("boolean");
    });
});
