import { styleTags } from "@lezer/highlight";

import { usecaseTags } from "../../tags/index.js";

export const usecaseHighlighting = styleTags({
    "Arrow": usecaseTags.arrow,
    "Boolean": usecaseTags.boolean,
    "Color": usecaseTags.color,
    "DiagramName": usecaseTags.diagramName,
    "Direction": usecaseTags.direction,
    "Keyword": usecaseTags.keyword,
    "LineComment": usecaseTags.lineComment,
    "Name": usecaseTags.name,
    "Number": usecaseTags.number,
    "Stereotype": usecaseTags.stereotype,
    "String MarkdownString": usecaseTags.string,
    "( ) [ ] { } @{": usecaseTags.bracket,
    "Symbol : ::: ,": usecaseTags.punctuation
});
