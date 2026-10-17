import { ExternalTokenizer, type InputStream } from "@lezer/lr";
import {
    accBlockText,
    accDescrKeyword,
    AccText,
    accTitleKeyword,
    diagramRest,
    Directive,
    FrontMatterContent,
    frontMatterEnd,
    frontMatterStart,
    preDiagramLine,
    MindmapDiagram,
    pieText,
    flowchartText,
    sequenceText,
    journeyText,
    requirementText,
    ganttText,
    TimelineDiagram,
    quadrantText,
    radarText,
    treemapText,
    treeViewText,
    wardleyText,
    cynefinText,
    EventModelingDiagram,
    railroadText,
    railroadEbnfText,
    railroadAbnfText,
    railroadPegText,
    IshikawaDiagram,
    VennDiagram,
    usecaseText,
    agentflowText,
    SankeyDiagram,
    xyChartText,
    packetText,
    KanbanDiagram,
    BlockDiagram,
    architectureText,
    classText,
    stateText,
    erText,
    gitText,
    c4Text,
    LineComment
} from "./parser.terms.js";

const skipCodePoints = [ -1, 9, 13, 32 ];

// Order matters: more specific keys are listed before the generic prefixes they
// share (e.g. `sankey-beta` before `sankey`). Every key that is a prefix of
// another still maps to the same diagram, so ties resolve to the correct type.
const diagramMap: Record<string, number> = {
    "mindmap": MindmapDiagram,
    "pie": pieText,
    "flowchart": flowchartText,
    "graph": flowchartText,
    "sequenceDiagram": sequenceText,
    "journey": journeyText,
    "requirementDiagram": requirementText,
    "gantt": ganttText,
    "timeline": TimelineDiagram,
    "quadrantChart": quadrantText,
    "radar-beta": radarText,
    "treemap-beta": treemapText,
    "treemap": treemapText,
    "treeView-beta": treeViewText,
    "wardley-beta": wardleyText,
    "cynefin-beta": cynefinText,
    "eventmodeling": EventModelingDiagram,
    "railroad-beta": railroadText,
    "railroad-ebnf-beta": railroadEbnfText,
    "railroad-abnf-beta": railroadAbnfText,
    "railroad-peg-beta": railroadPegText,
    "ishikawa-beta": IshikawaDiagram,
    "ishikawa": IshikawaDiagram,
    "venn-beta": VennDiagram,
    "usecase-beta": usecaseText,
    "swimlane-beta": flowchartText,
    "agentflow-beta": agentflowText,
    "sankey-beta": SankeyDiagram,
    "sankey": SankeyDiagram,
    "xychart-beta": xyChartText,
    "xychart": xyChartText,
    "packet-beta": packetText,
    "packet": packetText,
    "kanban": KanbanDiagram,
    "block-beta": BlockDiagram,
    "block": BlockDiagram,
    "architecture-beta": architectureText,
    "architecture": architectureText,
    "classDiagram-v2": classText,
    "classDiagram": classText,
    "stateDiagram-v2": stateText,
    "stateDiagram": stateText,
    "erDiagram": erText,
    "gitGraph": gitText,
    "C4Context": c4Text,
    "C4Container": c4Text,
    "C4Component": c4Text,
    "C4Dynamic": c4Text,
    "C4Deployment": c4Text
};

const diagrams = Object.keys(diagramMap);

// The diagrams whose Mermaid parser stores accTitle and accDescr. Timeline and kanban read those
// lines as content; mindmap, sankey and block reject them.
const accessibleDiagrams = new Set([
    pieText, flowchartText, sequenceText, journeyText, requirementText, ganttText, quadrantText,
    radarText, treemapText, treeViewText, xyChartText, packetText, architectureText, classText,
    stateText, erText, gitText, c4Text, wardleyText, cynefinText, railroadText, railroadEbnfText,
    railroadAbnfText, railroadPegText, usecaseText, agentflowText
]);

/**
 * Splits front matter into its `---` lines and the YAML between them. Like Mermaid, it takes a
 * `---` line as the opening only at the start of the document (the only place the grammar can
 * shift `frontMatterStart`) and only when a closing `---` line follows; otherwise the lines go
 * to `diagramText`.
 */
export const frontMatter = new ExternalTokenizer((input, stack) => {
    if (stack.canShift(frontMatterStart)) {
        const opening = dashLineLength(input, 0);
        if (opening > 0 && findClosingLine(input, opening) >= 0) {
            input.acceptToken(frontMatterStart, opening);
        }
    } else {
        const closing = findClosingLine(input, 0);
        if (closing > 0) {
            input.acceptToken(FrontMatterContent, closing);
        } else {
            input.acceptToken(frontMatterEnd, dashLineLength(input, 0));
        }
    }
});

export const diagramText = new ExternalTokenizer((input) => {
    if (skipCodePoints.includes(input.next)) return;

    if (input.next === 37 && input.peek(1) === 37) {
        const directiveLength = input.peek(2) === 123 ? findDirectiveLength(input) : -1;
        if (directiveLength > 0) {
            input.acceptToken(Directive, directiveLength);
        } else {
            input.acceptToken(LineComment, lineLength(input));
        }
        return;
    }

    let tokens = "";

    while (input.next != 10 && input.next !== -1) {
        tokens += String.fromCodePoint(input.next);
        input.advance();
    }

    input.advance();

    const activeDiagram = diagrams.filter((diagram) => {
        return tokens.startsWith(diagram);
    });

    if (activeDiagram.length > 0) {
        const diagram = diagramMap[activeDiagram[0]];
        if (accessibleDiagrams.has(diagram)) {
            input.acceptToken(diagram, bodyLength(input, 0));
            return;
        }
        while (input.next !== -1) {
            input.advance();
        }
        input.acceptToken(diagram);
    } else {
        input.acceptToken(preDiagramLine);
    }
});

/**
 * Splits the body of a diagram in `accessibleDiagrams` at its `accTitle:`, `accDescr:` and
 * `accDescr { … }` lines, which Mermaid reads only at the start of a line.
 */
export const accessibility = new ExternalTokenizer((input, stack) => {
    if (input.next === -1) return;

    if (stack.canShift(accBlockText)) {
        let length = 0;
        while (input.peek(length) !== 125 && input.peek(length) !== -1) length++;
        input.acceptToken(accBlockText, length);
    } else if (stack.canShift(AccText) && input.next !== 10) {
        input.acceptToken(AccText, lineLength(input));
    } else {
        const keyword = accessibilityKeyword(input, 0);
        if (keyword) {
            input.acceptToken(keyword, 8);
        } else {
            const lineEnd = lineLength(input);
            const nextLine = lineEnd + (input.peek(lineEnd) === 10 ? 1 : 0);
            input.acceptToken(diagramRest, bodyLength(input, nextLine));
        }
    }
});

/**
 * The length of the `%%{…}%%` directive at the stream position, which can span lines; -1 when it
 * has no closing `}%%`.
 */
export function findDirectiveLength(input: InputStream) {
    for (let offset = 3; input.peek(offset) !== -1; offset++) {
        const closes = input.peek(offset) === 125 && input.peek(offset + 1) === 37
            && input.peek(offset + 2) === 37;
        if (closes) return offset + 3;
    }
    return -1;
}

/** The length of the rest of the line at the stream position, newline excluded. */
export function lineLength(input: InputStream) {
    let length = 0;
    while (input.peek(length) !== 10 && input.peek(length) !== -1) length++;
    return length;
}

/**
 * The offset of the first line at or after `offset`, a line start, that opens an accessibility
 * statement; the end of the input when none does.
 */
function bodyLength(input: InputStream, offset: number) {
    while (input.peek(offset) !== -1) {
        let start = offset;
        while (input.peek(start) === 32 || input.peek(start) === 9) start++;
        if (accessibilityKeyword(input, start)) return offset;
        while (input.peek(offset) !== 10 && input.peek(offset) !== -1) offset++;
        if (input.peek(offset) === 10) offset++;
    }
    return offset;
}

/**
 * The keyword token of the accessibility statement at `offset`: `accTitle` followed by `:`, or
 * `accDescr` followed by `:` or `{`; 0 when there is none.
 */
function accessibilityKeyword(input: InputStream, offset: number) {
    let keyword = "";
    for (let index = 0; index < 8; index++) {
        keyword += String.fromCharCode(input.peek(offset + index));
    }
    if (keyword !== "accTitle" && keyword !== "accDescr") return 0;

    let next = offset + 8;
    while (input.peek(next) === 32 || input.peek(next) === 9) next++;
    if (input.peek(next) === 58) return keyword === "accTitle" ? accTitleKeyword : accDescrKeyword;
    return keyword === "accDescr" && input.peek(next) === 123 ? accDescrKeyword : 0;
}

/** The offset of the first `---` line at or after `offset`, or -1 when there is none. */
function findClosingLine(input: InputStream, offset: number) {
    while (input.peek(offset) !== -1) {
        if (dashLineLength(input, offset) > 0) return offset;
        while (input.peek(offset) !== 10 && input.peek(offset) !== -1) offset++;
        offset++;
    }
    return -1;
}

/**
 * The length of the line at `offset`, newline included, when it is `---` followed by nothing but
 * whitespace; otherwise 0.
 */
function dashLineLength(input: InputStream, offset: number) {
    let length = 0;
    while (length < 3) {
        if (input.peek(offset + length) !== 45) return 0;
        length++;
    }
    while ([ 9, 13, 32 ].includes(input.peek(offset + length))) length++;
    const next = input.peek(offset + length);
    if (next === 10) return length + 1;
    return next === -1 ? length : 0;
}
