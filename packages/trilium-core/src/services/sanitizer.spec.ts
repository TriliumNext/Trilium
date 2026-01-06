import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "./sanitizer.js";
import { trimIndentation } from "@triliumnext/commons";

describe("sanitize", () => {
    it("filters out position inline CSS", () => {
        const dirty = `<div style="z-index:999999999;margin:0px;left:250px;height:100px;display:table;background:none;position:fixed;top:250px;"></div>`;
        const clean = `<div></div>`;
        expect(sanitizeHtml(dirty)).toBe(clean);
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
        expect(sanitizeHtml(dirty)).toBe(clean);
    });
});
