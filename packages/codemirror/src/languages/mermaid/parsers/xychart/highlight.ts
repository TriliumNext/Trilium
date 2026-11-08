import { styleTags } from "@lezer/highlight";
import { xychartTags } from "../../tags/index.js";

export const xychartHighlighting = styleTags({
    "DiagramName": xychartTags.diagramName,
    "Orientation": xychartTags.orientation,
    "Title XAxis YAxis Bar Line": xychartTags.keyword,
    "String": xychartTags.string,
    "Number": xychartTags.number,
    "Word": xychartTags.text,
    "Arrow": xychartTags.arrow,
    "LineComment": xychartTags.lineComment
});
