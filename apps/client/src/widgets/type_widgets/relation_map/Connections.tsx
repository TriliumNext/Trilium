import clsx from "clsx";
import { useMemo } from "preact/hooks";

import froca from "../../../services/froca";
import type { ClientRelation } from "./api";
import { type Box, type ConnectionLayout, type ConnectionShape, layoutConnections, layoutLine, type Point } from "./geometry";

/** A relation being drawn from the endpoint of a box, toward the pointer or onto a target box. */
export interface PendingRelation {
    sourceNoteId: string;
    /** The box under the pointer, or the box the relation was dropped on. */
    targetNoteId?: string;
    /** The pointer, in unzoomed map pixels. */
    pointer: Point;
}

/** `data-connection-id` of the relation being drawn, which the relation name popover anchors to. */
export const PENDING_CONNECTION_ID = "pending";

/**
 * Draws the relations between the boxes of a relation map: an SVG layer under the boxes for the
 * lines and arrowheads, and HTML labels along the lines.
 *
 * While a box is hovered, its relations take the note's `color` label (or
 * `--relation-map-highlight-color`) and the other relations fade, as on the note map.
 */
export default function Connections({ relations, inverseRelations, boxes, hoveredNoteId, hoveredRelationId, pending, onHoverRelation, onContextMenu }: {
    /** The relations to draw. A relation that pairs with an inverse is passed once, with its `type`. */
    relations: ClientRelation[];
    inverseRelations: Record<string, string> | undefined;
    /** The boxes on the map, by note ID. */
    boxes: Map<string, Box>;
    hoveredNoteId: string | null;
    hoveredRelationId: string | null;
    pending: PendingRelation | null;
    onHoverRelation(attributeId: string | null): void;
    onContextMenu(relation: ClientRelation, e: MouseEvent): void;
}) {
    const layouts = useMemo(
        () => layoutConnections(relations.map(toShape), boxes),
        [ relations, boxes ]);
    const pendingLayout = useMemo(() => pending && layoutPending(pending, boxes), [ pending, boxes ]);
    const litColor = hoveredNoteId ? froca.getNoteFromCache(hoveredNoteId)?.getLabelValue("color") : null;

    const drawn = relations
        .map((relation) => ({ relation, layout: layouts.get(relation.attributeId) }))
        .filter((entry): entry is { relation: ClientRelation; layout: ConnectionLayout } => !!entry.layout);
    const stateOf = (relation: ClientRelation) => {
        const isLit = !!hoveredNoteId && (relation.sourceNoteId === hoveredNoteId || relation.targetNoteId === hoveredNoteId);
        return {
            className: clsx(
                isLit && "lit",
                hoveredNoteId && !isLit && "faded",
                hoveredRelationId === relation.attributeId && "hovered"
            ),
            style: isLit && litColor ? { "--relation-map-lit-color": litColor } : undefined
        };
    };
    const hoverProps = (relation: ClientRelation) => ({
        onMouseEnter: () => onHoverRelation(relation.attributeId),
        onMouseLeave: () => onHoverRelation(null),
        onContextMenu: (e: MouseEvent) => onContextMenu(relation, e)
    });

    return (
        <>
            <svg className="relation-map-connections">
                {drawn.map(({ relation, layout }) => {
                    const { className, style } = stateOf(relation);
                    return (
                        <g
                            key={relation.attributeId}
                            className={clsx("relation-map-connection", className)}
                            style={style}
                            data-connection-id={relation.attributeId}
                            {...hoverProps(relation)}
                        >
                            <path className="relation-map-connection-hit" d={layout.path} />
                            <ConnectionLine layout={layout} />
                        </g>
                    );
                })}
                {pendingLayout && (
                    <g className="relation-map-connection pending" data-connection-id={PENDING_CONNECTION_ID}>
                        <ConnectionLine layout={pendingLayout} />
                    </g>
                )}
            </svg>

            {drawn.flatMap(({ relation, layout }) => {
                const { className, style } = stateOf(relation);
                return labelsOf(relation, inverseRelations).map((text, index) => text ? (
                    <div
                        key={`${relation.attributeId}-${index}`}
                        className={clsx("connection-label", layout.labels[index].side, className)}
                        style={{
                            ...style,
                            left: layout.labels[index].x,
                            top: layout.labels[index].y,
                            "--relation-map-label-angle": `${layout.labels[index].angle}deg`
                        }}
                        {...hoverProps(relation)}
                    >
                        {text}
                    </div>
                ) : null);
            })}
        </>
    );
}

function ConnectionLine({ layout }: { layout: ConnectionLayout }) {
    return (
        <>
            <path className="relation-map-connection-line" d={layout.path} />
            {layout.arrows.map((points) => <polygon className="relation-map-arrow" points={points} />)}
        </>
    );
}

function toShape(relation: ClientRelation): ConnectionShape {
    return {
        id: relation.attributeId,
        sourceId: relation.sourceNoteId,
        targetId: relation.targetNoteId,
        arrowAtSource: relation.type !== "uniDirectional",
        labelAt: relation.type === "inverse" ? [ 0.2, 0.8 ] : [ 0.5 ]
    };
}

/** The relation's name, and for an `inverse` relation the name of its inverse as well. */
function labelsOf(relation: ClientRelation, inverseRelations: Record<string, string> | undefined) {
    return relation.type === "inverse"
        ? [ relation.name, inverseRelations?.[relation.name] ?? "" ]
        : [ relation.name ];
}

function layoutPending({ sourceNoteId, targetNoteId, pointer }: PendingRelation, boxes: Map<string, Box>) {
    const source = boxes.get(sourceNoteId);
    if (!source) return null;
    if (!targetNoteId) return layoutLine(source, pointer);

    const shape = { id: PENDING_CONNECTION_ID, sourceId: sourceNoteId, targetId: targetNoteId, arrowAtSource: false, labelAt: [] };
    return layoutConnections([ shape ], boxes).get(PENDING_CONNECTION_ID) ?? null;
}
