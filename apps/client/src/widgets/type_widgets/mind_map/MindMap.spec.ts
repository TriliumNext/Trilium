// @vitest-environment jsdom
// DOMPurify relies on browser-faithful DOM traversal (NodeIterator); happy-dom
// mishandles it and strips valid markup (surfaced by dompurify 3.4.8). Run the
// sanitization-dependent specs under jsdom, which matches real-browser behavior.
import i18next from "i18next";
import { DARK_THEME, MindElixirInstance, THEME as LIGHT_THEME } from "mind-elixir";
import { beforeAll, describe, expect, it } from "vitest";

import englishTranslation from "../../../translations/en/translation.json";

import { buildTheme, localizeBuiltLabels, renameOverlayLabel, sanitizeMindMapData } from "./MindMap.js";

describe("sanitizeMindMapData", () => {
    it("strips XSS/RCE vectors from dangerouslySetInnerHTML (GHSA-rj57-j38v-3577)", () => {
        const data = {
            nodeData: {
                id: "root",
                topic: "root",
                dangerouslySetInnerHTML: `<img src=x onerror="require('child_process').exec('calc')">`,
                children: []
            }
        };

        const sanitized = sanitizeMindMapData(data);
        const html = sanitized.nodeData.dangerouslySetInnerHTML;

        expect(html).not.toContain("onerror");
        expect(html).not.toContain("child_process");
        // The benign part of the markup is preserved rather than dropped wholesale.
        expect(html).toContain("<img");
    });

    it("removes <script> payloads while keeping harmless markup", () => {
        const data = { nodeData: { dangerouslySetInnerHTML: `<b>hi</b><script>alert(1)</script>` } };

        const html = sanitizeMindMapData(data).nodeData.dangerouslySetInnerHTML;

        expect(html).toContain("<b>hi</b>");
        expect(html).not.toContain("<script");
    });

    it("sanitizes the property anywhere in the tree, including nested children", () => {
        const data = {
            nodeData: {
                id: "root",
                topic: "root",
                children: [
                    { id: "a", topic: "a" },
                    {
                        id: "b",
                        topic: "b",
                        dangerouslySetInnerHTML: `<svg><script>alert(1)</script></svg>`,
                        children: [
                            { id: "c", dangerouslySetInnerHTML: `<a href="javascript:alert(1)">x</a>` }
                        ]
                    }
                ]
            }
        };

        sanitizeMindMapData(data);

        const b = data.nodeData.children[1];
        expect(b.dangerouslySetInnerHTML).not.toContain("<script");
        expect(b.children?.[0].dangerouslySetInnerHTML).not.toContain("javascript:");
    });

    it("mutates in place and returns the same reference", () => {
        const data = { nodeData: { topic: "root" } };
        expect(sanitizeMindMapData(data)).toBe(data);
    });

    it("leaves content without the property untouched", () => {
        const data = { nodeData: { id: "root", topic: "hello", children: [] } };
        sanitizeMindMapData(data);
        expect(data).toEqual({ nodeData: { id: "root", topic: "hello", children: [] } });
    });

    it("ignores a non-string dangerouslySetInnerHTML value", () => {
        const data = { nodeData: { dangerouslySetInnerHTML: 123 } };
        sanitizeMindMapData(data);
        expect(data.nodeData.dangerouslySetInnerHTML).toBe(123);
    });
});

describe("buildTheme", () => {
    function container(background?: string) {
        const el = document.createElement("div");
        if (background) {
            el.style.setProperty("--main-background-color", background);
        }
        return el;
    }

    it("draws the map on Trilium's background, keeping the rest of the scheme's theme", () => {
        const light = buildTheme("light", container("#fafafa"));
        expect(light.name).toBe(LIGHT_THEME.name);
        expect(light.cssVar?.["--bgcolor"]).toBe("#fafafa");
        expect(light.cssVar?.["--main-bgcolor"]).toBe(LIGHT_THEME.cssVar["--main-bgcolor"]);
        expect(light.palette).toEqual(LIGHT_THEME.palette);

        const dark = buildTheme("dark", container("#242424"));
        expect(dark.name).toBe(DARK_THEME.name);
        expect(dark.cssVar?.["--bgcolor"]).toBe("#242424");
    });

    it("leaves the theme as it is when Trilium's background cannot be resolved", () => {
        expect(buildTheme("dark", container())).toBe(DARK_THEME);
    });
});

describe("localizeBuiltLabels", () => {
    // The names under test are read through i18next, which nothing else in the suite sets up.
    beforeAll(() => i18next.init({ lng: "en", resources: { en: { translation: englishTranslation } } }));

    type Topic = Parameters<MindElixirInstance["createArrow"]>[0];
    type SummarySvg = Parameters<MindElixirInstance["editSummary"]>[0];

    /** An instance carrying only the methods a case drives, since only those are taken over. */
    function fakeMind(methods: Partial<MindElixirInstance>) {
        return { ...methods } as MindElixirInstance;
    }

    function fakeSummary(label: string) {
        const labelEl = document.createElement("div");
        labelEl.textContent = label;
        return { summaryObj: { label }, labelEl } as SummarySvg;
    }

    const NODE = {} as Topic;

    it("names a new arrow, letting one it is given a name for through", () => {
        const given: unknown[] = [];
        const mind = fakeMind({ createArrow: (_from, _to, options) => void given.push(options) });
        localizeBuiltLabels(mind);

        mind.createArrow(NODE, NODE);
        mind.createArrow(NODE, NODE, { bidirectional: true });
        mind.createArrow(NODE, NODE, { label: "Mine" } as Parameters<MindElixirInstance["createArrow"]>[2]);

        expect(given).toEqual([
            { label: "Custom link" },
            { label: "Custom link", bidirectional: true },
            { label: "Mine" }
        ]);
    });

    it("names a summary as it is built, and leaves one opened for editing alone", () => {
        const built = fakeSummary("summary");
        const existing = fakeSummary("summary");
        const edited: SummarySvg[] = [];
        const mind = fakeMind({
            // The library hands a summary it has just built straight to the editor, through the
            // instance — which is the moment the name is replaced in.
            createSummary: function () { this.editSummary(built); },
            editSummary: (summary) => void edited.push(summary)
        });
        localizeBuiltLabels(mind);

        mind.createSummary();
        mind.editSummary(existing);

        expect(built.summaryObj.label).toBe("Summary");
        expect(built.labelEl?.textContent).toBe("Summary");
        // Named "summary" by whoever wrote it, so it stays that way.
        expect(existing.summaryObj.label).toBe("summary");
        expect(existing.labelEl?.textContent).toBe("summary");
        // Both still reach the editor, renamed or not.
        expect(edited).toEqual([ built, existing ]);
    });
});

describe("renameOverlayLabel", () => {
    function overlayLabel(anchor: string, width: number, height: number) {
        const label = document.createElement("div");
        Object.assign(label.dataset, { x: "100", y: "50", anchor });
        // jsdom lays nothing out, so the size the label is placed against is stated outright.
        Object.defineProperty(label, "clientWidth", { value: width });
        Object.defineProperty(label, "clientHeight", { value: height });
        return label;
    }

    it("places a renamed label against the point and the side it was built for", () => {
        const trailing = overlayLabel("start", 40, 20);
        renameOverlayLabel(trailing, "Rezumat");
        expect(trailing.textContent).toBe("Rezumat");
        expect([ trailing.style.left, trailing.style.top ]).toEqual([ "100px", "40px" ]);

        // The ones that grow leftwards move by what they gained, so the point they mark stays put.
        const leading = overlayLabel("end", 40, 20);
        renameOverlayLabel(leading, "Rezumat");
        expect([ leading.style.left, leading.style.top ]).toEqual([ "60px", "40px" ]);

        const centered = overlayLabel("middle", 40, 20);
        renameOverlayLabel(centered, "Rezumat");
        expect([ centered.style.left, centered.style.top ]).toEqual([ "80px", "40px" ]);
    });

    it("renames a label that records no point of its own without placing it anywhere", () => {
        const label = document.createElement("div");
        renameOverlayLabel(label, "Rezumat");
        expect(label.textContent).toBe("Rezumat");
        expect([ label.style.left, label.style.top ]).toEqual([ "", "" ]);
    });
});
