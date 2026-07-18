import type { Mermaid } from "mermaid";
import { describe, expect, it, vi } from "vitest";
import { getMermaidConfig, loadElkIfNeeded, postprocessMermaidSvg } from "./mermaid.js";
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
    it("reads the --mermaid-theme CSS variable (trimmed) and keeps the static useMaxWidth flags", () => {
        document.documentElement.style.setProperty("--mermaid-theme", "  dark  ");

        const config = getMermaidConfig();

        expect(config.theme).toBe("dark");
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

describe("loadElkIfNeeded", () => {
    function fakeMermaid(parseResult: unknown) {
        return {
            parse: vi.fn(async () => parseResult),
            registerLayoutLoaders: vi.fn()
        } as unknown as Mermaid & {
            parse: ReturnType<typeof vi.fn>;
            registerLayoutLoaders: ReturnType<typeof vi.fn>;
        };
    }

    // NOTE: the module-level `elkLoaded` flag flips to true the first time an
    // elk diagram is parsed, and the source exposes no way to reset it. The
    // "does not register" cases must therefore run while the flag is still false.
    // The "already loaded" early-exit test flips the flag itself (so it does not
    // depend on a sibling test having run first) before asserting the early exit.

    it("does not register loaders when parsing yields nothing", async () => {
        const mermaid = fakeMermaid(null);
        await loadElkIfNeeded(mermaid, "graph TD; A-->B");
        expect(mermaid.parse).toHaveBeenCalledWith("graph TD; A-->B", { suppressErrors: true });
        expect(mermaid.registerLayoutLoaders).not.toHaveBeenCalled();
    });

    it("does not register loaders when the layout is not elk", async () => {
        const mermaid = fakeMermaid({ config: { layout: "dagre" } });
        await loadElkIfNeeded(mermaid, "graph TD; A-->B");
        expect(mermaid.registerLayoutLoaders).not.toHaveBeenCalled();
    });

    it("does not register loaders when there is no config at all", async () => {
        const mermaid = fakeMermaid({});
        await loadElkIfNeeded(mermaid, "graph TD; A-->B");
        expect(mermaid.registerLayoutLoaders).not.toHaveBeenCalled();
    });

    it("registers the elk layout loader when the diagram requests elk", async () => {
        const mermaid = fakeMermaid({ config: { layout: "elk" } });
        await loadElkIfNeeded(mermaid, "---\nconfig:\n  layout: elk\n---\ngraph TD; A-->B");
        expect(mermaid.registerLayoutLoaders).toHaveBeenCalledTimes(1);
        expect(mermaid.registerLayoutLoaders.mock.calls[0][0]).toBeTruthy();
    });

    it("exits immediately without parsing once elk has already been loaded", async () => {
        // Make this test self-contained rather than relying on a sibling test having
        // already flipped the module-level `elkLoaded` flag: first flip it ourselves by
        // parsing an elk diagram, then assert the early-exit on a fresh mermaid instance.
        const firstMermaid = fakeMermaid({ config: { layout: "elk" } });
        await loadElkIfNeeded(firstMermaid, "---\nconfig:\n  layout: elk\n---\ngraph TD; A-->B");

        const mermaid = fakeMermaid({ config: { layout: "elk" } });
        await loadElkIfNeeded(mermaid, "---\nconfig:\n  layout: elk\n---\ngraph TD; A-->B");
        expect(mermaid.parse).not.toHaveBeenCalled();
        expect(mermaid.registerLayoutLoaders).not.toHaveBeenCalled();
    });
});
