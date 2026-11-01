import { styleTags, tags as t } from "@lezer/highlight";

import { railroadTags } from "../../tags/index.js";

export const railroadPegHighlighting = styleTags({
    "Any": railroadTags.special,
    "DiagramName": railroadTags.diagramName,
    "Keyword": railroadTags.keyword,
    "LineComment": railroadTags.lineComment,
    "NonTerminal": railroadTags.reference,
    "Postfix Predicate \"/\"": railroadTags.operator,
    "RuleName": t.definition(railroadTags.reference),
    "String": railroadTags.string,
    "TitleText": railroadTags.titleText,
    "<-": railroadTags.definitionOperator,
    "( )": railroadTags.bracket,
    ";": railroadTags.separator
});
