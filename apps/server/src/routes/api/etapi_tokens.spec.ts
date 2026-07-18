import { cls } from "@triliumnext/core";
import type { Request } from "express";
import { describe, expect, it } from "vitest";

import etapiTokensRoute from "./etapi_tokens.js";

function req(body: Record<string, unknown> = {}, params: Record<string, string> = {}) {
    return { body, params } as unknown as Request<{ etapiTokenId: string }>;
}

describe("ETAPI tokens API", () => {
    it("creates, lists, renames and deletes a token", () => {
        const created = cls.init(() => etapiTokensRoute.createToken(req({ tokenName: "spec-token" })));
        expect(created.authToken).toBeTruthy();

        const token = cls.init(() => etapiTokensRoute.getTokens().find(t => t.name === "spec-token"));
        const etapiTokenId = token?.etapiTokenId ?? "";
        expect(etapiTokenId).toBeTruthy();

        cls.init(() => etapiTokensRoute.patchToken(req({ name: "renamed" }, { etapiTokenId })));
        const renamed = cls.init(() => etapiTokensRoute.getTokens().find(t => t.etapiTokenId === etapiTokenId));
        expect(renamed?.name).toBe("renamed");

        cls.init(() => etapiTokensRoute.deleteToken(req({}, { etapiTokenId })));
        const afterDelete = cls.init(() => etapiTokensRoute.getTokens().find(t => t.etapiTokenId === etapiTokenId));
        expect(afterDelete).toBeUndefined();
    });

    it("returns tokens sorted by creation date", () => {
        cls.init(() => etapiTokensRoute.createToken(req({ tokenName: "a" })));
        cls.init(() => etapiTokensRoute.createToken(req({ tokenName: "b" })));

        const tokens = cls.init(() => etapiTokensRoute.getTokens());
        for (let i = 1; i < tokens.length; i++) {
            expect(tokens[i - 1].utcDateCreated <= tokens[i].utcDateCreated).toBe(true);
        }
    });
});
