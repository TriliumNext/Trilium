import type ForceGraph from "force-graph";
import { NoteMapLinkObject, NoteMapNodeObject, NotesAndRelationsData } from "./data";
import { LinkObject, NodeObject } from "force-graph";
import { generateColorFromString, MapType, NoteMapWidgetMode } from "./utils";
import { escapeHtml } from "../../services/utils";
import FNote from "../../entities/fnote";

export interface CssData {
    fontFamily: string;
    textColor: string;
    mutedTextColor: string;
}

interface RenderData {
    note: FNote;
    noteIdToSizeMap: Record<string, number>;
    cssData: CssData;
    noteId: string;
    themeStyle: "light" | "dark";
    widgetMode: NoteMapWidgetMode;
    notesAndRelations: NotesAndRelationsData;
    mapType: MapType;
}

export function setupRendering(graph: ForceGraph<NoteMapNodeObject, NoteMapLinkObject>, { note, noteId, themeStyle, widgetMode, noteIdToSizeMap, notesAndRelations, cssData, mapType }: RenderData) {
    // variables for the hover effect. We have to save the neighbours of a hovered node in a set. Also we need to save the links as well as the hovered node itself
    const neighbours = new Set();
    const highlightLinks = new Set();
    let hoverNode: NodeObject | null = null;
    let zoomLevel: number;

    function getColorForNode(node: NoteMapNodeObject) {
        if (node.color) {
            return node.color;
        } else if (widgetMode === "ribbon" && node.id === noteId) {
            return "red"; // subtree root mark as red
        } else {
            return generateColorFromString(node.type, themeStyle);
        }
    }

    function paintNode(node: NoteMapNodeObject, color: string, ctx: CanvasRenderingContext2D) {
        const { x, y } = node;
        if (!x || !y) {
            return;
        }
        const size = noteIdToSizeMap[node.id];

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, size * 0.8, 0, 2 * Math.PI, false);
        ctx.fill();

        const toRender = zoomLevel > 2 || (zoomLevel > 1 && size > 6) || (zoomLevel > 0.3 && size > 10);

        if (!toRender) {
            return;
        }

        ctx.fillStyle = cssData.textColor;
        ctx.font = `${size}px ${cssData.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        let title = node.name;

        if (title.length > 15) {
            title = `${title.substr(0, 15)}...`;
        }

        ctx.fillText(title, x, y + Math.round(size * 1.5));
    }


    function paintLink(link: NoteMapLinkObject, ctx: CanvasRenderingContext2D) {
        if (zoomLevel < 5) {
            return;
        }

        ctx.font = `3px ${cssData.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = cssData.mutedTextColor;

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

    // main code for highlighting hovered nodes and neighbours. here we "style" the nodes. the nodes are rendered several hundred times per second.
    graph
        .d3AlphaDecay(0.01)
        .d3VelocityDecay(0.08)
        .maxZoom(7)
        .warmupTicks(30)
        .nodeCanvasObject((node, ctx) => {
            if (hoverNode == node) {
                //paint only hovered node
                paintNode(node, "#661822", ctx);
                neighbours.clear(); //clearing neighbours or the effect would be maintained after hovering is over
                for (const link of notesAndRelations.links) {
                    const { source, target } = link;
                    if (typeof source !== "object" || typeof target !== "object") continue;

                    //check if node is part of a link in the canvas, if so add it´s neighbours and related links to the previous defined variables to paint the nodes
                    if (source.id == node.id || target.id == node.id) {
                        neighbours.add(link.source);
                        neighbours.add(link.target);
                        highlightLinks.add(link);
                        neighbours.delete(node);
                    }
                }
            } else if (neighbours.has(node) && hoverNode != null) {
                //paint neighbours
                paintNode(node, "#9d6363", ctx);
            } else {
                paintNode(node, getColorForNode(node), ctx); //paint rest of nodes in canvas
            }
        })
        //check if hovered and set the hovernode variable, saving the hovered node object into it. Clear links variable everytime you hover. Without clearing links will stay highlighted
        .onNodeHover((node) => {
            hoverNode = node || null;
            highlightLinks.clear();
        })
        .nodePointerAreaPaint((node, _, ctx) => paintNode(node, getColorForNode(node), ctx))
        .nodePointerAreaPaint((node, color, ctx) => {
            if (!node.id) {
                return;
            }

            ctx.fillStyle = color;
            ctx.beginPath();
            if (node.x && node.y) {
                ctx.arc(node.x, node.y, noteIdToSizeMap[node.id], 0, 2 * Math.PI, false);
            }
            ctx.fill();
        })
        .nodeLabel((node) => escapeHtml(node.name))
        .onZoom((zoom) => zoomLevel = zoom.k);

    // set link width to immitate a highlight effect. Checking the condition if any links are saved in the previous defined set highlightlinks
    graph
        .linkWidth((link) => (highlightLinks.has(link) ? 3 : 0.4))
        .linkColor((link) => (highlightLinks.has(link) ? cssData.textColor : cssData.mutedTextColor))
        .linkDirectionalArrowLength(4)
        .linkDirectionalArrowRelPos(0.95);

    // Link-specific config
    if (mapType) {
        graph
            .linkLabel((link) => {
                const { source, target } = link;
                if (typeof source !== "object" || typeof target !== "object") return escapeHtml(link.name);
                return `${escapeHtml(source.name)} - <strong>${escapeHtml(link.name)}</strong> - ${escapeHtml(target.name)}`;
            })
            .linkCanvasObject((link, ctx) => paintLink(link, ctx))
            .linkCanvasObjectMode(() => "after");
    }

    // Forces
    const nodeLinkRatio = notesAndRelations.nodes.length / notesAndRelations.links.length;
    const magnifiedRatio = Math.pow(nodeLinkRatio, 1.5);
    const charge = -20 / magnifiedRatio;
    const boundedCharge = Math.min(-3, charge);
    graph.d3Force("center")?.strength(0.2);
    graph.d3Force("charge")?.strength(boundedCharge);
    graph.d3Force("charge")?.distanceMax(1000);

    // Zoom to notes
    if (widgetMode === "ribbon" && note?.type !== "search") {
        setTimeout(() => {
            const subGraphNoteIds = getSubGraphConnectedToCurrentNote(noteId, notesAndRelations);

            graph.zoomToFit(400, 50, (node) => subGraphNoteIds.has(node.id));

            if (subGraphNoteIds.size < 30) {
                graph.d3VelocityDecay(0.4);
            }
        }, 1000);
    } else {
        if (notesAndRelations.nodes.length > 1) {
            setTimeout(() => {
                const noteIdsWithLinks = getNoteIdsWithLinks(notesAndRelations);

                if (noteIdsWithLinks.size > 0) {
                    graph.zoomToFit(400, 30, (node) => noteIdsWithLinks.has(node.id ?? ""));
                }

                if (noteIdsWithLinks.size < 30) {
                    graph.d3VelocityDecay(0.4);
                }
            }, 1000);
        }
    }
}

function getNoteIdsWithLinks(data: NotesAndRelationsData) {
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

function getSubGraphConnectedToCurrentNote(noteId: string, data: NotesAndRelationsData) {
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

    traverseGraph(noteId);
    return subGraphNoteIds;
}
