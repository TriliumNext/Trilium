import { styleTags, tags as t } from "@lezer/highlight";
import { flowchartTags } from "../../tags/index.js";

export const flowchartHighlighting = styleTags({
    "( )": t.paren,
    "[ ]": t.squareBracket,
    "{ }": t.brace,
    "<": t.angleBracket,
    "DiagramName": flowchartTags.diagramName,
    "DoubleEqual": flowchartTags.link,
    "DoubleHyphen": flowchartTags.link,
    "Keyword": flowchartTags.keyword,
    "LineComment": flowchartTags.lineComment,
    "Link": flowchartTags.link,
    "Metadata": flowchartTags.metadata,
    "NodeEdge": flowchartTags.nodeEdge,
    "NodeEdgeText": flowchartTags.nodeEdgeText,
    "NodeId": flowchartTags.nodeId,
    "NodeText": flowchartTags.nodeText,
    "Number": flowchartTags.number,
    "Orientation": flowchartTags.orientation,
    "String": flowchartTags.string
});
