import type { EtapiToken } from "@triliumnext/commons";
import { cls } from "@triliumnext/core";
import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";

import etapiTokenService from "../../services/etapi_tokens.js";
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
        const token = (name: string, utcDateCreated: string) => ({ etapiTokenId: name, name, utcDateCreated }) as EtapiToken;
        vi.spyOn(etapiTokenService, "getTokens").mockReturnValue([
            token("middle", "2024-02-01 00:00:00.000Z"),
            token("newest", "2024-03-01 00:00:00.000Z"),
            token("oldest", "2024-01-01 00:00:00.000Z")
        ] as ReturnType<typeof etapiTokenService.getTokens>);

        try {
            expect(etapiTokensRoute.getTokens().map(t => t.name)).toEqual([ "oldest", "middle", "newest" ]);
        } finally {
            vi.restoreAllMocks();
        }
    });
});
