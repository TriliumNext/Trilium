import { describe, expect, it } from "vitest";

import { backoffDelayMs } from "./graph.js";

describe("backoffDelayMs", () => {
    it("doubles the delay with each attempt", () => {
        expect(backoffDelayMs(0)).toBe(2000);
        expect(backoffDelayMs(1)).toBe(4000);
        expect(backoffDelayMs(2)).toBe(8000);
        expect(backoffDelayMs(3)).toBe(16000);
    });

    it("caps the delay at the maximum", () => {
        expect(backoffDelayMs(10)).toBe(30_000);
    });
});
