import { cls } from "@triliumnext/core";
import { beforeAll, describe, expect, it } from "vitest";

import etapiTokens from "./etapi_tokens.js";
import sql_init from "./sql_init.js";
import { toBase64 } from "./utils.js";

describe("etapi_tokens", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
    });

    describe("parseAuthToken", () => {
        it("returns null for missing auth", () => {
            expect(etapiTokens.parseAuthToken(undefined)).toBeNull();
            expect(etapiTokens.parseAuthToken("")).toBeNull();
        });

        it("parses the legacy single-chunk format and the id_token format", () => {
            expect(etapiTokens.parseAuthToken("legacytoken")).toEqual({ token: "legacytoken" });
            expect(etapiTokens.parseAuthToken("abc123_secrettoken")).toEqual({
                etapiTokenId: "abc123",
                token: "secrettoken"
            });
        });

        it("returns null for a malformed three-chunk token", () => {
            expect(etapiTokens.parseAuthToken("a_b_c")).toBeNull();
        });

        it("strips a Bearer prefix", () => {
            expect(etapiTokens.parseAuthToken("Bearer id_tok")).toEqual({
                etapiTokenId: "id",
                token: "tok"
            });
        });

        it("parses Basic auth with the 'etapi' username", () => {
            const basic = "Basic " + toBase64("etapi:id_tok");
            expect(etapiTokens.parseAuthToken(basic)).toEqual({ etapiTokenId: "id", token: "tok" });
        });

        it("rejects Basic auth with the wrong username or wrong chunk count", () => {
            expect(etapiTokens.parseAuthToken("Basic " + toBase64("wrong:tok"))).toBeNull();
            expect(etapiTokens.parseAuthToken("Basic " + toBase64("nocolon"))).toBeNull();
            expect(etapiTokens.parseAuthToken("Basic " + toBase64("a:b:c"))).toBeNull();
        });
    });

    describe("createToken + isValidAuthHeader", () => {
        it("creates a token that validates via its id_token, Bearer and Basic forms", () => {
            const { authToken } = cls.init(() => etapiTokens.createToken("My token"));
            expect(authToken).toContain("_");

            expect(etapiTokens.isValidAuthHeader(authToken)).toBe(true);
            expect(etapiTokens.isValidAuthHeader(`Bearer ${authToken}`)).toBe(true);
            expect(etapiTokens.isValidAuthHeader("Basic " + toBase64(`etapi:${authToken}`))).toBe(true);

            // legacy form (no id) should also match by scanning all tokens
            const legacyToken = authToken.split("_")[1];
            expect(etapiTokens.isValidAuthHeader(legacyToken)).toBe(true);
        });

        it("rejects unparseable, unknown-id, and non-matching tokens", () => {
            expect(etapiTokens.isValidAuthHeader(undefined)).toBe(false);
            expect(etapiTokens.isValidAuthHeader("a_b_c")).toBe(false);
            expect(etapiTokens.isValidAuthHeader("nonexistentid_sometoken")).toBe(false);
            expect(etapiTokens.isValidAuthHeader("unmatchedlegacytoken")).toBe(false);
        });
    });

    describe("rename / delete / get", () => {
        it("renames an existing token and lists it", () => {
            const { authToken } = cls.init(() => etapiTokens.createToken("Before"));
            const etapiTokenId = authToken.split("_")[0];

            cls.init(() => etapiTokens.renameToken(etapiTokenId, "After"));

            const tokens = etapiTokens.getTokens();
            const renamed = tokens.find((t) => t.etapiTokenId === etapiTokenId);
            expect(renamed?.name).toBe("After");
        });

        it("throws when renaming a non-existent token", () => {
            cls.init(() => {
                expect(() => etapiTokens.renameToken("doesNotExist", "x")).toThrow();
            });
        });

        it("deletes a token and treats a repeat delete as a no-op", () => {
            const { authToken } = cls.init(() => etapiTokens.createToken("ToDelete"));
            const etapiTokenId = authToken.split("_")[0];

            cls.init(() => etapiTokens.deleteToken(etapiTokenId));
            expect(etapiTokens.getTokens().some((t) => t.etapiTokenId === etapiTokenId)).toBe(false);

            // deleting again is a no-op (already deleted)
            cls.init(() => expect(() => etapiTokens.deleteToken(etapiTokenId)).not.toThrow());
        });
    });
});
