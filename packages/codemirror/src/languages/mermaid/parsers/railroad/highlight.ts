import { styleTags, tags as t } from "@lezer/highlight";

import { railroadTags } from "../../tags/index.js";

export const railroadHighlighting = styleTags({
    "DiagramName": railroadTags.diagramName,
    "Function": t.function(railroadTags.reference),
    "Keyword": railroadTags.keyword,
    "LineComment": railroadTags.lineComment,
    "RuleName": t.definition(railroadTags.reference),
    "String": railroadTags.string,
    "TitleText": railroadTags.titleText,
    "=": railroadTags.definitionOperator,
    "( )": railroadTags.bracket,
    ", ;": railroadTags.separator
});
