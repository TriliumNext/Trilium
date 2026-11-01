import { describe, expect, it } from "vitest";

import { getAvatarHues, getInitials } from "./user_avatar.js";

describe("getAvatarHues", () => {
    it("gives users far-apart colors in the order they were added, whatever their names", () => {
        // "alice" and "bob" hashed to the same orange.
        const user = (userId: string, minute: number) => ({ userId, dateCreated: `2026-11-01 10:${String(minute).padStart(2, "0")}:00.000Z` });
        const users = [ user("bob", 2), user("alice", 1), user("carol", 3), user("dave", 4) ];
        const hues = getAvatarHues(users);

        const distance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
        const ordered = [ "alice", "bob", "carol", "dave" ].map((userId) => hues.get(userId) ?? -1);
        for (const [ i, a ] of ordered.entries()) {
            expect(a).toBeGreaterThanOrEqual(0);
            expect(a).toBeLessThan(360);
            for (const b of ordered.slice(i + 1)) expect(distance(a, b)).toBeGreaterThanOrEqual(50);
        }

        // A user added later leaves everyone else's color alone.
        const more = getAvatarHues([ ...users, user("erin", 5) ]);
        expect([ "alice", "bob", "carol", "dave" ].map((userId) => more.get(userId))).toEqual(ordered);
    });
});

describe("getInitials", () => {
    it("takes two letters from one word, or the first of two", () => {
        expect(getInitials("alice")).toBe("AL");
        expect(getInitials("jane.doe")).toBe("JD");
        expect(getInitials("  ")).toBe("?");
    });
});
