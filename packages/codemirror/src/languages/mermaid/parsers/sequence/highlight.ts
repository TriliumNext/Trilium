import { styleTags } from "@lezer/highlight";
import { sequenceTags } from "../../tags/index.js";

export const sequenceHighlighting = styleTags({
    "DiagramName": sequenceTags.diagramName,
    "NodeText": sequenceTags.nodeText,
    "Keyword1": sequenceTags.keyword1,
    "Keyword2": sequenceTags.keyword2,
    "LineComment": sequenceTags.lineComment,
    "Arrow ArrowSuffix": sequenceTags.arrow,
    "Position": sequenceTags.position,
    "MessageText1": sequenceTags.messageText1,
    "MessageText2": sequenceTags.messageText2
});
