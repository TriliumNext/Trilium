import { describe, expect, it } from "vitest";

import { resolveShareThemeGroups } from "./share_hosting.js";

describe("share theme groups", () => {
    it("resolves the groups each group requires, transitively and once", () => {
        const requires = { a: [ "b" ], b: [ "c", "a" ], c: [] };

        expect(resolveShareThemeGroups(requires, [ "a" ]).sort()).toEqual([ "a", "b", "c" ]);
        expect(resolveShareThemeGroups(requires, [ "unknown" ])).toEqual([ "unknown" ]);
    });
});
