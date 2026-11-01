import { describe, expect, it } from "vitest";

import { ForbiddenError, HttpError, NotFoundError, OpenIdError, ValidationError } from "./errors.js";

describe("errors", () => {
    it("carries the message plus the status code / name of each error type", () => {
        expect(new HttpError("boom", 418)).toMatchObject({ message: "boom", statusCode: 418, name: "HttpError" });
        expect(new NotFoundError("gone")).toMatchObject({ message: "gone", statusCode: 404, name: "NotFoundError" });
        expect(new ForbiddenError("nope")).toMatchObject({ message: "nope", statusCode: 403, name: "ForbiddenError" });
        expect(new ValidationError("bad")).toMatchObject({ message: "bad", statusCode: 400, name: "ValidationError" });

        // OpenIdError is a plain carrier, not an Error subclass.
        const openIdError = new OpenIdError("oidc failed");
        expect(openIdError.message).toBe("oidc failed");
        expect(openIdError).not.toBeInstanceOf(Error);
    });
});
