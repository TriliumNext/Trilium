import "./Treemap.css";

import clsx from "clsx";
import { hierarchy, type HierarchyRectangularNode, treemap, treemapSquarify } from "d3-hierarchy";
import { useMemo } from "preact/hooks";

import { useElementSize } from "../hooks";
import { useChartTooltip } from "./chart_tooltip";

export interface TreemapItem<T = unknown> {
    /** Stable identity for reconciliation; unique across the whole tree. */
    id: string;
    /** Weight of a leaf. Branch items derive their weight from their children and leave this unset. */
    value?: number;
    children?: TreemapItem<T>[];
    /**
     * Categorical tint (0–359): cells belonging together share the hue. Absent = plain surface,
     * for cells that stand apart from every group.
     */
    hue?: number;
    /** Extra classes on the cell, for special entries the consumer styles itself. */
    className?: string;
    /**
     * Icon classes drawn centered in the cell, sized to it — what the cell holds, at a glance.
     * Dropped on cells too small to render it legibly.
     */
    icon?: string;
    /** Text for the chart's own tooltip, for cells that identify themselves rather than a note. */
    tooltip?: string;
    /**
     * Attributes sprinkled onto the cell element — the cells carry no text of their own, so this
     * is the other way identity is given: `data-href` opts a cell into the note preview tooltip.
     */
    attributes?: Record<string, string>;
    /** The consumer's payload, handed back on click. */
    data?: T;
}

interface TreemapProps<T> {
    root: TreemapItem<T>;
    /**
     * The cell drawn as the chosen one, by {@link TreemapItem.id}. For a consumer that keeps a
     * selection rather than leaving identity to the hover: a touch screen has no hover, so the mark
     * has to stay marked while whatever names it is read elsewhere on the screen.
     */
    selectedItemId?: string;
    onItemClick?: (item: TreemapItem<T>) => void;
    onItemContextMenu?: (item: TreemapItem<T>, event: MouseEvent) => void;
    className?: string;
}

/** Between the top-level blocks — a group of related cells, or a lone cell standing on its own. */
const BLOCK_GAP = 4;

/** Between cells within one block, which read as one surface split up rather than separate things. */
const CELL_GAP = 2;

const BLOCK_CORNER_RADIUS = 4;

/** Breathing room at the map's edge: a hovered cell's outline straddles its border and would
 *  otherwise be shaved off by the container's clipping along the outermost rows and columns. */
const MAP_INSET = 2;

/** Layout coordinates are floats; edges meant to coincide can differ in the last bit. */
const EDGE_EPSILON = 0.5;

/** Share of the cell's shorter side left clear around the icon, on each edge. */
const ICON_MARGIN = 0.1;

/** Past this the glyph stops reading as an icon and starts dominating its cell. */
const MAX_ICON_SIZE = 24;

/** Below this it is a smudge rather than a symbol, so the cell is better left as plain color. */
const MIN_ICON_SIZE = 10;

/**
 * A treemap over an arbitrary {@link TreemapItem} hierarchy, sized to fill its container and
 * re-laid out whenever the container resizes.
 *
 * Only the leaves are drawn, and each cell is nothing but its color: branch items shape the layout
 * — their leaves stay clustered — and lend their group a shared {@link TreemapItem.hue}, but paint
 * no cell of their own, so nothing sits between the pointer and the leaf it is over. Identity is
 * explored by hovering, via the {@link TreemapItem.attributes} tooltips.
 *
 * Each top-level block is drawn as one rounded card: its cells sit {@link CELL_GAP} apart and square,
 * rounding only the corners they share with the block, so a group reads as a single surface divided
 * up rather than as loose tiles. Blocks stand {@link BLOCK_GAP} apart from each other.
 *
 * d3 computes the geometry only; the cells are plain absolutely-positioned divs so hover and
 * tooltips behave like everywhere else in the app. The hue tint is mixed into the theme's own
 * surface color, which keeps the map coherent under any user theme.
 */
export default function Treemap<T>({ root, selectedItemId, onItemClick, onItemContextMenu, className }: TreemapProps<T>) {
    const { containerRef, containerProps, showTooltip, hideTooltip, tooltipNode } = useChartTooltip<HTMLDivElement>();
    const size = useElementSize(containerRef);
    const width = Math.floor(size?.width ?? 0);
    const height = Math.floor(size?.height ?? 0);

    const cells = useMemo(() => {
        if (width < 10 || height < 10) {
            return [];
        }

        const weighted = hierarchy(root)
            .sum((item) => item.children?.length ? 0 : Math.max(item.value ?? 0, 0))
            // Larger cells first within each group; the hierarchy itself keeps related notes together.
            .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

        const layout = treemap<TreemapItem<T>>()
            .tile(treemapSquarify)
            .size([ width, height ])
            // Invoked per node with children, separating that node's own children: the root spaces
            // the blocks apart, everything below it spaces cells within a block.
            .paddingInner((node) => node.depth === 0 ? BLOCK_GAP : CELL_GAP)
            // Only the root insets its children. A block must keep filling its own rect exactly,
            // or no cell would touch its corners and the block would lose its rounding.
            .paddingOuter((node) => node.depth === 0 ? MAP_INSET : 0);

        return layout(weighted).leaves().filter((leaf) => leaf.depth > 0);
    }, [ root, width, height ]);

    return (
        <div ref={containerRef} className={clsx("treemap", className)} {...containerProps}>
            {cells.map((cell) => {
                const item = cell.data;
                const cellWidth = cell.x1 - cell.x0;
                const cellHeight = cell.y1 - cell.y0;

                if (cellWidth < 1 || cellHeight < 1) {
                    return null;
                }

                const iconSize = fittedIconSize(cellWidth, cellHeight);

                return (
                    <div
                        key={item.id}
                        className={clsx(
                            "treemap-cell",
                            item.hue !== undefined && "treemap-colored",
                            item.id === selectedItemId && "treemap-cell-selected",
                            item.className
                        )}
                        // Geometry and tint are computed per layout run, so they cannot live in a stylesheet.
                        style={{
                            left: cell.x0,
                            top: cell.y0,
                            width: cellWidth,
                            height: cellHeight,
                            borderRadius: blockCornerRadius(cell),
                            ...(item.hue !== undefined && { "--treemap-hue": String(item.hue) })
                        }}
                        onClick={onItemClick && (() => onItemClick(item))}
                        onContextMenu={onItemContextMenu && ((event) => onItemContextMenu(item, event))}
                        onMouseEnter={(event) => showTooltip(item.tooltip, event)}
                        onMouseLeave={hideTooltip}
                        {...item.attributes}
                    >
                        {item.icon && iconSize >= MIN_ICON_SIZE && (
                            <span className={clsx("treemap-cell-icon", item.icon)} style={{ fontSize: iconSize }} />
                        )}
                    </div>
                );
            })}
            {tooltipNode}
        </div>
    );
}

/**
 * The icon size a cell affords: it fits the shorter side with {@link ICON_MARGIN} clear on either
 * edge, and stops growing at {@link MAX_ICON_SIZE} — past that a large cell would read as a huge
 * glyph rather than as an area.
 */
function fittedIconSize(cellWidth: number, cellHeight: number) {
    return Math.min(Math.min(cellWidth, cellHeight) * (1 - 2 * ICON_MARGIN), MAX_ICON_SIZE);
}

/**
 * The rounding a cell needs so its block is a rounded card: a cell rounds a corner only where that
 * corner is the block's own, leaving the cuts inside a block square. A cell that is a block by
 * itself therefore rounds all four.
 */
function blockCornerRadius<T>(cell: HierarchyRectangularNode<TreemapItem<T>>) {
    const block = cell.ancestors().find((node) => node.depth === 1) ?? cell;
    const atLeft = isSameEdge(cell.x0, block.x0);
    const atRight = isSameEdge(cell.x1, block.x1);
    const atTop = isSameEdge(cell.y0, block.y0);
    const atBottom = isSameEdge(cell.y1, block.y1);
    const corner = (isBlockCorner: boolean) => isBlockCorner ? `${BLOCK_CORNER_RADIUS}px` : "0";

    return [
        corner(atTop && atLeft),
        corner(atTop && atRight),
        corner(atBottom && atRight),
        corner(atBottom && atLeft)
    ].join(" ");
}

function isSameEdge(a: number, b: number) {
    return Math.abs(a - b) < EDGE_EPSILON;
}
