import { styleTags } from "@lezer/highlight";

import { eventModelingTags } from "../../tags/index.js";

export const eventModelingHighlighting = styleTags({
    "DataBlock InlineData": eventModelingTags.data,
    "DiagramName": eventModelingTags.diagramName,
    "FrameId": eventModelingTags.frameId,
    "Keyword": eventModelingTags.keyword,
    "LineComment": eventModelingTags.lineComment,
    "Name": eventModelingTags.name,
    "Type": eventModelingTags.type,
    "->>": eventModelingTags.arrow,
    "[[ ]] `": eventModelingTags.bracket,
    ".": eventModelingTags.separator
});
