import { describe, expect, it } from "vitest";

import BNote from "./entities/bnote.js";
import BRevision from "./entities/brevision.js";
import entityConstructor from "./entity_constructor.js";

describe("entity_constructor.getEntityFromEntityName", () => {
    it("returns the matching entity class for known table names", () => {
        expect(entityConstructor.getEntityFromEntityName("notes")).toBe(BNote);
        expect(entityConstructor.getEntityFromEntityName("revisions")).toBe(BRevision);
    });

    it("throws for an unknown table name", () => {
        expect(() =>
            entityConstructor.getEntityFromEntityName("nonexistent" as "notes")
        ).toThrow();
    });
});
