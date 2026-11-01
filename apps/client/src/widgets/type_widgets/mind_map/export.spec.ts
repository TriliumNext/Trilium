// @vitest-environment jsdom
// The label injection relies on sanitizeNoteContentHtml (DOMPurify), which happy-dom
// breaks (NodeIterator mishandling — see sanitize_content.spec.ts). jsdom matches
// real-browser behavior.
import MindElixir, { type MindElixirData, type MindElixirInstance } from "mind-elixir";
import { describe, expect, it, vi } from "vitest";

import { inlineExportedImages, postProcessExportedSvg, renderMindMapPreviewSvg } from "./export";

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

function buildMind({ labels = [] as string[], exportedSvg = buildExportedSvg(), canvasColor = "#252526" } = {}) {
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
        theme: { cssVar: { "--bgcolor": canvasColor } },
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

    it("backs only translucent node boxes with the canvas color, keeping their geometry", () => {
        // The exporter draws the lines first and the node boxes over them, so a tinted box would
        // otherwise show the branch lines through the node.
        const exportedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="400px" height="300px">` +
            `<rect x="0" y="0" width="400" height="300" fill="#fff"/>` +
            `<svg x="100" y="100" overflow="visible"><g class="lines"></g>` +
            `<rect x="1" y="2" width="30" height="10" rx="3px" fill="rgba(229, 230, 77, 0.251)"/>` +
            `<rect x="5" y="6" width="30" height="10" fill="rgb(45, 55, 72)"/>` +
            `<rect x="7" y="8" width="30" height="10" fill="rgba(0, 0, 0, 0)"/>` +
            `</svg></svg>`;
        const result = postProcessExportedSvg(buildMind({ canvasColor: "#252526" }), exportedSvg);

        const doc = new DOMParser().parseFromString(result, "image/svg+xml");
        const innerSvg = doc.documentElement.querySelector(":scope > svg");
        const boxes = Array.from(innerSvg?.querySelectorAll(":scope > rect") ?? []);
        expect(boxes.map((box) => box.getAttribute("fill"))).toEqual([
            // The backing sits right below the tinted box; the opaque and the fully transparent
            // boxes are left alone.
            "#252526", "rgba(229, 230, 77, 0.251)", "rgb(45, 55, 72)", "rgba(0, 0, 0, 0)"
        ]);
        for (const attribute of [ "x", "y", "width", "height", "rx" ]) {
            expect(boxes[0].getAttribute(attribute)).toBe(boxes[1].getAttribute(attribute));
        }
    });

    it("tells each exported picture what to do with a box that is not its shape", () => {
        // The exporter writes the box and the address alone, so a picture cut to a square on the
        // map would be drawn whole and squashed into it here.
        const mind = buildMind();
        for (const objectFit of [ "cover", "contain", "" ]) {
            const drawn = document.createElement("img");
            drawn.style.objectFit = objectFit;
            mind.nodes.appendChild(drawn);
        }

        const exportedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="400px" height="300px">` +
            `<svg x="100" y="100" overflow="visible">` +
            `<image width="240px" height="240px" href="a.png"/>` +
            `<image width="240px" height="240px" href="b.png"/>` +
            `<image width="240px" height="180px" href="c.png"/>` +
            `</svg></svg>`;
        const result = postProcessExportedSvg(mind, exportedSvg);

        const doc = new DOMParser().parseFromString(result, "image/svg+xml");
        expect(Array.from(doc.querySelectorAll("image")).map((image) => image.getAttribute("preserveAspectRatio")))
            // The last is drawn with no fit of its own, which stretches it to its box — the shape
            // of the picture, as it happens, so nothing comes of it.
            .toEqual([ "xMidYMid slice", "xMidYMid meet", "none" ]);
    });

    it("says nothing of the fit where the pictures of the map and of the export do not line up", () => {
        const mind = buildMind();
        mind.nodes.appendChild(document.createElement("img"));

        const exportedSvg = `<svg xmlns="http://www.w3.org/2000/svg"><svg><image href="a.png"/>` +
            `<image href="b.png"/></svg></svg>`;
        const result = postProcessExportedSvg(mind, exportedSvg);

        const doc = new DOMParser().parseFromString(result, "image/svg+xml");
        expect(doc.querySelector("image")?.hasAttribute("preserveAspectRatio")).toBe(false);
    });

    it("writes each icon drawing once and stamps it out wherever it is worn", () => {
        // The same icon on two nodes and another on a third: a drawing carried as text is the
        // heaviest thing in the file, so it is written once and pointed at twice.
        const star = "data:image/png;base64,STAR";
        const icons = [
            { x: 10, y: 20, size: 16, color: "rgb(20, 20, 20)", image: star },
            { x: 30, y: 40, size: 16, color: "rgb(20, 20, 20)", image: star },
            { x: 50, y: 60, size: 12, color: "rgb(20, 20, 20)", image: "data:image/png;base64,CUBE" }
        ];

        const result = postProcessExportedSvg(buildMind(), buildExportedSvg(), icons);

        const doc = new DOMParser().parseFromString(result, "image/svg+xml");
        const innerSvg = doc.documentElement.querySelector(":scope > svg");
        const symbols = Array.from(innerSvg?.querySelectorAll("defs > symbol") ?? []);
        expect(symbols.map((symbol) => symbol.querySelector("image")?.getAttribute("href")))
            .toEqual([ star, "data:image/png;base64,CUBE" ]);

        const uses = Array.from(innerSvg?.querySelectorAll(":scope > use") ?? []);
        expect(uses.map((use) => [ use.getAttribute("href"), use.getAttribute("x"), use.getAttribute("width") ]))
            .toEqual([
                [ `#${symbols[0].id}`, "10", "16" ],
                [ `#${symbols[0].id}`, "30", "16" ],
                [ `#${symbols[1].id}`, "50", "12" ]
            ]);
        // The older spelling of the reference alongside the newer one, for whatever needs it.
        expect(uses[0].getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe(`#${symbols[0].id}`);
        // Only the drawings go in the defs, and every drawing is written inside the map layers.
        expect(doc.documentElement.querySelectorAll(":scope > use, :scope > defs")).toHaveLength(0);
    });

    it("writes an icon that is a character as the character, centred on its square", () => {
        const icons = [ { x: 10, y: 20, size: 16, color: "rgb(20, 20, 20)", text: "⭐" } ];

        const result = postProcessExportedSvg(buildMind(), buildExportedSvg(), icons);

        const doc = new DOMParser().parseFromString(result, "image/svg+xml");
        const text = doc.querySelector("text");
        expect(text?.textContent).toBe("⭐");
        expect([ text?.getAttribute("x"), text?.getAttribute("y"), text?.getAttribute("dy") ])
            .toEqual([ "18", "28", "0.35em" ]);
        expect(text?.getAttribute("text-anchor")).toBe("middle");
        expect(text?.getAttribute("fill")).toBe("rgb(20, 20, 20)");
        // Nothing is drawn for it, so it costs the file no drawing.
        expect(doc.querySelectorAll("defs")).toHaveLength(0);
    });

    it("leaves the pictures of the map paired with those of the export when it writes icons in", () => {
        // The fit is carried over by counting the two against each other, which an icon written in
        // beforehand would throw off — and quietly, the pairing simply being abandoned.
        const mind = buildMind();
        const drawn = document.createElement("img");
        drawn.style.objectFit = "cover";
        mind.nodes.appendChild(drawn);

        const exportedSvg = `<svg xmlns="http://www.w3.org/2000/svg"><svg>` +
            `<image width="240px" height="240px" href="a.png"/></svg></svg>`;
        const icons = [ { x: 1, y: 2, size: 16, color: "black", image: "data:image/png;base64,STAR" } ];
        const result = postProcessExportedSvg(mind, exportedSvg, icons);

        const doc = new DOMParser().parseFromString(result, "image/svg+xml");
        const picture = Array.from(doc.querySelectorAll("image")).find((image) => image.getAttribute("href") === "a.png");
        expect(picture?.getAttribute("preserveAspectRatio")).toBe("xMidYMid slice");
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

describe("inlineExportedImages", () => {
    /** An export holding the pictures of three nodes, one of them already carried inside it. */
    function buildExportWithImages() {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="400px" height="300px">` +
            `<svg x="100" y="100" overflow="visible">` +
            `<image x="0" y="0" width="240px" height="180px" href="api/attachments/att1/image/a.png"/>` +
            `<image x="0" y="0" width="120px" height="90px" href="https://elsewhere.example/b.png"/>` +
            `<image x="0" y="0" width="60px" height="45px" href="data:image/webp;base64,already"/>` +
            `</svg></svg>`;
    }

    function imageHrefs(svgText: string) {
        const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
        return Array.from(doc.querySelectorAll("image")).map((image) => image.getAttribute("href"));
    }

    it("carries in every picture it can load, at the width it is drawn at", async () => {
        // The picture of another site cannot be read back, and one already carried is not fetched.
        const load = vi.fn(async (url: string) => (url.startsWith("api/") ? "data:image/webp;base64,carried" : null));

        const result = await inlineExportedImages(buildExportWithImages(), load);

        expect(imageHrefs(result)).toEqual([
            "data:image/webp;base64,carried",
            "https://elsewhere.example/b.png",
            "data:image/webp;base64,already"
        ]);
        expect(load.mock.calls).toEqual([
            [ "api/attachments/att1/image/a.png", 240 ],
            [ "https://elsewhere.example/b.png", 120 ]
        ]);
    });

    it("hands back what it was given when there is nothing to carry in", async () => {
        const load = vi.fn(async () => "data:image/webp;base64,carried");
        const svgText = buildExportedSvg();

        expect(await inlineExportedImages(svgText, load)).toBe(svgText);
        expect(load).not.toHaveBeenCalled();
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
 * export.ts against the new internals — see the module comment there.
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
