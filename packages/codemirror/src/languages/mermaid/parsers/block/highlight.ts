import { styleTags } from "@lezer/highlight";
import { blockTags } from "../../tags/index.js";

export const blockHighlighting = styleTags({
    "DiagramName": blockTags.diagramName,
    "ColumnsKeyword SpaceKeyword BlockKeyword EndKeyword": blockTags.keyword,
    "NodeId": blockTags.nodeId,
    "Shape": blockTags.nodeText,
    "EdgeLabel": blockTags.arrowText,
    "Arrow": blockTags.arrow,
    "Number": blockTags.number,
    "LineComment": blockTags.lineComment
});
