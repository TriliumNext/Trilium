import { describe, expect, it } from "vitest";

import ValidationError from "./validation_error.js";

describe("ValidationError", () => {
    it("copies every key from the response onto the instance", () => {
        const err = new ValidationError({ message: "bad request", status: 400 }) as any;

        expect(err.message).toBe("bad request");
        expect(err.status).toBe(400);
        expect(err).toBeInstanceOf(ValidationError);
    });

    it("handles an empty response without copying any keys", () => {
        const err = new ValidationError({}) as any;

        expect(Object.keys(err)).toEqual([]);
        expect(err).toBeInstanceOf(ValidationError);
    });
});
