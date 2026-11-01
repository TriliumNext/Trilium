import { describe, expect, it } from "vitest";

import { asBuffer } from "./binary.js";

describe("asBuffer", () => {
    it("returns a Buffer holding the same bytes", () => {
        const bytes = Uint8Array.from([1, 2, 3, 254, 255]);

        const result = asBuffer(bytes);

        expect(Buffer.isBuffer(result)).toBe(true);
        expect([...result]).toEqual([1, 2, 3, 254, 255]);
    });

    it("shares memory with the source rather than copying it", () => {
        const bytes = Uint8Array.from([1, 2, 3]);

        const result = asBuffer(bytes);
        bytes[0] = 42;

        // A copy would still read 1 here. The whole point of this helper is that it does not copy.
        expect(result[0]).toBe(42);
    });

    it("scopes the view to a subarray, not its backing buffer", () => {
        const backing = Uint8Array.from([1, 2, 3, 4, 5, 6]);
        const slice = backing.subarray(2, 5);

        const result = asBuffer(slice);

        expect(result.byteLength).toBe(3);
        expect([...result]).toEqual([3, 4, 5]);
    });

    it("passes a Buffer through as it came", () => {
        const buffer = Buffer.from([7, 8, 9]);

        expect(asBuffer(buffer)).toBe(buffer);
    });

    it("handles an empty input", () => {
        const result = asBuffer(new Uint8Array(0));

        expect(Buffer.isBuffer(result)).toBe(true);
        expect(result.byteLength).toBe(0);
    });
});
