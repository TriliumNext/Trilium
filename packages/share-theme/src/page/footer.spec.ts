// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import setupFooter from "./footer.js";

describe("setupFooter", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        document.documentElement.removeAttribute("lang");
    });

    it("writes the dates out in the page's language, in the visitor's time zone", () => {
        document.documentElement.lang = "de";
        document.body.innerHTML = `
            <footer id="content-footer">
                <time datetime="2026-10-09T12:00:00.000Z">9. Oktober 2026</time>
                <time datetime="not a date">kept</time>
            </footer>
        `;

        setupFooter();

        const [ valid, invalid ] = document.querySelectorAll("time");
        expect(valid.textContent).toBe(new Intl.DateTimeFormat("de", { dateStyle: "long" })
            .format(new Date("2026-10-09T12:00:00.000Z")));
        expect(valid.textContent).toMatch(/Oktober 2026$/);
        expect(invalid.textContent).toBe("kept");
    });

    it("writes the dates out in the browser's language when the page has none", () => {
        document.body.innerHTML = `
            <footer id="content-footer"><time datetime="2026-10-09T12:00:00.000Z"></time></footer>
        `;

        setupFooter();

        const expected = new Intl.DateTimeFormat(undefined, { dateStyle: "long" })
            .format(new Date("2026-10-09T12:00:00.000Z"));
        expect(document.querySelector("time")?.textContent).toBe(expected);
    });
});
