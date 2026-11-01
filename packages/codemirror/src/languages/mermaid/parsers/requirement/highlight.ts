import { styleTags, tags as t } from "@lezer/highlight";
import { requirementTags } from "../../tags/index.js";

export const requirementHighlighting = styleTags({
    "{ }": t.brace,
    ":": t.punctuation,
    "DiagramName SubDiagramType": requirementTags.diagramName,
    "LineComment": requirementTags.lineComment,
    "IDNumber": requirementTags.number,
    "UnquotedString QuotedString": requirementTags.string,
    "Name/UnquotedString Name/QuotedString RelationshipStart": requirementTags.name,
    "PropKeyword": requirementTags.property,
    "Keyword": requirementTags.keyword,
    "ForwardArrow BackArrow Hyphen": requirementTags.arrow
});
