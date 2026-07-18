// @vitest-environment jsdom
// The label injection relies on sanitizeNoteContentHtml (DOMPurify), which happy-dom
// breaks (NodeIterator mishandling — see sanitize_content.spec.ts). jsdom matches
// real-browser behavior.
import MindElixir, { type MindElixirData, type MindElixirInstance } from "mind-elixir";
import { describe, expect, it } from "vitest";

import { postProcessExportedSvg, renderMindMapPreviewSvg } from "./mind_map_export";

// mind-elixir touches these browser APIs at construction time; jsdom lacks them.
window.matchMedia = window.matchMedia ?? ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
}));
globalThis.ResizeObserver = globalThis.ResizeObserver ?? class {

    observe() {}
    unobserve() {}
    disconnect() {}

};

/**
 * Reproduces the structure of mind-elixir's `exportSvg()` output:
 * an outer svg holding a background rect and an inner svg with the map layers.
 */
function buildExportedSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="400px" height="300px">` +
        `<rect x="0" y="0" width="400" height="300" fill="#fff"/>` +
        `<svg x="100" y="100" overflow="visible"><g class="topiclinks"></g></svg>` +
        `</svg>`;
}

function buildMind({ labels = [] as string[], exportedSvg = buildExportedSvg() } = {}) {
    const nodes = document.createElement("me-nodes");
    for (const labelHtml of labels) {
        const label = document.createElement("div");
        label.className = "svg-label";
        label.innerHTML = labelHtml;
        nodes.appendChild(label);
    }
    document.body.appendChild(nodes);

    return {
        nodes,
        exportSvg: () => new Blob([ exportedSvg ], { type: "image/svg+xml" })
    } as unknown as MindElixirInstance;
}

describe("postProcessExportedSvg", () => {
    it("appends a foreignObject per label to the inner svg, carrying the label content", () => {
        const mind = buildMind({ labels: [ "first label", "second <b>label</b>" ] });

        const result = postProcessExportedSvg(mind, buildExportedSvg());
        const doc = new DOMParser().parseFromString(result, "image/svg+xml");
        const innerSvg = doc.documentElement.querySelector(":scope > svg");
        const foreignObjects = innerSvg?.querySelectorAll("foreignObject") ?? [];

        expect(foreignObjects).toHaveLength(2);
        expect(foreignObjects[0].textContent).toBe("first label");
        expect(foreignObjects[1].querySelector("b")?.textContent).toBe("label");
        // The outer svg must only gain content inside the inner svg.
        expect(doc.documentElement.querySelectorAll(":scope > foreignObject")).toHaveLength(0);
    });

    it("sanitizes label HTML before embedding it", () => {
        const dirtyLabel = `safe<img src="x" onerror="alert(1)"><script>alert(2)</script>`;
        const mind = buildMind({ labels: [ dirtyLabel ] });

        const result = postProcessExportedSvg(mind, buildExportedSvg());

        expect(result).toContain("safe");
        expect(result).not.toContain("onerror");
        expect(result).not.toContain("<script>");
    });

    it("adds anti-clipping slack to the exporter's exact-fit foreignObject sizes", () => {
        // Exact-fit boxes + pre-wrap clip text when rasterization resolves fonts a hair
        // wider than the page did ("Hi there" → "Hi") — sizes must gain slack.
        const exportedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="400px"
            height="300px"><rect x="0" y="0" width="400" height="300" fill="#fff"/>
            <svg x="100" y="100" overflow="visible"><foreignObject x="10" y="10"
            width="86.3167px" height="37.5px"><div>Hi there</div></foreignObject></svg></svg>`;
        const result = postProcessExportedSvg(buildMind(), exportedSvg);

        const doc = new DOMParser().parseFromString(result, "image/svg+xml");
        const foreignObject = doc.querySelector("foreignObject");
        expect(foreignObject?.getAttribute("width")).toBe(String(Math.ceil(86.3167 * 1.02 + 2)));
        expect(foreignObject?.getAttribute("height")).toBe(String(Math.ceil(37.5 * 1.02 + 2)));
        // The background rect and the svg dimensions must stay untouched.
        expect(doc.querySelector("rect")?.getAttribute("width")).toBe("400");
    });

    it("adds no labels when the map has none, and returns unparseable input unchanged", () => {
        const noLabels = postProcessExportedSvg(buildMind(), buildExportedSvg());
        const doc = new DOMParser().parseFromString(noLabels, "image/svg+xml");
        expect(doc.querySelectorAll("foreignObject")).toHaveLength(0);

        const withLabels = buildMind({ labels: [ "a label" ] });
        const flatSvg = `<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`;
        expect(postProcessExportedSvg(withLabels, flatSvg)).toBe(flatSvg);
    });
});

describe("renderMindMapPreviewSvg", () => {
    it("exports the map and injects the labels", async () => {
        const mind = buildMind({ labels: [ "arrow label" ] });

        const result = await renderMindMapPreviewSvg(mind);

        expect(result).toContain("topiclinks");
        expect(result).toContain("arrow label");
    });
});

/**
 * Non-regression tests against a real mind-elixir instance, guarding the internals the
 * label injection depends on (labels as `.svg-label` divs inside `mind.nodes`, the
 * nested-svg export structure). If these fail after a mind-elixir upgrade, re-verify
 * mind_map_export.ts against the new internals — see the module comment there.
 */
describe("renderMindMapPreviewSvg (real mind-elixir)", () => {
    function initRealMindMap(data: MindElixirData): MindElixirInstance {
        const el = document.createElement("div");
        document.body.appendChild(el);
        const mind = new MindElixir({ el });
        mind.init(data);
        return mind;
    }

    const MAP_WITH_LABELS: MindElixirData = {
        nodeData: {
            id: "root",
            topic: "Root topic",
            children: [
                { id: "a", topic: "Topic A", children: [] },
                { id: "b", topic: "Topic B", children: [] }
            ]
        },
        arrows: [
            {
                id: "arrow1",
                label: "my arrow label",
                from: "a",
                to: "b",
                delta1: { x: 50, y: -50 },
                delta2: { x: -50, y: 50 }
            }
        ],
        summaries: [
            { id: "sum1", label: "my summary label", parent: "root", start: 0, end: 1 }
        ]
    };

    it("renders arrow and summary labels as .svg-label elements inside mind.nodes", () => {
        const mind = initRealMindMap(MAP_WITH_LABELS);
        const labels = mind.nodes.querySelectorAll(".svg-label");

        expect(labels).toHaveLength(2);
        const labelTexts = Array.from(labels).map((label) => label.textContent);
        expect(labelTexts).toContain("my arrow label");
        expect(labelTexts).toContain("my summary label");
    });

    it("exportSvg() alone still misses the labels (the upstream gap we patch)", async () => {
        // If this starts failing, upstream fixed SSShooter/mind-elixir-core#359 and
        // injectSvgLabels may duplicate labels — re-evaluate whether it is still needed.
        const mind = initRealMindMap(MAP_WITH_LABELS);
        const rawExport = await mind.exportSvg().text();

        expect(rawExport).toContain("Topic A");
        expect(rawExport).not.toContain("my arrow label");
        expect(rawExport).not.toContain("my summary label");
    });

    it("the preview contains topics and both labels, and parses as valid SVG", async () => {
        const mind = initRealMindMap(MAP_WITH_LABELS);
        const result = await renderMindMapPreviewSvg(mind);

        const doc = new DOMParser().parseFromString(result, "image/svg+xml");
        expect(doc.querySelector("parsererror")).toBeNull();

        const expectedTexts = [
            "Root topic", "Topic A", "Topic B", "my arrow label", "my summary label"
        ];
        for (const text of expectedTexts) {
            expect(result).toContain(text);
        }

        // Both labels must land inside the inner (map layers) svg as foreignObjects.
        const innerSvg = doc.documentElement.querySelector(":scope > svg");
        const labelDivs = Array.from(innerSvg?.querySelectorAll("foreignObject > div") ?? [])
            .map((div) => div.textContent);
        expect(labelDivs).toContain("my arrow label");
        expect(labelDivs).toContain("my summary label");
    });

    it("XML-special characters in topics and labels survive export as valid SVG", async () => {
        const mind = initRealMindMap({
            nodeData: {
                id: "root",
                topic: "Both l & r <tags>",
                children: [
                    { id: "a", topic: "A", children: [] },
                    { id: "b", topic: "B", children: [] }
                ]
            },
            arrows: [
                {
                    id: "arrow1",
                    label: `label & <b>"quoted"</b>`,
                    from: "a",
                    to: "b",
                    delta1: { x: 50, y: -50 },
                    delta2: { x: -50, y: 50 }
                }
            ]
        });
        const result = await renderMindMapPreviewSvg(mind);

        const doc = new DOMParser().parseFromString(result, "image/svg+xml");
        expect(doc.querySelector("parsererror")).toBeNull();
        expect(result).toContain("Both l &amp; r");

        const labelDivs = Array.from(doc.querySelectorAll("foreignObject > div"))
            .map((div) => div.textContent);
        expect(labelDivs).toContain(`label & "quoted"`);
    });

    it("a map without arrows or summaries exports without label injection", async () => {
        const mind = initRealMindMap({
            nodeData: { id: "root", topic: "Just a root", children: [] }
        });
        const result = await renderMindMapPreviewSvg(mind);
        const rawExport = await mind.exportSvg().text();

        expect(result).toContain("Just a root");
        // Post-processing must not add foreignObjects beyond the exporter's own
        // (it only resizes them).
        const countForeignObjects = (svg: string) => new DOMParser()
            .parseFromString(svg, "image/svg+xml").querySelectorAll("foreignObject").length;
        expect(countForeignObjects(result)).toBe(countForeignObjects(rawExport));
    });
});
