import { describe, expect, it } from "vitest";

import { ContentNotAvailableError, NotFoundError, ValidationError } from "../errors.js";
import { answerUnavailable } from "./helpers.js";

describe("answerUnavailable", () => {
    const unavailable = { status: "unavailable" };

    it("answers unavailable for a gone document and unavailable content, sync and async",
        async () => {
        for (const error of [ new NotFoundError("gone"), new ContentNotAvailableError("locked") ]) {
            expect(answerUnavailable(() => { throw error; })).toStrictEqual(unavailable);
            await expect(answerUnavailable(async () => { throw error; })).resolves
                .toStrictEqual(unavailable);
        }
    });

    it("passes a result through and rethrows any other error", async () => {
        expect(answerUnavailable(() => "read")).toBe("read");
        await expect(answerUnavailable(async () => "read")).resolves.toBe("read");

        for (const error of [ new ValidationError("bad"), new Error("broken") ]) {
            expect(() => answerUnavailable(() => { throw error; })).toThrow(error);
            await expect(answerUnavailable(async () => { throw error; })).rejects.toThrow(error);
        }
    });
});
