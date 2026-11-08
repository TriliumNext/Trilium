import { styleTags } from "@lezer/highlight";

import { vennTags } from "../../tags/index.js";

export const vennHighlighting = styleTags({
    "Color": vennTags.color,
    "DiagramName": vennTags.diagramName,
    "Keyword": vennTags.keyword,
    "Label": vennTags.label,
    "LineComment": vennTags.lineComment,
    "Name": vennTags.name,
    "Number": vennTags.number,
    "Property": vennTags.property,
    "String": vennTags.string,
    "TitleText": vennTags.titleText,
    ": ,": vennTags.separator
});
