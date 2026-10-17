import { styleTags } from "@lezer/highlight";
import { journeyTags } from "../../tags/index.js";

export const journeyHighlighting = styleTags({
    "DiagramName": journeyTags.diagramName,
    "Text TaskName": journeyTags.text,
    "Actor": journeyTags.actor,
    "Keyword": journeyTags.keyword,
    "LineComment": journeyTags.lineComment,
    "Score": journeyTags.score
});
