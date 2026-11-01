import { styleTags } from "@lezer/highlight";

import { ishikawaTags } from "../../tags/index.js";

export const ishikawaHighlighting = styleTags({
    Category: ishikawaTags.category,
    DiagramName: ishikawaTags.diagramName,
    Effect: ishikawaTags.effect,
    LineComment: ishikawaTags.lineComment
});
