import { styleTags } from "@lezer/highlight";
import { sankeyTags } from "../../tags/index.js";

export const sankeyHighlighting = styleTags({
    DiagramName: sankeyTags.diagramName,
    Field: sankeyTags.node,
    Value: sankeyTags.number
});
