import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { transform } from "lightningcss";
import { describe, expect, it } from "vitest";

const THEME_DIR = join(__dirname, "../../../../packages/ckeditor5/src/theme");

/**
 * The client builds its stylesheets with Lightning CSS, which expands an `animation` shorthand
 * with a `0s` duration. A scroll-driven animation needs `auto`, or it ends as soon as it starts.
 */
describe("scroll-driven animations in the content stylesheets", () => {
    it("keep an automatic duration through Lightning CSS", () => {
        const checked: string[] = [];
        for (const filename of readdirSync(THEME_DIR).filter((name) => name.endsWith(".css"))) {
            const source = readFileSync(join(THEME_DIR, filename));
            const css = transform({ filename, code: source }).code.toString();
            if (css.includes("animation-timeline")) {
                checked.push(filename);
                expect(css, filename).not.toMatch(/animation-duration:[^;]*\b0s/);
            }
        }

        expect(checked).toContain("table_sticky_header.css");
    });
});
