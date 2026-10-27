import { styleTags } from "@lezer/highlight";
import { quadrantTags } from "../../tags/index.js";

export const quadrantHighlighting = styleTags({
    DiagramName: quadrantTags.diagramName,
    Keyword: quadrantTags.keyword,
    Text: quadrantTags.text,
    Label: quadrantTags.label,
    Number: quadrantTags.number,
    LineComment: quadrantTags.lineComment
});
