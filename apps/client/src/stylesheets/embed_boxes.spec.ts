import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

describe("embed boxes", () => {
    afterEach(() => {
        document.head.innerHTML = "";
        document.body.innerHTML = "";
    });

    it("lets an extended code block, and no other embed, sit beside a wrapped box", () => {
        const styles = readFileSync(join(__dirname, "style.css"), "utf8");
        document.head.innerHTML = `<style>${styles}</style>`;
        document.body.innerHTML = `
            <figure class="include-note" data-box-size="full"></figure>
            <figure class="include-note extended-code-block" data-box-size="full"></figure>
            <figure class="include-note extended-code-block" data-box-size="resizable"
                data-position="right"></figure>`;

        const looks = [ ...document.querySelectorAll("figure") ].map((figure) => {
            const { clear, minWidth } = getComputedStyle(figure);
            return [ clear, minWidth ];
        });

        const besideWrappedBox = [ "none", "min(100%, 200px)" ];
        expect(looks).toEqual([ [ "both", "" ], besideWrappedBox, besideWrappedBox ]);
    });
});
