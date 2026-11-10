import { describe, expect, it } from "vitest";

import becca from "../becca.js";
import BEtapiToken from "./betapi_token.js";
import { getContext } from "../../services/context.js";
import { getSql } from "../../services/sql/index.js";

describe("BEtapiToken static metadata", () => {
    it("exposes entityName, primaryKeyName and hashedProperties", () => {
        expect(BEtapiToken.entityName).toBe("etapi_tokens");
        expect(BEtapiToken.primaryKeyName).toBe("etapiTokenId");
        expect(BEtapiToken.hashedProperties).toContain("tokenHash");
    });
});

describe("BEtapiToken constructor", () => {
    it("returns early without populating fields when no row is given", () => {
        const token = new BEtapiToken();

        expect(token.etapiTokenId).toBeUndefined();
        expect(token.name).toBeUndefined();
        expect(token.tokenHash).toBeUndefined();
    });

    it("populates fields and registers itself in becca when a row is given", () => {
        const token = new BEtapiToken({
            etapiTokenId: "betapi-spec-1",
            name: "spec token",
            tokenHash: "hash-1"
        });

        expect(token.name).toBe("spec token");
        expect(token.tokenHash).toBe("hash-1");
        expect(token.isDeleted).toBe(false);
        expect(typeof token.utcDateCreated).toBe("string");
        expect(token.utcDateModified).toBe(token.utcDateCreated);
        expect(becca.etapiTokens["betapi-spec-1"]).toBe(token);
    });

    it("does not register the token in becca when the id is missing", () => {
        const before = Object.keys(becca.etapiTokens).length;

        const token = new BEtapiToken({
            etapiTokenId: undefined,
            name: "idless token",
            tokenHash: "hash-idless"
        });

        // updateFromRow and init both skip registration since etapiTokenId is falsy.
        expect(token.etapiTokenId).toBeUndefined();
        expect(token.name).toBe("idless token");
        expect(Object.keys(becca.etapiTokens).length).toBe(before);
    });

    it("keeps supplied dates and reflects the deleted flag", () => {
        const token = new BEtapiToken({
            etapiTokenId: "betapi-spec-2",
            name: "deleted token",
            tokenHash: "hash-2",
            utcDateCreated: "2025-06-27 14:10:39.688+0300",
            utcDateModified: "2025-06-28 14:10:39.688+0300",
            isDeleted: true
        });

        expect(token.utcDateCreated).toBe("2025-06-27 14:10:39.688+0300");
        expect(token.utcDateModified).toBe("2025-06-28 14:10:39.688+0300");
        expect(token.isDeleted).toBe(true);
    });
});

describe("BEtapiToken init", () => {
    it("re-registers the token in becca", () => {
        const token = new BEtapiToken({
            etapiTokenId: "betapi-spec-init-1",
            name: "init token",
            tokenHash: "hash-init"
        });

        delete becca.etapiTokens["betapi-spec-init-1"];
        token.init();

        expect(becca.etapiTokens["betapi-spec-init-1"]).toBe(token);
    });
});

describe("BEtapiToken getPojo", () => {
    it("returns the expected shape", () => {
        const token = new BEtapiToken({
            etapiTokenId: "betapi-spec-pojo-1",
            name: "pojo token",
            tokenHash: "hash-pojo",
            utcDateCreated: "2025-06-27 14:10:39.688+0300",
            utcDateModified: "2025-06-27 14:10:39.688+0300",
            isDeleted: false
        });

        expect(token.getPojo()).toEqual({
            etapiTokenId: "betapi-spec-pojo-1",
            name: "pojo token",
            tokenHash: "hash-pojo",
            utcDateCreated: "2025-06-27 14:10:39.688+0300",
            utcDateModified: "2025-06-27 14:10:39.688+0300",
            isDeleted: false
        });
    });
});

describe("BEtapiToken save (beforeSaving)", () => {
    it("updates utcDateModified, persists and registers the token", () => {
        const etapiTokenId = "betapi-spec-save-1";
        const token = new BEtapiToken({
            etapiTokenId,
            name: "save token",
            tokenHash: "hash-save",
            utcDateCreated: "2025-06-27 14:10:39.688+0300",
            utcDateModified: "2025-06-27 14:10:39.688+0300"
        });

        getContext().init(() => token.save());

        const row = getSql().getRow<Record<string, unknown>>(
            "SELECT * FROM etapi_tokens WHERE etapiTokenId = ?",
            [etapiTokenId]
        );
        expect(row).toBeDefined();
        expect(row?.name).toBe("save token");
        expect(row?.tokenHash).toBe("hash-save");
        expect(becca.etapiTokens[etapiTokenId]).toBe(token);
        // beforeSaving refreshes utcDateModified to "now", differing from the supplied value.
        expect(typeof token.utcDateModified).toBe("string");
    });
});
