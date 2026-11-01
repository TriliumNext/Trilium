import { styleTags } from "@lezer/highlight";
import { architectureTags } from "../../tags/index.js";

export const architectureHighlighting = styleTags({
    "DiagramName": architectureTags.diagramName,
    "GroupKeyword ServiceKeyword JunctionKeyword InKeyword":
    architectureTags.keyword,
    "NodeId": architectureTags.nodeId,
    "Icon": architectureTags.icon,
    "Label": architectureTags.label,
    "Port": architectureTags.port,
    "Arrow": architectureTags.arrow,
    "LineComment": architectureTags.lineComment
});
