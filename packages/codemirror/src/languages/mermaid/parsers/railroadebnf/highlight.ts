import { styleTags, tags as t } from "@lezer/highlight";

import { railroadTags } from "../../tags/index.js";

export const railroadEbnfHighlighting = styleTags({
    "DiagramName": railroadTags.diagramName,
    "Keyword": railroadTags.keyword,
    "LineComment": railroadTags.lineComment,
    "NonTerminal": railroadTags.reference,
    "Postfix Exception/\"-\" \"|\"": railroadTags.operator,
    "RuleName": t.definition(railroadTags.reference),
    "Special": railroadTags.special,
    "String": railroadTags.string,
    "TitleText": railroadTags.titleText,
    "= ::=": railroadTags.definitionOperator,
    "( ) [ ] { }": railroadTags.bracket,
    ", ;": railroadTags.separator
});
