import { describe, expect, it } from "vitest";

import { getReadableTextColor } from "./css_class_manager";

describe("getReadableTextColor", () => {
    it("doesn't crash for invalid color", () => {
        expect(getReadableTextColor("RandomColor")).toBe("#000");
    });

    it("tolerates different casing", () => {
        expect(getReadableTextColor("Blue"))
            .toBe(getReadableTextColor("blue"));
    });
});
