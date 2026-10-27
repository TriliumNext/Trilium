import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";

import { findSlowSelectors } from "../test/css_invalidation";

const ROOT = join(__dirname, "../../../..");
const SOURCES = [ "apps/client/src", "packages/ckeditor5/src" ];

/** The stylesheet of the login and setup pages, which never show a note. */
const SEPARATE_PAGES = new Set([ "apps/client/src/setup.css" ]);

/**
 * `<p>`, `<div>` and `<td>` already depend on their position through CKEditor's content
 * stylesheet (`li > p:first-of-type`, `.ck-fake-panel div:nth-child(2)`,
 * `:is(td, th):last-of-type`), so these add nothing; `<h5>` and `<header>` add only themselves.
 */
const ACCEPTED: Record<string, string[]> = {
    "apps/client/src/stylesheets/style.css": [ ".tooltip-inner p:last-of-type" ],
    "apps/client/src/stylesheets/theme-next/notes/text.css": [
        ".ck-content blockquote p:last-of-type"
    ],
    "apps/client/src/stylesheets/theme-next/pages.css": [
        ".options-section-card h5:first-of-type",
        ".options-section-card p:last-of-type:not(:first-of-type)"
    ],
    "apps/client/src/stylesheets/theme-next/shell.css": [
        "div.promoted-attribute-cell.promoted-attribute-label-boolean > div:first-of-type"
    ],
    "apps/client/src/widgets/mobile_widgets/TabSwitcher.css": [
        ".modal.tab-bar-modal .tabs .tab-card header:not(:first-of-type)"
    ],
    "apps/client/src/widgets/type_widgets/SqlConsole.css": [
        ".sql-console-widget-container .sql-table-schemas-widget .dropdown .table-schema"
            + " td:nth-child(0n+2)"
    ]
};

describe("findSlowSelectors", () => {
    it("finds each shape, nested or not, and passes the keyed forms", () => {
        // LightningCSS drops a rule without declarations, so each fixture has one.
        const shapes = (css: string) =>
            findSlowSelectors(css, "test.css").map(({ shape }) => shape);

        expect(shapes(".list > * + * { color: red }")).toEqual([ "sibling-then-universal" ]);
        expect(shapes(".list { & > * { & + * { color: red } } }"))
            .toEqual([ "sibling-then-universal" ]);
        expect(shapes(".table tr:nth-of-type(odd) > * { color: red }"))
            .toEqual([ "positional-then-universal" ]);
        expect(shapes(".alert p + p { color: red }")).toEqual([ "keyless-sibling" ]);
        expect(shapes(".row > :nth-child(2) { color: red }")).toEqual([ "keyless-nth" ]);
        expect(shapes(".card { header { &:not(:first-of-type) { color: red } } }"))
            .toEqual([ "keyless-nth" ]);

        expect(shapes([
            ".list > .ck + .ck",
            ".alert p:not(:first-child)",
            ".row > .item:nth-child(2)",
            ".a > li:first-child",
            ".a + .b",
            ".transcript-paragraph + .transcript-paragraph"
        ].map((selector) => `${selector} { color: red }`).join("\n"))).toEqual([]);
    });
});

describe("Stylesheets", () => {
    it("have no selector that restyles a whole container when an element is inserted", () => {
        const found: string[] = [];
        for (const dir of SOURCES) {
            for (const file of cssFiles(join(ROOT, dir))) {
                const path = relative(ROOT, file).replace(/\\/g, "/");
                if (SEPARATE_PAGES.has(path)) {
                    continue;
                }
                const code = readFileSync(file, "utf8");
                for (const { shape, selector } of findSlowSelectors(code, file)) {
                    if (!ACCEPTED[path]?.includes(selector)) {
                        found.push(`${path} :: ${selector} (${shape})`);
                    }
                }
            }
        }

        expect(found).toEqual([]);
    });
});

function* cssFiles(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (name === "node_modules" || name === "test-output" || name === "dist") {
            continue;
        }
        if (statSync(path).isDirectory()) {
            yield* cssFiles(path);
        } else if (name.endsWith(".css")) {
            yield path;
        }
    }
}
