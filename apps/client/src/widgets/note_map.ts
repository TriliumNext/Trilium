import server from "../services/server.js";
import attributeService from "../services/attributes.js";
import hoistedNoteService from "../services/hoisted_note.js";
import appContext, { type EventData } from "../components/app_context.js";
import NoteContextAwareWidget from "./note_context_aware_widget.js";
import linkContextMenuService from "../menus/link_context_menu.js";
import utils from "../services/utils.js";
import { t } from "../services/i18n.js";
import type ForceGraph from "force-graph";
import type { GraphData, LinkObject, NodeObject } from "force-graph";
import type FNote from "../entities/fnote.js";

const esc = utils.escapeHtml;

const TPL = /*html*/`<div class="note-map-widget">
    <style>
        .note-detail-note-map {
            height: 100%;
            overflow: hidden;
        }

        /* Style Ui Element to Drag Nodes */
        .fixnodes-type-switcher {
            display: flex;
            align-items: center;
            z-index: 10; /* should be below dropdown (note actions) */
            border-radius: .2rem;
        }

        .fixnodes-type-switcher button.toggled {
            background: var(--active-item-background-color);
            color: var(--active-item-text-color);
        }

        /* Start of styling the slider */
        .fixnodes-type-switcher input[type="range"] {

            /* removing default appearance */
            -webkit-appearance: none;
            appearance: none;
            margin-left: 15px;
            width: 150px;
        }

        /* Changing slider tracker */
        .fixnodes-type-switcher input[type="range"]::-webkit-slider-runnable-track {
            height: 4px;
            background-color: var(--main-border-color);
            border-radius: 4px;
        }

        /* Changing Slider Thumb */
        .fixnodes-type-switcher input[type="range"]::-webkit-slider-thumb {
            /* removing default appearance */
            -webkit-appearance: none;
            appearance: none;
            /* creating a custom design */
            height: 15px;
            width: 15px;
            margin-top:-5px;
            background-color: var(--accented-background-color);
            border: 1px solid var(--main-text-color);
            border-radius: 50%;
        }

        .fixnodes-type-switcher input[type="range"]::-moz-range-track {
            background-color: var(--main-border-color);
            border-radius: 4px;
        }

        .fixnodes-type-switcher input[type="range"]::-moz-range-thumb {
            background-color: var(--accented-background-color);
            border-color: var(--main-text-color);
            height: 10px;
            width: 10px;
        }

        /* End of styling the slider */

    </style>

    <div class="btn-group btn-group-sm map-type-switcher content-floating-buttons top-left" role="group">
      <button type="button" class="btn bx bx-network-chart tn-tool-button" title="${t("note-map.button-link-map")}" data-type="link"></button>
      <button type="button" class="btn bx bx-sitemap tn-tool-button" title="${t("note-map.button-tree-map")}" data-type="tree"></button>
    </div>

    <! UI for dragging Notes and link force >

    <div class="btn-group-sm fixnodes-type-switcher content-floating-buttons bottom-left" role="group">
      <button type="button" data-toggle="button" class="btn bx bx-lock-alt tn-tool-button" title="${t("note_map.fix-nodes")}" data-type="moveable"></button>
      <input type="range" class="slider" min="1" title="${t("note_map.link-distance")}" max="100" value="40" >
    </div>

    <div class="style-resolver"></div>

    <div class="note-map-container"></div>
</div>`;

type WidgetMode = "type" | "ribbon";
type MapType = "tree" | "link";
type Data = GraphData<NodeObject, LinkObject<NodeObject>>;

interface Node extends NodeObject {
    id: string;
    name: string;
    type: string;
    color: string;
}

interface Link extends LinkObject<NodeObject> {
    id: string;
    name: string;

    x: number;
    y: number;
    source: Node;
    target: Node;
}

interface NotesAndRelationsData {
    nodes: Node[];
    links: {
        id: string;
        source: string;
        target: string;
        name: string;
    }[];
}

// Replace
interface ResponseLink {
    key: string;
    sourceNoteId: string;
    targetNoteId: string;
    name: string;
}

interface PostNotesMapResponse {
    notes: string[];
    links: ResponseLink[];
    noteIdToDescendantCountMap: Record<string, number>;
}

interface GroupedLink {
    id: string;
    sourceNoteId: string;
    targetNoteId: string;
    names: string[];
}

interface CssData {
    fontFamily: string;
    textColor: string;
    mutedTextColor: string;
}

export default class NoteMapWidget extends NoteContextAwareWidget {

    private fixNodes: boolean;
    private widgetMode: WidgetMode;
    private mapType?: MapType;
    private cssData!: CssData;

    private themeStyle!: string;
    private $container!: JQuery<HTMLElement>;
    private $styleResolver!: JQuery<HTMLElement>;
    private $fixNodesButton!: JQuery<HTMLElement>;
    graph!: ForceGraph;
    private noteIdToSizeMap!: Record<string, number>;
    private zoomLevel!: number;
    private nodes!: Node[];

    constructor(widgetMode: WidgetMode) {
        super();
        this.fixNodes = false; // needed to save the status of the UI element. Is set later in the code
        this.widgetMode = widgetMode; // 'type' or 'ribbon'
    }

    doRender() {
        this.$widget = $(TPL);

        const documentStyle = window.getComputedStyle(document.documentElement);
        this.themeStyle = documentStyle.getPropertyValue("--theme-style")?.trim();

        this.$container = this.$widget.find(".note-map-container");
        this.$styleResolver = this.$widget.find(".style-resolver");
        this.$fixNodesButton = this.$widget.find(".fixnodes-type-switcher > button");

        new ResizeObserver(() => this.setDimensions()).observe(this.$container[0]);

        this.$widget.find(".map-type-switcher button").on("click", async (e) => {
            const type = $(e.target).closest("button").attr("data-type");

            await attributeService.setLabel(this.noteId ?? "", "mapType", type);
        });

        // Reading the status of the Drag nodes Ui element. Changing it´s color when activated.
        // Reading Force value of the link distance.
        this.$fixNodesButton.on("click", async (event) => {
            this.fixNodes = !this.fixNodes;
            this.$fixNodesButton.toggleClass("toggled", this.fixNodes);
        });

        super.doRender();
    }

    setDimensions() {
        if (!this.graph) {
            // no graph has been even rendered
            return;
        }

        const $parent = this.$widget.parent();

        this.graph
            .height($parent.height() || 0)
            .width($parent.width() || 0);
    }

    async refreshWithNote(note: FNote) {
        this.$widget.show();

        this.cssData = {
            fontFamily: this.$container.css("font-family"),
            textColor: this.rgb2hex(this.$container.css("color")),
            mutedTextColor: this.rgb2hex(this.$styleResolver.css("color"))
        };

        this.mapType = note.getLabelValue("mapType") === "tree" ? "tree" : "link";

        //variables for the hover effekt. We have to save the neighbours of a hovered node in a set. Also we need to save the links as well as the hovered node itself

        let hoverNode: NodeObject | null = null;
        const highlightLinks = new Set();
        const neighbours = new Set();

        const ForceGraph = (await import("force-graph")).default;
        this.graph = new ForceGraph(this.$container[0])
            .width(this.$container.width() || 0)
            .height(this.$container.height() || 0)
            .onZoom((zoom) => this.setZoomLevel(zoom.k))
            .d3AlphaDecay(0.01)
            .d3VelocityDecay(0.08)

            //Code to fixate nodes when dragged
            .onNodeDragEnd((node) => {
                if (this.fixNodes) {
                    node.fx = node.x;
                    node.fy = node.y;
                } else {
                    node.fx = undefined;
                    node.fy = undefined;
                }
            })
            //check if hovered and set the hovernode variable, saving the hovered node object into it. Clear links variable everytime you hover. Without clearing links will stay highlighted
            .onNodeHover((node) => {
                hoverNode = node || null;
                highlightLinks.clear();
            })

            // set link width to immitate a highlight effekt. Checking the condition if any links are saved in the previous defined set highlightlinks
            .linkWidth((link) => (highlightLinks.has(link) ? 3 : 0.4))
            .linkColor((link) => (highlightLinks.has(link) ? "white" : this.cssData.mutedTextColor))
            .linkDirectionalArrowLength(4)
            .linkDirectionalArrowRelPos(0.95)

            // main code for highlighting hovered nodes and neighbours. here we "style" the nodes. the nodes are rendered several hundred times per second.
            .nodeCanvasObject((_node, ctx) => {
                const node = _node as Node;
                if (hoverNode == node) {
                    //paint only hovered node
                    this.paintNode(node, "#661822", ctx);
                    neighbours.clear(); //clearing neighbours or the effect would be maintained after hovering is over
                    for (const _link of data.links) {
                        const link = _link as unknown as Link;
                        //check if node is part of a link in the canvas, if so add it´s neighbours and related links to the previous defined variables to paint the nodes
                        if (link.source.id == node.id || link.target.id == node.id) {
                            neighbours.add(link.source);
                            neighbours.add(link.target);
                            highlightLinks.add(link);
                            neighbours.delete(node);
                        }
                    }
                } else if (neighbours.has(node) && hoverNode != null) {
                    //paint neighbours
                    this.paintNode(node, "#9d6363", ctx);
                } else {
                    this.paintNode(node, this.getColorForNode(node), ctx); //paint rest of nodes in canvas
                }
            })

            .nodePointerAreaPaint((node, _, ctx) => this.paintNode(node as Node, this.getColorForNode(node as Node), ctx))
            .nodePointerAreaPaint((node, color, ctx) => {
                if (!node.id) {
                    return;
                }

                ctx.fillStyle = color;
                ctx.beginPath();
                if (node.x && node.y) {
                    ctx.arc(node.x, node.y, this.noteIdToSizeMap[node.id], 0, 2 * Math.PI, false);
                }
                ctx.fill();
            })
            .nodeLabel((node) => esc((node as Node).name))
            .maxZoom(7)
            .warmupTicks(30)
            .onNodeClick((node) => {
                if (node.id) {
                    appContext.tabManager.getActiveContext()?.setNote((node as Node).id);
                }
            })
            .onNodeRightClick((node, e) => {
                if (node.id) {
                    linkContextMenuService.openContextMenu((node as Node).id, e);
                }
            });

        if (this.mapType === "link") {
            this.graph
                .linkLabel((l) => `${esc((l as Link).source.name)} - <strong>${esc((l as Link).name)}</strong> - ${esc((l as Link).target.name)}`)
                .linkCanvasObject((link, ctx) => this.paintLink(link as Link, ctx))
                .linkCanvasObjectMode(() => "after");
        }

        const mapRootNoteId = this.getMapRootNoteId();

        const labelValues = (name: string) => this.note?.getLabels(name).map(l => l.value) ?? [];

        const excludeRelations = labelValues("mapExcludeRelation");
        const includeRelations = labelValues("mapIncludeRelation");

        const data = await this.loadNotesAndRelations(mapRootNoteId, excludeRelations, includeRelations);

        const nodeLinkRatio = data.nodes.length / data.links.length;
        const magnifiedRatio = Math.pow(nodeLinkRatio, 1.5);
        const charge = -20 / magnifiedRatio;
        const boundedCharge = Math.min(-3, charge);
        let distancevalue = 40; // default value for the link force of the nodes

        this.$widget.find(".fixnodes-type-switcher input").on("change", async (e) => {
            distancevalue = parseInt(e.target.closest("input")?.value ?? "0");
            this.graph.d3Force("link")?.distance(distancevalue);

            this.renderData(data);
        });

        this.graph.d3Force("center")?.strength(0.2);
        this.graph.d3Force("charge")?.strength(boundedCharge);
        this.graph.d3Force("charge")?.distanceMax(1000);

        this.renderData(data);
    }

    getMapRootNoteId(): string {
        if (this.noteId && this.widgetMode === "ribbon") {
            return this.noteId;
        }

        let mapRootNoteId = this.note?.getLabelValue("mapRootNoteId");

        if (mapRootNoteId === "hoisted") {
            mapRootNoteId = hoistedNoteService.getHoistedNoteId();
        } else if (!mapRootNoteId) {
            mapRootNoteId = appContext.tabManager.getActiveContext()?.parentNoteId;
        }

        return mapRootNoteId ?? "";
    }

    getColorForNode(node: Node) {
        if (node.color) {
            return node.color;
        } else if (this.widgetMode === "ribbon" && node.id === this.noteId) {
            return "red"; // subtree root mark as red
        } else {
            return this.generateColorFromString(node.type);
        }
    }

    generateColorFromString(str: string) {
        if (this.themeStyle === "dark") {
            str = `0${str}`; // magic lightning modifier
        }

        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }

        let color = "#";
        for (let i = 0; i < 3; i++) {
            const value = (hash >> (i * 8)) & 0xff;

            color += `00${value.toString(16)}`.substr(-2);
        }
        return color;
    }

    rgb2hex(rgb: string) {
        return `#${(rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/) || [])
            .slice(1)
            .map((n) => parseInt(n, 10).toString(16).padStart(2, "0"))
            .join("")}`;
    }

    setZoomLevel(level: number) {
        this.zoomLevel = level;
    }

    paintNode(node: Node, color: string, ctx: CanvasRenderingContext2D) {
        const { x, y } = node;
        if (!x || !y) {
            return;
        }
        const size = this.noteIdToSizeMap[node.id];

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, size * 0.8, 0, 2 * Math.PI, false);
        ctx.fill();

        const toRender = this.zoomLevel > 2 || (this.zoomLevel > 1 && size > 6) || (this.zoomLevel > 0.3 && size > 10);

        if (!toRender) {
            return;
        }

        ctx.fillStyle = this.cssData.textColor;
        ctx.font = `${size}px ${this.cssData.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        let title = node.name;

        if (title.length > 15) {
            title = `${title.substr(0, 15)}...`;
        }

        ctx.fillText(title, x, y + Math.round(size * 1.5));
    }

    paintLink(link: Link, ctx: CanvasRenderingContext2D) {
        if (this.zoomLevel < 5) {
            return;
        }

        ctx.font = `3px ${this.cssData.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = this.cssData.mutedTextColor;

        const { source, target } = link;
        if (typeof source !== "object" || typeof target !== "object") {
            return;
        }

        if (source.x && source.y && target.x && target.y) {
            const x = (source.x + target.x) / 2;
            const y = (source.y + target.y) / 2;
            ctx.save();
            ctx.translate(x, y);

            const deltaY = source.y - target.y;
            const deltaX = source.x - target.x;

            let angle = Math.atan2(deltaY, deltaX);
            let moveY = 2;

            if (angle < -Math.PI / 2 || angle > Math.PI / 2) {
                angle += Math.PI;
                moveY = -2;
            }

            ctx.rotate(angle);
            ctx.fillText(link.name, 0, moveY);
        }

        ctx.restore();
    }

    async loadNotesAndRelations(mapRootNoteId: string, excludeRelations: string[], includeRelations: string[]): Promise<NotesAndRelationsData> {
        const resp = await server.post<PostNotesMapResponse>(`note-map/${mapRootNoteId}/${this.mapType}`, {
            excludeRelations, includeRelations
        });

        this.calculateNodeSizes(resp);

        const links = this.getGroupedLinks(resp.links);

        this.nodes = resp.notes.map(([noteId, title, type, color]) => ({
            id: noteId,
            name: title,
            type: type,
            color: color
        }));

        return {
            nodes: this.nodes,
            links: links.map((link) => ({
                id: `${link.sourceNoteId}-${link.targetNoteId}`,
                source: link.sourceNoteId,
                target: link.targetNoteId,
                name: link.names.join(", ")
            }))
        };
    }

    getGroupedLinks(links: ResponseLink[]): GroupedLink[] {
        const linksGroupedBySourceTarget: Record<string, GroupedLink> = {};

        for (const link of links) {
            const key = `${link.sourceNoteId}-${link.targetNoteId}`;

            if (key in linksGroupedBySourceTarget) {
                if (!linksGroupedBySourceTarget[key].names.includes(link.name)) {
                    linksGroupedBySourceTarget[key].names.push(link.name);
                }
            } else {
                linksGroupedBySourceTarget[key] = {
                    id: key,
                    sourceNoteId: link.sourceNoteId,
                    targetNoteId: link.targetNoteId,
                    names: [link.name]
                };
            }
        }

        return Object.values(linksGroupedBySourceTarget);
    }

    calculateNodeSizes(resp: PostNotesMapResponse) {
        this.noteIdToSizeMap = {};

        if (this.mapType === "tree") {
            const { noteIdToDescendantCountMap } = resp;

            for (const noteId in noteIdToDescendantCountMap) {
                this.noteIdToSizeMap[noteId] = 4;

                const count = noteIdToDescendantCountMap[noteId];

                if (count > 0) {
                    this.noteIdToSizeMap[noteId] += 1 + Math.round(Math.log(count) / Math.log(1.5));
                }
            }
        } else if (this.mapType === "link") {
            const noteIdToLinkCount: Record<string, number> = {};

            for (const link of resp.links) {
                noteIdToLinkCount[link.targetNoteId] = 1 + (noteIdToLinkCount[link.targetNoteId] || 0);
            }

            for (const [noteId] of resp.notes) {
                this.noteIdToSizeMap[noteId] = 4;

                if (noteId in noteIdToLinkCount) {
                    this.noteIdToSizeMap[noteId] += Math.min(Math.pow(noteIdToLinkCount[noteId], 0.5), 15);
                }
            }
        }
    }

    renderData(data: Data) {
        this.graph.graphData(data);

        if (this.widgetMode === "ribbon" && this.note?.type !== "search") {
            setTimeout(() => {
                this.setDimensions();

                const subGraphNoteIds = this.getSubGraphConnectedToCurrentNote(data);

                this.graph.zoomToFit(400, 50, (node) => subGraphNoteIds.has(node.id));

                if (subGraphNoteIds.size < 30) {
                    this.graph.d3VelocityDecay(0.4);
                }
            }, 1000);
        } else {
            if (data.nodes.length > 1) {
                setTimeout(() => {
                    this.setDimensions();

                    const noteIdsWithLinks = this.getNoteIdsWithLinks(data);

                    if (noteIdsWithLinks.size > 0) {
                        this.graph.zoomToFit(400, 30, (node) => noteIdsWithLinks.has(node.id ?? ""));
                    }

                    if (noteIdsWithLinks.size < 30) {
                        this.graph.d3VelocityDecay(0.4);
                    }
                }, 1000);
            }
        }
    }

    getNoteIdsWithLinks(data: Data) {
        const noteIds = new Set<string | number>();

        for (const link of data.links) {
            if (typeof link.source === "object" && link.source.id) {
                noteIds.add(link.source.id);
            }
            if (typeof link.target === "object" && link.target.id) {
                noteIds.add(link.target.id);
            }
        }

        return noteIds;
    }

    getSubGraphConnectedToCurrentNote(data: Data) {
        function getGroupedLinks(links: LinkObject<NodeObject>[], type: "source" | "target") {
            const map: Record<string | number, LinkObject<NodeObject>[]> = {};

            for (const link of links) {
                if (typeof link[type] !== "object") {
                    continue;
                }

                const key = link[type].id;
                if (key) {
                    map[key] = map[key] || [];
                    map[key].push(link);
                }
            }

            return map;
        }

        const linksBySource = getGroupedLinks(data.links, "source");
        const linksByTarget = getGroupedLinks(data.links, "target");

        const subGraphNoteIds = new Set();

        function traverseGraph(noteId?: string | number) {
            if (!noteId || subGraphNoteIds.has(noteId)) {
                return;
            }

            subGraphNoteIds.add(noteId);

            for (const link of linksBySource[noteId] || []) {
                if (typeof link.target === "object") {
                    traverseGraph(link.target?.id);
                }
            }

            for (const link of linksByTarget[noteId] || []) {
                if (typeof link.source === "object") {
                    traverseGraph(link.source?.id);
                }
            }
        }

        traverseGraph(this.noteId);
        return subGraphNoteIds;
    }

    cleanup() {
        this.$container.html("");
    }

    entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        if (loadResults.getAttributeRows(this.componentId)
                .find((attr) => attr.type === "label" && ["mapType", "mapRootNoteId"].includes(attr.name || "") && attributeService.isAffecting(attr, this.note))) {
            this.refresh();
        }
    }
}
