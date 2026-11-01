import { describe, expect, it } from "vitest";

import { filterAttributeName, isValidAttributeName } from "./attribute_names.js";

describe("filterAttributeName", () => {
    it("keeps only letters, numbers, underscore and colon", () => {
        expect(filterAttributeName("a b#c:d_1!")).toBe("abc:d_1");
        expect(filterAttributeName("valid_name:1")).toBe("valid_name:1");
    });

    it("keeps non-ASCII letters and numbers", () => {
        // The character set is expressed in Unicode property escapes, not [a-z].
        expect(filterAttributeName("étiquette")).toBe("étiquette");
        expect(filterAttributeName("日本語:名前")).toBe("日本語:名前");
    });

    it("can filter a name down to nothing", () => {
        expect(filterAttributeName("!@#$")).toBe("");
        expect(filterAttributeName("")).toBe("");
    });

    it("returns the same result when called repeatedly", () => {
        // The matcher is a module-level global regex, so a leaked `lastIndex` would make
        // successive calls disagree.
        expect(filterAttributeName("a b#c")).toBe("abc");
        expect(filterAttributeName("a b#c")).toBe("abc");
        expect(filterAttributeName("a b#c")).toBe("abc");
    });
});

describe("isValidAttributeName", () => {
    it("accepts a name made only of allowed characters", () => {
        expect(isValidAttributeName("valid_name:1")).toBe(true);
        expect(isValidAttributeName("étiquette")).toBe(true);
    });

    it("rejects disallowed characters and the empty name", () => {
        expect(isValidAttributeName("has space")).toBe(false);
        expect(isValidAttributeName("has#hash")).toBe(false);
        expect(isValidAttributeName("has-dash")).toBe(false);
        expect(isValidAttributeName("")).toBe(false);
    });

    it("agrees with filterAttributeName", () => {
        // Filtering yields a valid name whenever anything survives, which is what the callers
        // that filter-then-use rely on.
        for (const name of [ "a b#c:d_1!", "valid_name:1", "étiquette", "!@#$" ]) {
            const filtered = filterAttributeName(name);
            expect(isValidAttributeName(filtered)).toBe(filtered !== "");
        }
    });
});
