import { readdirSync, readFileSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";

import {
    isInteractiveSession,
    isSyncSession,
    markLoggedIn,
    markLoggedOut
} from "./login_session.js";

describe("login sessions", () => {
    it("tells interactive and sync sessions apart, and one without a kind is neither", () => {
        const session: Parameters<typeof markLoggedIn>[0] = {};
        expect(isInteractiveSession(session)).toBe(false);
        expect(isInteractiveSession(undefined)).toBe(false);

        markLoggedIn(session, "interactive");
        expect([ isInteractiveSession(session), isSyncSession(session) ]).toEqual([ true, false ]);

        markLoggedIn(session, "sync");
        expect([ isInteractiveSession(session), isSyncSession(session) ]).toEqual([ false, true ]);

        markLoggedOut(session);
        expect(session).toEqual({ loggedIn: false });
        expect(isSyncSession(session)).toBe(false);

        // A session that logged in before the kinds existed.
        expect([ isInteractiveSession({ loggedIn: true }), isSyncSession({ loggedIn: true }) ])
            .toEqual([ false, false ]);
    });

    it("is the one file of the server that reads or writes loggedIn", () => {
        const sourceRoot = join(__dirname, "..");
        const offenders = listSources(sourceRoot)
            .filter((file) => !file.endsWith("login_session.ts"))
            .filter((file) => /\.loggedIn\b|\[["']loggedIn["']\]/.test(readFileSync(file, "utf-8")))
            .map((file) => relative(sourceRoot, file));

        expect(offenders).toEqual([]);
    });
});

function listSources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            return listSources(path);
        }
        const isSource = /\.tsx?$/.test(entry.name) && !/\.(spec|d)\.tsx?$/.test(entry.name);
        return isSource ? [ path ] : [];
    });
}
