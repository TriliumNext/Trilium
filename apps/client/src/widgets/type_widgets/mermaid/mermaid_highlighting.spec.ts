import { DIAGRAM_PARSERS } from "@triliumnext/codemirror/src/languages/mermaid/index.js";
import {
    parser as dispatcher
} from "@triliumnext/codemirror/src/languages/mermaid/parsers/mermaid/parser.js";
import mermaid from "mermaid";
import { describe, expect, it } from "vitest";

import SAMPLE_DIAGRAMS from "./sample_diagrams";

/**
 * The node the dispatcher grammar of the Mermaid language reads each diagram type as, keyed by
 * Mermaid's detector id. `DIAGRAM_PARSERS` mounts the diagram's own grammar on that node.
 */
const HIGHLIGHTED_AS: Record<string, string> = {
    "agentflow": "AgentflowDiagram",
    "architecture": "ArchitectureDiagram",
    "block": "BlockDiagram",
    "c4": "C4Diagram",
    "classDiagram": "ClassDiagram",
    "cynefin": "CynefinDiagram",
    "er": "ERDiagram",
    "eventmodeling": "EventModelingDiagram",
    "flowchart-elk": "FlowchartDiagram",
    "flowchart-v2": "FlowchartDiagram",
    "gantt": "GanttDiagram",
    "gitGraph": "GitDiagram",
    "ishikawa": "IshikawaDiagram",
    "journey": "JourneyDiagram",
    "kanban": "KanbanDiagram",
    "mindmap": "MindmapDiagram",
    "packet": "PacketDiagram",
    "pie": "PieDiagram",
    "quadrantChart": "QuadrantDiagram",
    "radar": "RadarDiagram",
    "railroad": "RailroadDiagram",
    "railroadAbnf": "RailroadAbnfDiagram",
    "railroadEbnf": "RailroadEbnfDiagram",
    "railroadPeg": "RailroadPegDiagram",
    "requirement": "RequirementDiagram",
    "sankey": "SankeyDiagram",
    "sequence": "SequenceDiagram",
    "stateDiagram": "StateDiagram",
    "swimlane": "FlowchartDiagram",
    "timeline": "TimelineDiagram",
    "treemap": "TreemapDiagram",
    "treeView": "TreeViewDiagram",
    "usecase": "UsecaseDiagram",
    "venn": "VennDiagram",
    "wardley": "WardleyDiagram",
    "xychart": "XYChartDiagram"
};

/**
 * Detector ids that need no highlighting: Mermaid's internal ones, and `info`, which only prints
 * Mermaid's version.
 */
const NOT_HIGHLIGHTED = new Set([ "error", "---", "info" ]);

/** Code for the types `SAMPLE_DIAGRAMS` has no sample of. */
const UNSAMPLED_CODE = [
    "flowchart-elk TD\n  A --> B",
    "railroad-ebnf-beta\n  a = \"x\";",
    "railroad-abnf-beta\n  a = \"x\";",
    "railroad-peg-beta\n  a <- \"x\";"
];

describe("Mermaid highlighting", () => {
    it("has a grammar for every diagram type Mermaid registers", async () => {
        // `mermaid.parse()` registers the built-in diagrams on first use.
        await mermaid.parse("info");
        const registered = mermaid.getRegisteredDiagramsMetadata()
            .map(({ id }) => id)
            .filter((id) => !NOT_HIGHLIGHTED.has(id));
        expect(registered.filter((id) => !(id in HIGHLIGHTED_AS))).toEqual([]);

        const checked = new Set<string>();
        const samples = SAMPLE_DIAGRAMS.map(({ content }) => content);
        for (const code of [ ...samples, ...UNSAMPLED_CODE ]) {
            const id = mermaid.detectType(code);
            const node = dispatcher.parse(code).topNode.lastChild?.name ?? "";
            expect({ id, node }).toEqual({ id, node: HIGHLIGHTED_AS[id] });
            expect(DIAGRAM_PARSERS[node], node).toBeDefined();
            checked.add(id);
        }
        expect(registered.filter((id) => !checked.has(id))).toEqual([]);
    });
});
