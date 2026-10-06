import { describe, expect, it } from "vitest";
import { getMermaidConfig, postprocessMermaidSvg } from "./mermaid.js";
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

describe("getMermaidConfig", () => {
    it("reads the --mermaid-theme CSS variable (trimmed), pins the pre-12 layout and look, and keeps the static useMaxWidth flags", () => {
        document.documentElement.style.setProperty("--mermaid-theme", "  dark  ");

        const config = getMermaidConfig();

        expect(config.theme).toBe("dark");
        expect(config.layout).toBe("dagre");
        expect(config.look).toBe("classic");
        expect(config.securityLevel).toBe("antiscript");
        expect(config.flowchart).toEqual({ useMaxWidth: false });
        expect(config.sequence).toEqual({ useMaxWidth: false });
        expect(config.gantt).toEqual({ useMaxWidth: false });
        expect(config.class).toEqual({ useMaxWidth: false });
        expect(config.state).toEqual({ useMaxWidth: false });
        expect(config.pie).toEqual({ useMaxWidth: true });
        expect(config.journey).toEqual({ useMaxWidth: false });
        expect(config.gitGraph).toEqual({ useMaxWidth: false });

        document.documentElement.style.removeProperty("--mermaid-theme");
    });
});
