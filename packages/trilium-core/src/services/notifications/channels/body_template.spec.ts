import type { NotificationChannelPayload } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { NotificationError } from "../model.js";
import {
    checkTemplate,
    fillTemplate,
    getTemplateSecretNames,
    hashTemplate
} from "./body_template.js";
import { ChannelSendError } from "./types.js";

const PAYLOAD: NotificationChannelPayload = {
    key: "delivery-key",
    title: "Backup failed",
    description: "The disk is full.",
    category: "general",
    attentionLevel: "high",
    raisedAt: "2026-11-27 10:00:00.000Z",
    noteId: "abcdefghijkl"
};
const NO_SECRETS = new Map<string, string>();

describe("checkTemplate", () => {
    it("keeps a template byte for byte, and takes the empty string for the default body", () => {
        const template = "{\n  \"text\": \"{{title}}: {{description}}\",\n  \"token\": "
            + "\"{{secret.token}}\", \"meta\": [ \"{{key}}\", \"{{noteId}}\", \"{{category}}\", "
            + "\"{{attentionLevel}}\", \"{{raisedAt}}\", 5, true, null ] }";

        expect(checkTemplate(template)).toBe(template);
        expect(checkTemplate("")).toBe("");
        expect(checkTemplate("\"{{title}}\"")).toBe("\"{{title}}\"");
    });

    it("refuses a value that is not a string as malformed input", () => {
        for (const value of [ undefined, null, 42, { text: "{{title}}" } ]) {
            expect(codeOf(() => checkTemplate(value))).toBe("invalid-input");
        }
    });

    it("refuses what is not JSON, a placeholder outside a string value and an unknown name", () => {
        for (const template of [
            "{ \"text\": {{title}} }",
            "{{title}}",
            "{ \"text\": \"{{title}}\"",
            "{ \"{{title}}\": \"value\" }",
            "{ \"nested\": { \"{{secret.token}}\": 1 } }",
            "{ \"text\": \"{{tittle}}\" }",
            "{ \"text\": \"{{ title }}\" }",
            "{ \"text\": \"{{Title}}\" }",
            "{ \"text\": \"{{secret.}}\" }",
            "{ \"text\": \"{{secret.my-token}}\" }",
            `{ "text": "{{secret.${"a".repeat(65)}}}" }`
        ]) {
            expect(codeOf(() => checkTemplate(template)), template).toBe("invalid-template");
        }
        expect(checkTemplate(`{ "text": "{{secret.${"a".repeat(64)}}}" }`)).toBeTruthy();
        // Braces that form no placeholder are text.
        expect(checkTemplate("{ \"text\": \"{ {{{title}}} } {{ }\" }")).toBeTruthy();
    });

    it("refuses a template over 16 KiB of UTF-8, and one nested deeper than 32 levels", () => {
        // Each "é" is two bytes: the text is under the limit in characters and over it in bytes.
        const atLimit = `"${"a".repeat(16 * 1024 - 2)}"`;
        const overLimit = `"${"é".repeat(8 * 1024)}"`;

        expect(checkTemplate(atLimit)).toBe(atLimit);
        expect(overLimit.length).toBeLessThan(16 * 1024);
        expect(codeOf(() => checkTemplate(overLimit))).toBe("too-large");
        expect(codeOf(() => checkTemplate(`[${"1,".repeat(8 * 1024)}1]`))).toBe("too-large");

        expect(checkTemplate(`${"[".repeat(32)}"{{title}}"${"]".repeat(32)}`)).toBeTruthy();
        expect(codeOf(() => checkTemplate(`${"[".repeat(33)}1${"]".repeat(33)}`)))
            .toBe("invalid-template");
        expect(codeOf(() => checkTemplate(`${"{\"a\":".repeat(33)}1${"}".repeat(33)}`)))
            .toBe("invalid-template");
        expect(codeOf(() => checkTemplate(`${"[".repeat(8000)}${"]".repeat(8000)}`)))
            .toBe("invalid-template");
    });
});

describe("getTemplateSecretNames", () => {
    it("names each secret value once, in the order of the template", () => {
        expect(getTemplateSecretNames(
            "{ \"token\": \"{{secret.token}}\", \"to\": [ \"{{secret.user}}:{{secret.token}}\" ], "
            + "\"text\": \"{{title}}\" }"
        )).toEqual([ "token", "user" ]);
        expect(getTemplateSecretNames("{ \"text\": \"{{title}}\" }")).toEqual([]);
        expect(getTemplateSecretNames("")).toEqual([]);
        expect(codeOf(() => getTemplateSecretNames("{ \"{{secret.token}}\": 1 }")))
            .toBe("invalid-template");
    });
});

describe("fillTemplate", () => {
    it("sends the payload as JSON without a template", () => {
        expect(fillTemplate(undefined, PAYLOAD, NO_SECRETS)).toBe(JSON.stringify(PAYLOAD));
        expect(fillTemplate("", PAYLOAD, NO_SECRETS)).toBe(JSON.stringify(PAYLOAD));
    });

    it("keeps the shape of the body whatever a title holds", () => {
        const title = "Say \"hi\" \\ to C:\\Temp\\\nnext line\r\n\ttab } ] , \"x\": 1 $& $1 "
            + "\u{2028}";
        const body = fillTemplate(
            "{ \"message\": \"[{{category}}] {{title}}\", \"priority\": 5, "
            + "\"tags\": [ \"{{key}}\" ], \"html\": false, \"extra\": null }",
            { ...PAYLOAD, title }, NO_SECRETS);

        expect(JSON.parse(body)).toEqual({
            message: `[general] ${title}`, priority: 5, tags: [ "delivery-key" ], html: false,
            extra: null
        });
    });

    it("fills each string in one pass, so a value that holds a placeholder stays text", () => {
        const secrets = new Map([ [ "token", "s3cret-token" ] ]);
        const body = fillTemplate(
            "{ \"token\": \"{{secret.token}}\", \"text\": \"{{title}} / {{description}}\" }",
            { ...PAYLOAD, title: "{{key}} {{secret.token}}", description: "{{title}}" }, secrets);

        expect(JSON.parse(body)).toEqual({
            token: "s3cret-token", text: "{{key}} {{secret.token}} / {{title}}"
        });
    });

    it("writes an empty string for a field that the payload lacks", () => {
        const body = fillTemplate("{ \"text\": \"{{description}}|{{noteId}}|{{title}}\" }",
            { ...PAYLOAD, description: undefined, noteId: undefined }, NO_SECRETS);

        expect(JSON.parse(body)).toEqual({ text: `||${PAYLOAD.title}` });
    });

    it("keeps a __proto__ key as an own property of the body", () => {
        const body = fillTemplate("{ \"__proto__\": { \"text\": \"{{title}}\" } }", PAYLOAD,
            NO_SECRETS);

        expect(body).toBe(`{"__proto__":{"text":"${PAYLOAD.title}"}}`);
    });

    it("fails with secret for a value that is not set, and with policy for a bad template", () => {
        const template = "{ \"token\": \"{{secret.token}}\", \"user\": \"{{secret.user}}\" }";
        const error = errorOf(() => fillTemplate(template, PAYLOAD, new Map([ [ "token", "t" ] ])));

        expect(error).toBeInstanceOf(ChannelSendError);
        expect(error).toMatchObject({ code: "secret", message: "secret" });
        expect(errorOf(() => fillTemplate("{ \"{{title}}\": 1 }", PAYLOAD, NO_SECRETS)))
            .toMatchObject({ name: "ChannelSendError", code: "policy" });
        expect(errorOf(() => fillTemplate("not json", PAYLOAD, NO_SECRETS)))
            .toMatchObject({ name: "ChannelSendError", code: "policy" });
    });
});

describe("hashTemplate", () => {
    it("gives the SHA-256 of the UTF-8 text in hex, and that of the empty string for none", () => {
        // Computed with node:crypto, so that both providers are held to the same answer.
        const empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

        expect(hashTemplate(undefined)).toBe(empty);
        expect(hashTemplate("")).toBe(empty);
        expect(hashTemplate("{\"text\":\"{{title}}\"}"))
            .toBe("0c47d5371ac65f6627ac2ca84cac1d8e03cf541e14d3768dc8799a8592261647");
        expect(hashTemplate("é\u{1F600}"))
            .toBe("1184d1f608158eea09d297565575892231550c403aaa913008d867a97cfd5c76");
    });
});

function errorOf(run: () => unknown): unknown {
    try {
        run();
    } catch (e) {
        return e;
    }
    throw new Error("expected an error");
}

function codeOf(run: () => unknown) {
    const error = errorOf(run);
    expect(error).toBeInstanceOf(NotificationError);
    return (error as NotificationError).code;
}
