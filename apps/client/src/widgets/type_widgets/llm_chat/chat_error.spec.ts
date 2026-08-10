import { describe, expect, it } from "vitest";

import { formatErrorDetails } from "./chat_error.js";

/** The DeepSeek rejection that motivated the split: the body only restates the message. */
const DEEPSEEK_MESSAGE = "Failed to deserialize the JSON body into the target type: messages[1]: "
    + "unknown variant `image_url`, expected `text` at line 1 column 38345";
const DEEPSEEK_BODY = JSON.stringify({
    error: {
        message: DEEPSEEK_MESSAGE,
        type: "invalid_request_error",
        param: null,
        code: "invalid_request_error"
    }
});

describe("formatErrorDetails", () => {
    it("returns nothing when the failure carries no provider context", () => {
        expect(formatErrorDetails("Failed to connect to LLM stream: network down")).toBeUndefined();
        expect(formatErrorDetails("Timed out", {})).toBeUndefined();
        expect(formatErrorDetails("Timed out", { statusCode: 504 })).toBeUndefined();
    });

    it("drops a response body that only restates the message, keeping the endpoint", () => {
        const details = formatErrorDetails(DEEPSEEK_MESSAGE, {
            statusCode: 400,
            url: "https://api.deepseek.com/v1/chat/completions",
            responseBody: DEEPSEEK_BODY
        });
        expect(details).toBe("https://api.deepseek.com/v1/chat/completions");
    });

    it("recognises a restatement under either envelope shape, and a verbatim body", () => {
        const cases = [
            JSON.stringify({ error: { message: "Not Found" } }),
            JSON.stringify({ message: "Not Found" }),
            "Not Found"
        ];
        for (const responseBody of cases) {
            expect(formatErrorDetails("Not Found", { url: "https://api.test/v1", responseBody }))
                .toBe("https://api.test/v1");
        }
    });

    it("keeps a body that says more than the message", () => {
        const responseBody = JSON.stringify({ error: { message: "Router not found for POST /messages" } });
        expect(formatErrorDetails("Not Found", { url: "https://api.test/v1", responseBody }))
            .toBe(`https://api.test/v1\n\n${responseBody}`);
    });

    it("keeps an unparseable body, and a JSON body with no message field", () => {
        expect(formatErrorDetails("Bad gateway", { responseBody: "<html>502</html>" }))
            .toBe("<html>502</html>");
        expect(formatErrorDetails("Bad gateway", { responseBody: '{"code":"upstream_down"}' }))
            .toBe('{"code":"upstream_down"}');
        // A JSON scalar is still a parse success — it just carries no message to compare.
        expect(formatErrorDetails("Bad gateway", { responseBody: "42" })).toBe("42");
    });

    it("ignores an empty or whitespace-only body", () => {
        expect(formatErrorDetails("Boom", { url: "https://api.test/v1", responseBody: "   " }))
            .toBe("https://api.test/v1");
        expect(formatErrorDetails("Boom", { responseBody: "" })).toBeUndefined();
    });
});
