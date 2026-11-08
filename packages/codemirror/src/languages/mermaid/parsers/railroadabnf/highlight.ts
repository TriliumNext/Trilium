import { styleTags, tags as t } from "@lezer/highlight";

import { railroadTags } from "../../tags/index.js";

export const railroadAbnfHighlighting = styleTags({
    "DiagramName": railroadTags.diagramName,
    "Keyword": railroadTags.keyword,
    "LineComment": railroadTags.lineComment,
    "NonTerminal": railroadTags.reference,
    "NumVal Repeat": railroadTags.number,
    "RuleName": t.definition(railroadTags.reference),
    "String": railroadTags.string,
    "TitleText": railroadTags.titleText,
    "=": railroadTags.definitionOperator,
    "\"/\"": railroadTags.operator,
    "( ) [ ]": railroadTags.bracket,
    ";": railroadTags.separator
});
