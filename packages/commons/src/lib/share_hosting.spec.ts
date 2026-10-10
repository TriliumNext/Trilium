import { describe, expect, it } from "vitest";

import { getShareThemeGroupFiles, resolveShareThemeGroups } from "./share_hosting.js";

describe("share theme groups", () => {
    const manifest = {
        files: [ "scripts.js" ],
        lazy: {
            app: [ "app.js", "preact.js" ],
            "view:geoMap": [ "geomap.js", "preact.js" ],
            "view:calendar": [ "calendar.js" ],
            mermaid: [ "mermaid.js" ]
        },
        requires: { "view:geoMap": [ "app" ], "view:calendar": [ "app" ], app: [], mermaid: [] }
    };

    it("resolves the groups each group requires, transitively and once", () => {
        const requires = { a: [ "b" ], b: [ "c", "a" ], c: [] };

        expect(resolveShareThemeGroups(requires, [ "a" ]).sort()).toEqual([ "a", "b", "c" ]);
        expect(resolveShareThemeGroups(requires, [ "unknown" ])).toEqual([ "unknown" ]);
    });

    it("lists the files of the groups and of those they require, each once", () => {
        expect(getShareThemeGroupFiles(manifest, [ "view:geoMap", "view:calendar" ]).sort())
            .toEqual([ "app.js", "calendar.js", "geomap.js", "preact.js" ]);
        expect(getShareThemeGroupFiles(manifest, [])).toEqual([]);
        expect(getShareThemeGroupFiles(manifest, [ "type:none" ])).toEqual([]);
    });
});
