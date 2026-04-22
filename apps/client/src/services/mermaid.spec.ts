import { describe, expect, it } from "vitest";
import { postprocessMermaidSvg } from "./mermaid.js";
import { trimIndentation } from "@triliumnext/commons";

describe("Mermaid", () => {
    it("converts <br> properly", () => {
        const before = trimIndentation`\
            <g transform="translate(-55.71875, -24)" style="color:black !important" class="label">
            <rect></rect>
            <foreignObject height="48" width="111.4375">
                <div xmlns="http://www.w3.org/1999/xhtml"
                style="color: black !important; display: table-cell; white-space: nowrap; line-height: 1.5; max-width: 200px; text-align: center;">
                <span class="nodeLabel" style="color:black !important">
                    <p>Verify Output<br>Against<BR > Criteria</p>
                </span>
                </div>
            </foreignObject>
            </g>
        `;
        const after = trimIndentation`\
            <g transform="translate(-55.71875, -24)" style="color:black !important" class="label">
            <rect></rect>
            <foreignObject height="48" width="111.4375">
                <div xmlns="http://www.w3.org/1999/xhtml"
                style="color: black !important; display: table-cell; white-space: nowrap; line-height: 1.5; max-width: 200px; text-align: center;">
                <span class="nodeLabel" style="color:black !important">
                    <p>Verify Output<br/>Against<br/> Criteria</p>
                </span>
                </div>
            </foreignObject>
            </g>
        `;
        expect(postprocessMermaidSvg(before)).toBe(after);
    });

    it("replaces &nbsp; with numeric entity for valid XML", () => {
        expect(postprocessMermaidSvg("<text>a&nbsp;b&nbsp;&nbsp;c</text>"))
            .toBe("<text>a&#160;b&#160;&#160;c</text>");
    });
});
