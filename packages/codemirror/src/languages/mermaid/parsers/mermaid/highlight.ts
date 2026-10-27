import { styleTags } from "@lezer/highlight";

import { mermaidTags } from "../../tags/index.js";

export const mermaidHighlighting = styleTags({
    "AccText": mermaidTags.accessibilityText,
    "AccTitle/Keyword AccDescr/Keyword": mermaidTags.accessibilityKeyword,
    "DashLine": mermaidTags.frontMatterDelimiter,
    "Directive": mermaidTags.directive,
    "LineComment": mermaidTags.lineComment
});
