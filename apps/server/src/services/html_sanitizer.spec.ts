import { describe, expect, it } from "vitest";
import html_sanitizer from "./html_sanitizer.js";
import { trimIndentation } from "@triliumnext/commons";

describe("sanitize", () => {
    it("filters out position inline CSS", () => {
        const dirty = `<div style="z-index:999999999;margin:0px;left:250px;height:100px;display:table;background:none;position:fixed;top:250px;"></div>`;
        const clean = `<div></div>`;
        expect(html_sanitizer.sanitize(dirty)).toBe(clean);
    });

    it("keeps inline styles defined in CKEDitor", () => {
        const dirty = trimIndentation`\
            <p>
                <span style="color:hsl(0, 0%, 90%);">
                    Hi
                </span>

                <span style="background-color:hsl(30, 75%, 60%);">
                    there
                </span>
            </p>
            <figure class="table" style="float:left;height:800px;width:600px;">
                <table style="background-color:hsl(0, 0%, 90%);border-color:hsl(0, 0%, 0%);border-style:dotted;">
                    <tbody>
                        <tr>
                            <td style="border:2px groove hsl(60, 75%, 60%);"></td>
                        </tr>
                    </tbody>
                </table>
            </figure>`;
        const clean = trimIndentation`\
            <p>
                <span style="color:hsl(0, 0%, 90%)">
                    Hi
                </span>

                <span style="background-color:hsl(30, 75%, 60%)">
                    there
                </span>
            </p>
            <figure class="table" style="float:left;height:800px;width:600px">
                <table style="background-color:hsl(0, 0%, 90%);border-color:hsl(0, 0%, 0%);border-style:dotted">
                    <tbody>
                        <tr>
                            <td style="border:2px groove hsl(60, 75%, 60%)"></td>
                        </tr>
                    </tbody>
                </table>
            </figure>`;
        expect(html_sanitizer.sanitize(dirty)).toBe(clean);
    });

    describe("bookmark anchors", () => {
        it("preserves id attribute on empty <a> tags (CKEditor bookmarks)", () => {
            const dirty = `<a id="my-bookmark"></a>`;
            expect(html_sanitizer.sanitize(dirty)).toBe(dirty);
        });

        it("preserves id attribute on <a> tags with bookmark class", () => {
            const dirty = `<a id="chapter-1" class="ck-bookmark"></a>`;
            expect(html_sanitizer.sanitize(dirty)).toBe(dirty);
        });

        it("strips id attribute from non-anchor tags to prevent DOM clobbering", () => {
            const dirty = `<div id="loginForm">content</div>`;
            expect(html_sanitizer.sanitize(dirty)).toBe(`<div>content</div>`);
        });

        it("strips id attribute from <img> tags to prevent DOM clobbering", () => {
            const dirty = `<img id="someId" src="test.png" />`;
            expect(html_sanitizer.sanitize(dirty)).toBe(`<img src="test.png" />`);
        });
    });
});
