import type ForceGraph from "force-graph";

import type FNote from "../../entities/fnote";
import type { IconGlyph } from "../../services/icon_glyphs";
import { escapeHtml } from "../../services/utils";
import { NoteMapLinkObject, NoteMapNodeObject, NotesAndRelationsData } from "./data";
import { getFitPadding, getHopDistances, isRootedAtCurrentNote, mixColors, NoteMapWidgetMode, withAlpha } from "./utils";

/** Roughly a second of simulation at 60 fps — see {@link setupFraming}. */
const TICKS_UNTIL_DAMPED = 60;

/** What a map of a single note is shown at, there being no extent to fit — see {@link setupFraming}. */
const LONE_NOTE_ZOOM = 4;

/** How large a note's dot has to come out on screen, in pixels, before its icon is drawn inside it. */
const MIN_ICON_RADIUS = 7;

/**
 * How wide a note's dot is drawn, as a part of the size the graph holds it at. The graph measures the
 * room a note takes up by that size, and the dot is drawn a little inside it so that the notes of a
 * crowded map are not laid edge to edge.
 */
const NODE_RADIUS_RATIO = 0.8;

/** Above how many framed notes a map is left to settle at its own pace — see {@link setupFraming}. */
const DAMPING_MAX_NOTES = 30;

/** How thick the ring around the note the map is drawn around is on screen. */
const ANCHOR_RING_PX = 2;

/** How much is left of what the pointer is not resting on, while it rests on a note of the map. */
const DIMMED_ALPHA = 0.15;

/** How long the map takes to answer the pointer coming to rest on a note, or leaving one. */
const HOVER_FADE_MS = 160;

/** What a relation is drawn with, and what one of the hovered note's own grows to. */
const LINK_WIDTH = 0.4;
const HIGHLIGHT_LINK_WIDTH = 3;

/** How long a relation's arrowhead is drawn on screen — see {@link paintArrow} for the shape of it. */
const ARROW_LENGTH_PX = 10;

/** How wide it is across the tail, as a part of that length. */
const ARROW_WIDTH_RATIO = 0.72;

/** How far the middle of its tail is swept back in, as a part of that length. */
const ARROW_SWEEP = 0.28;

/**
 * How much of that length each of its corners is rounded off by. Kept well under a quarter: a corner
 * as sharp as the tip reaches back along both its edges by several times this, and rounding one by
 * more than the edges leading to it can give takes the shape apart.
 */
const ARROW_ROUNDING = 0.12;

/** How large a note's label is drawn on screen where the map is neither zoomed in nor out. */
const LABEL_FONT_PX = 11;

/** The same, for the name of a relation, which is read of a map already zoomed into. */
const LINK_LABEL_FONT_PX = 8;

/**
 * How much of the zoom a label takes on. None of it holds every label to the same size on screen; all
 * of it is the graph's own units, where a title grows without bound as the map is zoomed into. A
 * quarter of it carries a label from 11px to about 18px across the whole range of zooms the map
 * allows, so that zooming in brings the titles closer without letting them take the map over.
 */
const LABEL_ZOOM_SHARE = 0.25;

/** How wide a label may be, in multiples of its own font size, before what is left of the title is cut. */
const MAX_LABEL_WIDTH_EMS = 12;

/**
 * What is laid under a label so that it is read off whatever it crosses — a relation, another note,
 * another label — rather than out of it, the way a subtitle is read off the picture behind it.
 *
 * Neither the spread nor the drop is in the graph's units: a canvas draws a shadow the same whatever
 * it has been scaled to, so these hold as the map is zoomed rather than growing with it.
 */
const LABEL_SHADOW = { blur: 4, drop: 1 };

export interface CssData {
    fontFamily: string;
    textColor: string;
    mutedTextColor: string;
    /**
     * What the map is drawn on: the notes are faded towards it the further they are from the one the
     * map is rooted at, and their icons are cut out of them in it.
     */
    backgroundColor: string;
    /**
     * What a note's icon is drawn on and in beside the title of the note being read, which the map
     * draws the very same note in — so that the middle of the map and the note it is about are
     * plainly one thing. The second doubles as the ring that picks it out: on a dark theme the badge
     * is a dark circle, which a map of light notes would otherwise swallow.
     */
    anchorColor: string;
    anchorIconColor: string;
}

interface RenderData {
    note: FNote;
    noteIdToSizeMap: Record<string, number>;
    cssData: CssData;
    /**
     * The note the map is drawn around — the one being read, where the map follows it, and otherwise
     * the one it has been pointed at. Everything else is coloured by how far it is from this one.
     */
    mapRootId: string;
    themeStyle: "light" | "dark";
    widgetMode: NoteMapWidgetMode;
    notesAndRelations: NotesAndRelationsData;
    /** The element the graph's canvas lives in, watched for the user taking the view over. */
    container: HTMLElement;
    /** What each note's icon class resolves to, as the icon pack draws it — see icon_glyphs.ts. */
    iconGlyphs: Map<string, IconGlyph>;
}

/** @returns a teardown function to call when the graph is discarded. */
export function setupRendering(graph: ForceGraph<NoteMapNodeObject, NoteMapLinkObject>, { note, mapRootId, themeStyle, widgetMode, noteIdToSizeMap, notesAndRelations, cssData, container, iconGlyphs }: RenderData) {
    // What the map is showing of the note under the pointer: the note itself, the notes a relation
    // runs between it and, and those relations. Worked out once when the hover changes rather than
    // while painting, so that every note of a frame is painted knowing the same thing.
    let hoverNode: NoteMapNodeObject | null = null;
    let neighbours = new Set<NoteMapNodeObject>();
    let highlightLinks = new Set<NoteMapLinkObject>();
    let zoomLevel: number;
    /** Titles as they are drawn, cut to the width a label is allowed — see {@link getLabel}. */
    const labelsByNoteId = new Map<string, string>();
    /** How many relations lie between each note and the one the map is rooted at — see {@link setupFraming}. */
    const hopDistances = getHopDistances(mapRootId, notesAndRelations.links);
    /**
     * What the hovered note's own relations are drawn in. Remembered rather than asked of the hovered
     * note as it is drawn, so that they have a colour to fade back from once the pointer has left.
     */
    let highlightColor = cssData.textColor;
    /**
     * Where each note and each relation stands between the two things a hover asks of it: -1 faded
     * back behind what is hovered, 0 as the map stands with nothing hovered, 1 lit as one of its own.
     */
    const nodeFocus = createFade(notesAndRelations.nodes, (node) => (hoverNode && !isInHoveredNeighbourhood(node) ? -1 : 0));
    const linkFocus = createFade<NoteMapLinkObject>(notesAndRelations.links, (link) => {
        if (!hoverNode) {
            return 0;
        }
        return highlightLinks.has(link) ? 1 : -1;
    });
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    /** A canvas of no consequence, kept for what it makes of a colour — see {@link normalizeColor}. */
    const colorResolver = document.createElement("canvas").getContext("2d");

    /**
     * Takes note of what is hovered and of what the map is to show of it: the notes a relation runs
     * between it and, and the relations themselves.
     */
    function setHoveredNode(node: NoteMapNodeObject | null) {
        // Where everything stands is taken down before any of it changes, that being what the fade
        // about to start reads from.
        nodeFocus.restart();
        linkFocus.restart();
        keepPaintingThroughFade();

        hoverNode = node;

        if (!hoverNode) {
            neighbours = new Set();
            highlightLinks = new Set();
            return;
        }

        highlightColor = normalizeColor(getNodeColors(hoverNode, cssData).fill);
        ({ neighbours, highlightLinks } = getHoveredNeighbourhood(hoverNode, notesAndRelations.links));
    }

    /** Whether the note is the hovered one or one a relation runs between it and — all of them, while nothing is hovered. */
    function isInHoveredNeighbourhood(node: NoteMapNodeObject) {
        return !hoverNode || node === hoverNode || neighbours.has(node);
    }

    /**
     * What a relation is drawn in, where it stands between the map's own muted colour and the colour
     * of the note being hovered — so that what leads to and from that note is read as belonging to it,
     * arrowheads included, which take the colour of the line they end. The rest of the map's relations
     * fade back with the notes they run between.
     *
     * A relation cannot be faded the way a note is, the graph being handed its colour rather than
     * drawing it, so what it is faded by is asked for as part of the colour.
     */
    function getLinkColor(link: NoteMapLinkObject) {
        const focus = linkFocus.get(link);
        const lit = Math.max(0, focus);
        const color = lit <= 0 ? cssData.mutedTextColor
            : lit >= 1 ? highlightColor
                : mixColors(cssData.mutedTextColor, highlightColor, lit);

        return withAlpha(color, getFadedAlpha(focus));
    }

    /**
     * The colour as a canvas keeps it — `#rrggbb` — whatever it was written as, a note being free to
     * ask for any colour CSS knows by name. Only that form can be faded or mixed with another.
     */
    function normalizeColor(color: string) {
        if (!colorResolver) {
            return color;
        }

        colorResolver.fillStyle = "#000000";
        colorResolver.fillStyle = color;
        return typeof colorResolver.fillStyle === "string" ? colorResolver.fillStyle : color;
    }

    /**
     * Keeps the canvas painting for as long as a fade runs. It is otherwise only repainted once
     * something has changed — and a fade is not a change, it is what follows one.
     */
    function keepPaintingThroughFade() {
        graph.autoPauseRedraw(false);
        clearTimeout(fadeTimer);
        fadeTimer = setTimeout(() => graph.autoPauseRedraw(true), HOVER_FADE_MS + 100);
    }

    /**
     * The note's title, for the tooltip that stands over it while it is hovered — or nothing at all
     * where the map is already showing the title in full under the note, the tooltip then being a
     * second copy of what the pointer is resting on.
     *
     * A title cut down to the width a label is allowed still earns one, since the rest of it is what
     * the reader is missing. So does one whose label the map is not drawing at all — a note with no
     * entry in the map has never had its label drawn, and cannot have it in full.
     */
    function getTooltip(node: NoteMapNodeObject) {
        const shownInFull = isLabelDrawn(noteIdToSizeMap[node.id], zoomLevel) && labelsByNoteId.get(node.id) === node.name;

        return shownInFull ? "" : escapeHtml(node.name);
    }

    function paintNode(node: NoteMapNodeObject, color: string, ctx: CanvasRenderingContext2D) {
        const { x, y } = node;
        // A coordinate of exactly 0 is a position like any other, and a common one: d3 lays the
        // first node out at an angle of 0, so its y is 0 — and in a one-node map nothing ever moves
        // it off that axis, which used to leave the map permanently blank.
        if (x === undefined || y === undefined) {
            return;
        }
        const size = noteIdToSizeMap[node.id];

        const radius = size * NODE_RADIUS_RATIO;

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI, false);
        ctx.fill();

        // The note the map is drawn around wears a ring, which is what picks it out of the notes
        // around it: it is drawn as its icon is drawn beside its title, and on a dark theme that is a
        // dark circle — the quietest thing on a map whose notes are the light ones. The ring is in
        // the colour of the icon within it, so it is of the badge rather than something laid over it.
        if (node.id === mapRootId) {
            const width = ANCHOR_RING_PX / zoomLevel;

            ctx.strokeStyle = cssData.anchorIconColor;
            ctx.lineWidth = width;
            ctx.beginPath();
            ctx.arc(x, y, radius + width / 2, 0, 2 * Math.PI, false);
            ctx.stroke();
        }

        paintNodeIcon(node, size, x, y, ctx);

        if (!isLabelDrawn(size, zoomLevel)) {
            return;
        }

        const fontSize = getLabelFontSize(LABEL_FONT_PX, zoomLevel);

        ctx.save();
        castLabelShadow(ctx);
        ctx.fillStyle = cssData.textColor;
        ctx.font = `${fontSize}px ${cssData.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(getLabel(node, ctx, fontSize), x, y + radius + fontSize);
        ctx.restore();
    }

    /**
     * Lays a shadow of the map's own background under the text drawn next, so that it is read off
     * whatever it crosses rather than out of it — a note's title has the whole map to cross.
     *
     * The background is taken from the theme rather than read off the map: the map's own element is
     * see-through, so what is behind a label is whatever is behind the map.
     */
    function castLabelShadow(ctx: CanvasRenderingContext2D) {
        ctx.shadowColor = themeStyle === "dark" ? "rgba(0, 0, 0, 0.85)" : "rgba(255, 255, 255, 0.9)";
        ctx.shadowBlur = LABEL_SHADOW.blur;
        ctx.shadowOffsetY = LABEL_SHADOW.drop;
    }

    /**
     * The note's title, cut down to what a label is allowed to be wide.
     *
     * Measured rather than counted: a count of characters cuts a title of wide ones halfway across the
     * map and one of narrow ones long before it had to. The width allowed is in multiples of the font
     * size and the measuring is in the graph's units, so the zoom is on both sides of the comparison
     * and cancels out — what fits at one zoom fits at every other, and is worked out once per note.
     */
    function getLabel(node: NoteMapNodeObject, ctx: CanvasRenderingContext2D, fontSize: number) {
        const cached = labelsByNoteId.get(node.id);
        if (cached !== undefined) {
            return cached;
        }

        const label = truncateLabel(node.name, fontSize, (text) => ctx.measureText(text).width);

        labelsByNoteId.set(node.id, label);
        return label;
    }

    /**
     * The note's own icon, cut out of the dot standing for it — the same one the tree and the tabs
     * draw it with, so a note is recognised in the map by what it is recognised by everywhere else.
     *
     * Drawn as it is drawn beside a title, in the colour that goes with the badge under it.
     *
     * A note that asks for a colour of its own has no such pairing to draw on, so its icon is cut out
     * of it in the colour of what the map is laid on: whatever the note asks to be drawn in, the page
     * behind it is something else.
     *
     * Only where the dot is drawn large enough on screen to hold it: below that the glyph is a smudge
     * over the colour, and the colour alone says more.
     */
    function paintNodeIcon(node: NoteMapNodeObject, size: number, x: number, y: number, ctx: CanvasRenderingContext2D) {
        const glyph = iconGlyphs.get(node.icon);

        if (!glyph || !isIconDrawn(size, zoomLevel)) {
            return;
        }

        ctx.fillStyle = getNodeColors(node, cssData).icon;
        // The pack's own font rather than one font for the map: a note may wear an icon from a pack
        // the user brought along, whose characters are numbered as the built-in one's are.
        ctx.font = `${size}px ${glyph.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(glyph.content, x, y);
    }

    /**
     * The arrowhead that says which way a relation runs, drawn where the line meets the note it points
     * at — a swept chevron with every corner rounded off, rather than the hard little wedge the graph
     * draws of its own accord.
     *
     * Held to a size on screen the way the labels are, so that it neither disappears on a map zoomed
     * out nor grows into a spearhead on one zoomed in. It is also placed against the dot as the map
     * actually draws it: the graph sizes every note the same for this, which buries the arrowhead
     * inside the larger ones.
     */
    function paintArrow(link: NoteMapLinkObject, source: NoteMapNodeObject, target: NoteMapNodeObject, ctx: CanvasRenderingContext2D) {
        const length = getLabelFontSize(ARROW_LENGTH_PX, zoomLevel);
        const outline = getArrowOutline(
            { x: source.x ?? 0, y: source.y ?? 0 },
            { x: target.x ?? 0, y: target.y ?? 0 },
            noteIdToSizeMap[target.id] * NODE_RADIUS_RATIO,
            length
        );

        if (!outline) {
            return;
        }

        ctx.save();
        // The corners are rounded into the outline itself rather than stroked round afterwards: a
        // stroke over a fill is drawn twice where the two meet, which tells on an arrowhead faded
        // back behind a hover as a rim darker than the rest of it.
        traceRoundedPath(ctx, outline, length * ARROW_ROUNDING);

        ctx.fillStyle = getLinkColor(link);
        ctx.fill();
        ctx.restore();
    }

    function paintLink(link: NoteMapLinkObject, ctx: CanvasRenderingContext2D) {
        const { source, target } = link;
        if (typeof source !== "object" || typeof target !== "object") {
            return;
        }

        if (source.x !== undefined && source.y !== undefined && target.x !== undefined && target.y !== undefined) {
            paintArrow(link, source, target, ctx);
        }

        if (zoomLevel < 5) {
            return;
        }

        // Held to a size the same way a note's label is, from a smaller one: the name of a relation
        // is there to be read of a map already zoomed into, not to stand alongside the names of the
        // notes it runs between.
        const fontSize = getLabelFontSize(LINK_LABEL_FONT_PX, zoomLevel);

        ctx.font = `${fontSize}px ${cssData.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = cssData.mutedTextColor;

        if (source.x !== undefined && source.y !== undefined && target.x !== undefined && target.y !== undefined) {
            const x = (source.x + target.x) / 2;
            const y = (source.y + target.y) / 2;
            ctx.save();
            ctx.translate(x, y);

            const deltaY = source.y - target.y;
            const deltaX = source.x - target.x;

            let angle = Math.atan2(deltaY, deltaX);
            // Riding just off the line rather than sitting across it, by a distance of its own text's
            // making — a fixed one would ride further off it the smaller the text is drawn.
            let moveY = fontSize * 0.7;

            if (angle < -Math.PI / 2 || angle > Math.PI / 2) {
                angle += Math.PI;
                moveY = -moveY;
            }

            castLabelShadow(ctx);
            ctx.rotate(angle);
            ctx.fillText(link.name, 0, moveY);
            // Restored within the turn that saved it: the canvas is left as it was found either way,
            // rather than being handed back a state that was never put on for a relation drawn with
            // an end still to be placed.
            ctx.restore();
        }
    }

    graph
        .d3AlphaDecay(0.01)
        .d3VelocityDecay(0.08)
        .maxZoom(7)
        .warmupTicks(30)
        .nodeCanvasObject((node, ctx) => {
            // Every note keeps its own colour while one of them is hovered; what tells the note's
            // own from the rest of the map is that the rest of it is faded back behind them.
            ctx.save();
            // Every note is drawn whole; the only thing that steps one back is the pointer resting on
            // another note than it.
            ctx.globalAlpha = getFadedAlpha(nodeFocus.get(node));
            paintNode(node, getNodeColors(node, cssData).fill, ctx);
            ctx.restore();
        })
        .onNodeHover((node) => setHoveredNode(node ?? null))
        .nodePointerAreaPaint((node, color, ctx) => {
            if (!node.id) {
                return;
            }

            ctx.fillStyle = color;
            ctx.beginPath();
            if (node.x !== undefined && node.y !== undefined) {
                ctx.arc(node.x, node.y, noteIdToSizeMap[node.id], 0, 2 * Math.PI, false);
            }
            ctx.fill();
        })
        .nodeLabel((node) => getTooltip(node))
        .onZoom((zoom) => zoomLevel = zoom.k);

    graph
        .linkWidth((link) => LINK_WIDTH + (HIGHLIGHT_LINK_WIDTH - LINK_WIDTH) * Math.max(0, linkFocus.get(link)))
        .linkColor((link) => getLinkColor(link))
        // The arrowheads are drawn along with the relations themselves (see paintArrow); the graph's
        // own are left off entirely rather than drawn under them.
        .linkDirectionalArrowLength(0);

    graph
        .linkLabel((link) => {
            const { source, target } = link;
            if (typeof source !== "object" || typeof target !== "object") return escapeHtml(link.name);
            return `${escapeHtml(source.name)} - <strong>${escapeHtml(link.name)}</strong> - ${escapeHtml(target.name)}`;
        })
        // Drawn after the relation itself rather than in place of it: the line is the graph's to draw,
        // the arrowhead at the end of it and the name along it are this map's.
        .linkCanvasObject((link, ctx) => paintLink(link, ctx))
        .linkCanvasObjectMode(() => "after");

    // Forces
    const nodeLinkRatio = notesAndRelations.nodes.length / notesAndRelations.links.length;
    const magnifiedRatio = Math.pow(nodeLinkRatio, 1.5);
    const charge = -20 / magnifiedRatio;
    const boundedCharge = Math.min(-3, charge);
    graph.d3Force("center")?.strength(0.2);
    graph.d3Force("charge")?.strength(boundedCharge);
    graph.d3Force("charge")?.distanceMax(1000);

    const stopFraming = setupFraming(graph, container, { note, widgetMode, notesAndRelations, hopDistances });

    return () => {
        clearTimeout(fadeTimer);
        stopFraming();
    };
}

/**
 * What the map is to show of the note under the pointer: the notes a relation runs between it and,
 * and the relations themselves. Which way round a relation runs is not what this asks — a note is as
 * much a neighbour for being pointed at as for pointing.
 *
 * Worked out once when the hover changes rather than while painting, so that every note of a frame is
 * painted knowing the same thing.
 */
export function getHoveredNeighbourhood(hoverNode: NoteMapNodeObject, links: NoteMapLinkObject[]) {
    const neighbours = new Set<NoteMapNodeObject>();
    const highlightLinks = new Set<NoteMapLinkObject>();

    for (const link of links) {
        const { source, target } = link;
        // Both ends are notes of the map by the time it is drawn, the graph having looked up what the
        // data carries as ids.
        if (typeof source !== "object" || typeof target !== "object") {
            continue;
        }

        if (source.id === hoverNode.id) {
            neighbours.add(target);
            highlightLinks.add(link);
        } else if (target.id === hoverNode.id) {
            neighbours.add(source);
            highlightLinks.add(link);
        }
    }

    return { neighbours, highlightLinks };
}

/** How much of a note or a relation is drawn, from all of it to {@link DIMMED_ALPHA} faded back. */
export function getFadedAlpha(focus: number) {
    return DIMMED_ALPHA + (1 - DIMMED_ALPHA) * Math.min(1, 1 + focus);
}

/**
 * What a note is drawn in, and what its icon is cut out of it in.
 *
 * The badge its icon is shown in beside a title, wherever a note is shown at a size. Every note of the
 * map wears it, whole — which of them the map is drawn around is said by the ring, and what kind of
 * note each is by the icon within it.
 *
 * A note that asks for a colour of its own is given it: that is the reader's own doing, and it says
 * something no map should talk over. It has no badge pairing to draw its icon in, though, so the icon
 * is cut out of it in the colour of what the map is laid on — whatever the note asks to be drawn in,
 * the page behind it is something else.
 */
export function getNodeColors(node: Pick<NoteMapNodeObject, "color">, cssData: CssData) {
    return {
        fill: node.color || cssData.anchorColor,
        icon: node.color ? cssData.backgroundColor : cssData.anchorIconColor
    };
}

/**
 * The size to draw text at in the graph's own units, for a size on screen.
 *
 * The canvas is scaled by the zoom, so text measured in the graph's units is drawn as large as the map
 * is zoomed in — which is how a title once came to stand taller than the note it belonged to. Dividing
 * the size on screen back out by the zoom holds it to a size of its own, and the share of the zoom it
 * is given back (see {@link LABEL_ZOOM_SHARE}) is what still lets it grow.
 */
export function getLabelFontSize(screenPx: number, zoomLevel: number) {
    return screenPx * zoomLevel ** LABEL_ZOOM_SHARE / zoomLevel;
}

/**
 * Whether a note of the given size has its label drawn under it as the map stands: the smaller the
 * note, the further in the map has to be zoomed before its name is worth the clutter.
 */
export function isLabelDrawn(size: number, zoomLevel: number) {
    return zoomLevel > 2 || (zoomLevel > 1 && size > 6) || (zoomLevel > 0.3 && size > 10);
}

/**
 * Whether the note's dot comes out large enough on screen to hold its icon. Below that the glyph is a
 * smudge over the colour, and the colour alone says more.
 */
export function isIconDrawn(size: number, zoomLevel: number) {
    return size * NODE_RADIUS_RATIO * zoomLevel >= MIN_ICON_RADIUS;
}

/**
 * The title cut down to what a label is allowed to be wide, with an ellipsis for what is left off.
 *
 * Measured rather than counted: a count of characters cuts a title of wide ones halfway across the map
 * and one of narrow ones long before it had to. The width allowed is in multiples of the font size and
 * the measuring is in the graph's units, so the zoom is on both sides of the comparison and cancels
 * out — what fits at one zoom fits at every other.
 *
 * @param measureWidth how wide the text comes out, as the canvas it is to be drawn on measures it.
 */
export function truncateLabel(title: string, fontSize: number, measureWidth: (text: string) => number) {
    const maxWidth = MAX_LABEL_WIDTH_EMS * fontSize;

    if (measureWidth(title) <= maxWidth) {
        return title;
    }

    let label = title;
    // The ellipsis is part of what has to fit, so it is measured along with what is left of the title.
    while (label.length > 1 && measureWidth(`${label}…`) > maxWidth) {
        label = label.slice(0, -1);
    }

    return `${label}…`;
}

/**
 * The corners of the arrowhead that says which way a relation runs — a swept chevron, drawn where the
 * line meets the note it points at, rather than the hard little wedge the graph draws of its own
 * accord. Rounded off by whoever traces it (see {@link traceRoundedPath}).
 *
 * Nothing at all where the two notes are so close together that there is nowhere to put it that is not
 * inside one of them, where it would be drawn pointing back the way it came.
 *
 * @param targetRadius the dot the arrowhead stops at, as the map actually draws it: the graph sizes
 *                     every note the same for this, which buries the arrowhead inside the larger ones.
 * @param length how long the arrowhead is, in the graph's units.
 */
export function getArrowOutline(source: { x: number, y: number }, target: { x: number, y: number }, targetRadius: number, length: number) {
    const lineLength = Math.hypot(target.x - source.x, target.y - source.y);

    if (lineLength < targetRadius + length) {
        return null;
    }

    const alongX = (target.x - source.x) / lineLength;
    const alongY = (target.y - source.y) / lineLength;
    const tipX = target.x - alongX * targetRadius;
    const tipY = target.y - alongY * targetRadius;
    const baseX = tipX - alongX * length;
    const baseY = tipY - alongY * length;
    const halfWidth = length * ARROW_WIDTH_RATIO / 2;
    // The notch the tail is swept back to, which is what keeps it an arrowhead rather than a triangle
    // sitting on the line.
    const notchX = baseX + alongX * length * ARROW_SWEEP;
    const notchY = baseY + alongY * length * ARROW_SWEEP;

    return [
        [ tipX, tipY ],
        [ baseX - alongY * halfWidth, baseY + alongX * halfWidth ],
        [ notchX, notchY ],
        [ baseX + alongY * halfWidth, baseY - alongX * halfWidth ]
    ] satisfies [ number, number ][];
}

/**
 * Lays out a shape whose every corner is rounded off, ready to be filled.
 *
 * Each corner is drawn as an arc between the middles of the two edges that meet at it, which is what
 * lets one call round all of them however sharp each turns out to be — the tip of an arrowhead being
 * a good deal sharper than its tail.
 *
 * @param radius how much of each corner to round off, in the units the points are given in.
 */
export function traceRoundedPath(ctx: CanvasRenderingContext2D, points: [ number, number ][], radius: number) {
    const middleOf = (from: [ number, number ], to: [ number, number ]) => [ (from[0] + to[0]) / 2, (from[1] + to[1]) / 2 ] as const;
    const [ startX, startY ] = middleOf(points[points.length - 1], points[0]);

    ctx.beginPath();
    ctx.moveTo(startX, startY);

    for (let i = 0; i < points.length; i++) {
        const corner = points[i];
        const [ towardsX, towardsY ] = middleOf(corner, points[(i + 1) % points.length]);
        ctx.arcTo(corner[0], corner[1], towardsX, towardsY, radius);
    }

    ctx.closePath();
}

/**
 * Values that make their way to where a change puts them over {@link HOVER_FADE_MS}, rather than
 * being there the moment it is made.
 *
 * Each is read from where it stood when the change was made and where it is to end up, so a pointer
 * carried straight from one note to another takes each of them from wherever the last change had left
 * it — rather than from where a fade of the whole map would have them all start together.
 *
 * @param getTarget where the value should end up, as things stand now.
 */
export function createFade<T>(elements: T[], getTarget: (element: T) => number) {
    const startingPoints = new Map<T, number>();
    let startedAt = 0;

    function get(element: T) {
        const target = getTarget(element);
        const from = startingPoints.get(element) ?? target;
        const progress = Math.min(1, (performance.now() - startedAt) / HOVER_FADE_MS);

        return from + (target - from) * progress;
    }

    return {
        get,
        /** Takes down where every value stands, for the fade the caller is about to bring about to start from. */
        restart() {
            for (const element of elements) {
                startingPoints.set(element, get(element));
            }

            startedAt = performance.now();
        }
    };
}

/**
 * Keeps the view framed on the interesting part of the graph — the subtree the current note belongs
 * to in the ribbon, the linked notes elsewhere — while the layout settles.
 *
 * The fit runs on every tick of the simulation rather than once after a fixed delay: the layout
 * keeps expanding for seconds after the data lands, so a single delayed fit leaves the map at
 * force-graph's default zoom meanwhile (a few nodes around the origin, the rest already spread out
 * of sight) and then jumps to the real framing when it finally fires.
 *
 * @returns a teardown function to call when the graph is discarded.
 */
function setupFraming(graph: ForceGraph<NoteMapNodeObject, NoteMapLinkObject>, container: HTMLElement, { note, widgetMode, notesAndRelations, hopDistances }: Pick<RenderData, "note" | "widgetMode" | "notesAndRelations"> & { hopDistances: Map<string, number> }) {
    const { framedNoteIds, framesSubset, padding, fittedNoteCount } = planFraming({ widgetMode, noteType: note?.type, notesAndRelations, hopDistances });
    const nodeFilter = framesSubset
        ? (node: NoteMapNodeObject) => framedNoteIds.has(node.id)
        : undefined;

    // Panning or zooming hands the view over to the user for good — re-fitting under their fingers
    // would make the map impossible to explore while it is still settling.
    //
    // Listened for while the event is still on its way down: d3-zoom, which force-graph binds to the
    // canvas within this element, calls stopImmediatePropagation() on the wheel events it acts on, so
    // a listener waiting for them to come back up is never told about a zoom at all. It would then
    // re-fit over every notch of the wheel until the simulation came to rest — the map answering the
    // wheel by snapping back for as long as a quarter of a minute.
    const listenerOptions = { capture: true, passive: true };
    let framing = true;
    const releaseFraming = () => framing = false;
    container.addEventListener("wheel", releaseFraming, listenerOptions);
    container.addEventListener("pointerdown", releaseFraming, listenerOptions);

    let ticks = 0;
    graph.onEngineTick(() => {
        if (framing) {
            // Fitting is what centres the view on the note, whether or not its zoom is kept.
            graph.zoomToFit(0, padding, nodeFilter);

            if (fittedNoteCount <= 1) {
                graph.zoom(LONE_NOTE_ZOOM, 0);
            }
        }

        // Damping, once the graph has had the room to spread out, so that a small map comes to rest
        // instead of drifting for the whole cooldown.
        if (++ticks === TICKS_UNTIL_DAMPED && framedNoteIds.size < DAMPING_MAX_NOTES) {
            graph.d3VelocityDecay(0.4);
        }
    });

    return () => {
        container.removeEventListener("wheel", releaseFraming, listenerOptions);
        container.removeEventListener("pointerdown", releaseFraming, listenerOptions);
    };
}

/**
 * What the view is to be framed on, worked out once from the map's data — see {@link setupFraming} for
 * what is done with it.
 */
export function planFraming({ widgetMode, noteType, notesAndRelations, hopDistances }: {
    widgetMode: NoteMapWidgetMode;
    /** Of the note the map is drawn for, a search note being no part of its own results. */
    noteType: string | undefined;
    notesAndRelations: NotesAndRelationsData;
    hopDistances: Map<string, number>;
}) {
    // The notes that can be reached from the one the map is rooted at, which is what the distances
    // drawn on are a walk of already.
    const framedNoteIds: Set<string | number> = (isRootedAtCurrentNote(widgetMode) && noteType !== "search")
        ? new Set(hopDistances.keys())
        : getNoteIdsWithLinks(notesAndRelations);

    // A lone note has no extent to fit and would just be blown up to the maximum zoom, hiding the
    // rest of the map; the whole graph is the more useful thing to look at then.
    const framesSubset = framedNoteIds.size > 1;

    return {
        framedNoteIds,
        framesSubset,
        padding: getFitPadding(widgetMode, framedNoteIds.size),
        /**
         * What the fit is measured on: the framed notes, or the whole graph where those are no more
         * than the one note. A note whose map is only itself has no extent to fit at all — the fit
         * then asks for a zoom of hundreds and gets the highest allowed, which fills the card with a
         * single circle and the beginning of a title. It is shown at a size it can be read at instead.
         */
        fittedNoteCount: framesSubset ? framedNoteIds.size : notesAndRelations.nodes.length
    };
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
