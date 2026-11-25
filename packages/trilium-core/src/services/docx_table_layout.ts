import { unzipSync } from "fflate";
import { HTMLElement, parse } from "node-html-parser";

import { decodeUtf8 } from "./utils/binary.js";

/**
 * The look of a Word table that the office preview leaves out: the widths of its columns, and the
 * borders, padding, vertical alignment and row height of each cell, as inline CSS.
 */
export interface TableLayout {
    /** The widths of the table's grid columns, in twips. */
    columnWidths: number[];
    /**
     * The styles of each row's cells, in the order the office preview writes them: without the
     * cells that continue a vertical merge, which it leaves out.
     */
    rows: [ string, string ][][][];
}

/**
 * Reads the layout of every table in the body of a Word document, outer tables before the tables
 * inside them, as the office preview writes them. Returns an empty list for a file it cannot read.
 *
 * The space before a cell's first paragraph and after its last one is added to the cell's
 * padding: a note's editor has no paragraph spacing, and Word draws that space inside the cell.
 */
export function readDocxTableLayouts(docx: Uint8Array): TableLayout[] {
    let files: Record<string, Uint8Array>;
    try {
        files = unzipSync(docx, {
            filter: (file) => file.name === "word/document.xml" || file.name === "word/styles.xml"
        });
    } catch {
        return [];
    }

    const documentXml = files["word/document.xml"];
    const body = documentXml && findDescendant(parse(decodeUtf8(documentXml)), "w:body");
    if (!body) {
        return [];
    }

    const stylesXml = files["word/styles.xml"];
    const styles = readStyleSheet(stylesXml ? parse(decodeUtf8(stylesXml)) : undefined);
    const layouts: TableLayout[] = [];
    collectTables(body, styles, layouts);
    return layouts;
}

/** Word's own cell margins when neither the table nor its style sets them, in twips. */
const DEFAULT_CELL_MARGINS: Record<Side, number> = { top: 0, right: 108, bottom: 0, left: 108 };

const SIDES = [ "top", "right", "bottom", "left" ] as const;
type Side = typeof SIDES[number];

/** The OOXML names of each side, the second being that of a document written right to left. */
const SIDE_NAMES: Record<Side, string[]> = {
    top: [ "w:top" ],
    right: [ "w:right", "w:end" ],
    bottom: [ "w:bottom" ],
    left: [ "w:left", "w:start" ]
};

interface Border {
    style: string;
    width: number;
    color: string;
}

interface TableProperties {
    borders: Partial<Record<Side | "insideH" | "insideV", Border | null>>;
    margins: Partial<Record<Side, number>>;
    spacing: Spacing;
}

interface Spacing {
    before?: number;
    after?: number;
}

interface StyleSheet {
    styles: Map<string, HTMLElement>;
    defaultParagraphStyle?: string;
    defaultTableStyle?: string;
    defaultSpacing: Spacing;
}

function collectTables(container: HTMLElement, styles: StyleSheet, layouts: TableLayout[]) {
    for (const block of blockChildren(container)) {
        if (block.rawTagName === "w:tbl") {
            layouts.push(readTable(block, styles));
            for (const row of blockChildren(block, "w:tr")) {
                for (const cell of blockChildren(row, "w:tc")) {
                    collectTables(cell, styles, layouts);
                }
            }
        } else if (block.rawTagName !== "w:p") {
            collectTables(block, styles, layouts);
        }
    }
}

function readTable(table: HTMLElement, styles: StyleSheet): TableLayout {
    const tablePr = child(table, "w:tblPr");
    const styleId = attribute(child(tablePr, "w:tblStyle"), "w:val") ?? styles.defaultTableStyle;
    const properties = mergeTableProperties([
        ...styleChain(styles, styleId).map((style) => readTableProperties(style)),
        readTableProperties(table)
    ]);
    const columnWidths = children(child(table, "w:tblGrid"), "w:gridCol")
        .map((column) => Number(attribute(column, "w:w")) || 0);

    const rows = blockChildren(table, "w:tr");
    return {
        columnWidths,
        rows: rows.map((row, rowIndex) => {
            const rowPr = child(row, "w:trPr");
            const height = Number(attribute(child(rowPr, "w:trHeight"), "w:val")) || 0;
            let column = Number(attribute(child(rowPr, "w:gridBefore"), "w:val")) || 0;
            const cells: [ string, string ][][] = [];
            for (const cell of blockChildren(row, "w:tc")) {
                const cellPr = child(cell, "w:tcPr");
                const span = Number(attribute(child(cellPr, "w:gridSpan"), "w:val")) || 1;
                const vMerge = child(cellPr, "w:vMerge");
                const position = {
                    firstRow: rowIndex === 0,
                    lastRow: rowIndex === rows.length - 1,
                    firstColumn: column === 0,
                    lastColumn: column + span >= columnWidths.length
                };
                column += span;
                if (vMerge && attribute(vMerge, "w:val") !== "restart") {
                    continue;
                }
                cells.push(cellStyles(cell, properties, position, height, styles));
            }
            return cells;
        })
    };
}

function cellStyles(
    cell: HTMLElement,
    table: TableProperties,
    position: { firstRow: boolean; lastRow: boolean; firstColumn: boolean; lastColumn: boolean },
    height: number,
    styles: StyleSheet
): [ string, string ][] {
    const cellPr = child(cell, "w:tcPr");
    const ownBorders = readSides(child(cellPr, "w:tcBorders"), readBorder);
    const borders: Record<Side, Border | null> = {
        top: pick(ownBorders.top, position.firstRow ? table.borders.top : table.borders.insideH),
        bottom: pick(ownBorders.bottom,
            position.lastRow ? table.borders.bottom : table.borders.insideH),
        left: pick(ownBorders.left,
            position.firstColumn ? table.borders.left : table.borders.insideV),
        right: pick(ownBorders.right,
            position.lastColumn ? table.borders.right : table.borders.insideV)
    };

    const ownMargins = readSides(child(cellPr, "w:tcMar"), readWidth);
    const padding = Object.fromEntries(SIDES.map((side) => [
        side, ownMargins[side] ?? table.margins[side] ?? DEFAULT_CELL_MARGINS[side]
    ])) as Record<Side, number>;
    const blocks = blockChildren(cell).filter((block) => block.rawTagName !== "w:tcPr");
    if (blocks[0]?.rawTagName === "w:p") {
        padding.top += paragraphSpacing(blocks[0], styles, table).before ?? 0;
    }
    const last = blocks.at(-1);
    if (last?.rawTagName === "w:p") {
        padding.bottom += paragraphSpacing(last, styles, table).after ?? 0;
    }

    const vAlign = attribute(child(cellPr, "w:vAlign"), "w:val");
    const verticalAlign = vAlign === "center" ? "middle" : vAlign === "bottom" ? "bottom" : "top";
    return [
        ...borderStyles(borders),
        [ "padding", SIDES.map((side) => points(padding[side])).join(" ") ],
        [ "vertical-align", verticalAlign ],
        ...(height > 0 ? [ [ "height", points(height) ] as [ string, string ] ] : [])
    ];
}

/** The border declarations of a cell: one value when its sides are alike, four otherwise. */
function borderStyles(borders: Record<Side, Border | null>): [ string, string ][] {
    const sides = SIDES.map((side) => borders[side]);
    const visible = sides.filter((border): border is Border => !!border);
    if (!visible.length) {
        return [ [ "border-style", "none" ] ];
    }

    const fallbackColor = visible[0].color;
    const values = (read: (border: Border | null) => string) => {
        const each = sides.map(read);
        return each.every((value) => value === each[0]) ? each[0] : each.join(" ");
    };
    const colors = new Set(visible.map((border) => border.color));
    return [
        [ "border-style", values((border) => border?.style ?? "none") ],
        [ "border-width", values((border) => points(border?.width ?? 0)) ],
        [ "border-color", values((border) => border?.color ?? fallbackColor) ],
        ...(colors.size === 1
            ? [ [ "--tn-border-color", fallbackColor ] as [ string, string ] ]
            : [])
    ];
}

/**
 * The space before and after a paragraph, in twips, in Word's order of precedence: the document's
 * defaults, the table's style, the paragraph's style and its own properties.
 */
function paragraphSpacing(
    paragraph: HTMLElement, styles: StyleSheet, table: TableProperties
): Spacing {
    const pPr = child(paragraph, "w:pPr");
    const styleId = attribute(child(pPr, "w:pStyle"), "w:val") ?? styles.defaultParagraphStyle;
    const layers = [
        styles.defaultSpacing,
        table.spacing,
        ...styleChain(styles, styleId).map((style) => readSpacing(child(style, "w:pPr"))),
        readSpacing(pPr)
    ];
    return layers.reduce<Spacing>((spacing, layer) => ({ ...spacing, ...layer }), {});
}

function readStyleSheet(root: HTMLElement | undefined): StyleSheet {
    const styles = new Map<string, HTMLElement>();
    let defaultParagraphStyle: string | undefined;
    let defaultTableStyle: string | undefined;
    const stylesElement = root && findDescendant(root, "w:styles");
    for (const style of children(stylesElement, "w:style")) {
        const id = attribute(style, "w:styleId");
        if (!id) {
            continue;
        }
        styles.set(id, style);
        const isDefault = /^(1|true|on)$/.test(attribute(style, "w:default") ?? "");
        const type = attribute(style, "w:type");
        if (isDefault && type === "paragraph") {
            defaultParagraphStyle = id;
        } else if (isDefault && type === "table") {
            defaultTableStyle = id;
        }
    }

    const defaults = child(child(child(stylesElement, "w:docDefaults"), "w:pPrDefault"), "w:pPr");
    return {
        styles, defaultParagraphStyle, defaultTableStyle, defaultSpacing: readSpacing(defaults)
    };
}

/** The styles that `id` is based on, from the root, followed by `id` itself. */
function styleChain(styles: StyleSheet, id: string | undefined) {
    const chain: HTMLElement[] = [];
    let current = id;
    while (current && !chain.some((style) => attribute(style, "w:styleId") === current)) {
        const style = styles.styles.get(current);
        if (!style) {
            break;
        }
        chain.unshift(style);
        current = attribute(child(style, "w:basedOn"), "w:val");
    }
    return chain;
}

/** The table properties of a table or of a table style. */
function readTableProperties(element: HTMLElement): TableProperties {
    const tablePr = child(element, "w:tblPr");
    const bordersElement = child(tablePr, "w:tblBorders");
    return {
        borders: {
            ...readSides(bordersElement, readBorder),
            ...readNamed(bordersElement, "w:insideH", "insideH"),
            ...readNamed(bordersElement, "w:insideV", "insideV")
        },
        margins: readSides(child(tablePr, "w:tblCellMar"), readWidth),
        spacing: element.rawTagName === "w:style" ? readSpacing(child(element, "w:pPr")) : {}
    };
}

function readNamed(element: HTMLElement | undefined, name: string, key: "insideH" | "insideV") {
    const border = child(element, name);
    return border ? { [key]: readBorder(border) } : {};
}

function mergeTableProperties(layers: TableProperties[]): TableProperties {
    return layers.reduce<TableProperties>((merged, layer) => ({
        borders: { ...merged.borders, ...layer.borders },
        margins: { ...merged.margins, ...layer.margins },
        spacing: { ...merged.spacing, ...layer.spacing }
    }), { borders: {}, margins: {}, spacing: {} });
}

function readSides<T>(element: HTMLElement | undefined, read: (side: HTMLElement) => T) {
    const sides: Partial<Record<Side, T>> = {};
    for (const side of SIDES) {
        const sideElement = SIDE_NAMES[side].map((name) => child(element, name)).find(Boolean);
        if (sideElement) {
            sides[side] = read(sideElement);
        }
    }
    return sides;
}

/** A border, or `null` for a side that has none. */
function readBorder(element: HTMLElement): Border | null {
    const value = attribute(element, "w:val") ?? "single";
    if (value === "nil" || value === "none") {
        return null;
    }

    const color = attribute(element, "w:color");
    return {
        style: borderStyle(value),
        // Eighths of a point; Word draws a border without a size as the thinnest it has.
        width: (Number(attribute(element, "w:sz")) || 2) / 8 * 20,
        color: color && color !== "auto" ? `#${color}` : "#000000"
    };
}

function borderStyle(value: string) {
    if (value.startsWith("double") || value === "triple") {
        return "double";
    }
    if (value.includes("dash")) {
        return "dashed";
    }
    return value.includes("dot") ? "dotted" : "solid";
}

/** A width in twips, or `undefined` for one that is not (a percentage). */
function readWidth(element: HTMLElement) {
    const type = attribute(element, "w:type") ?? "dxa";
    if (type === "nil") {
        return 0;
    }
    const width = Number.parseFloat(attribute(element, "w:w") ?? "");
    return type === "dxa" && Number.isFinite(width) ? width : undefined;
}

function readSpacing(pPr: HTMLElement | undefined): Spacing {
    const spacing = child(pPr, "w:spacing");
    const before = Number.parseFloat(attribute(spacing, "w:before") ?? "");
    const after = Number.parseFloat(attribute(spacing, "w:after") ?? "");
    return {
        ...(Number.isFinite(before) ? { before } : {}),
        ...(Number.isFinite(after) ? { after } : {})
    };
}

/** The own value of a side when the cell sets one (even to none), else the table's. */
function pick(own: Border | null | undefined, inherited: Border | null | undefined) {
    return own === undefined ? inherited ?? null : own;
}

function points(twips: number) {
    return `${Number((twips / 20).toFixed(2))}pt`;
}

/**
 * The element children of `element`, seeing through the content controls and custom XML that can
 * wrap rows, cells and paragraphs, and keeping only those named `name` when it is given.
 */
function blockChildren(element: HTMLElement, name?: string): HTMLElement[] {
    const blocks: HTMLElement[] = [];
    for (const node of element.childNodes) {
        if (!(node instanceof HTMLElement)) {
            continue;
        }
        if (node.rawTagName === "w:sdt") {
            const content = child(node, "w:sdtContent");
            if (content) {
                blocks.push(...blockChildren(content, name));
            }
        } else if (node.rawTagName === "w:customXml") {
            blocks.push(...blockChildren(node, name));
        } else if (!name || node.rawTagName === name) {
            blocks.push(node);
        }
    }
    return blocks;
}

function children(element: HTMLElement | undefined, name: string) {
    return element?.children.filter((node) => node.rawTagName === name) ?? [];
}

function child(element: HTMLElement | undefined, name: string) {
    return element?.children.find((node) => node.rawTagName === name);
}

function findDescendant(element: HTMLElement, name: string): HTMLElement | undefined {
    for (const node of element.children) {
        if (node.rawTagName === name) {
            return node;
        }
        const found = findDescendant(node, name);
        if (found) {
            return found;
        }
    }
    return undefined;
}

function attribute(element: HTMLElement | undefined, name: string) {
    return element?.getAttribute(name);
}
