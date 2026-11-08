import { styleTags } from "@lezer/highlight";

import { treemapTags } from "../../tags/index.js";

export const treemapHighlighting = styleTags({
    "ClassName": treemapTags.className,
    "DiagramName": treemapTags.diagramName,
    "Keyword": treemapTags.keyword,
    "LineComment": treemapTags.lineComment,
    "Number": treemapTags.number,
    "String": treemapTags.string,
    "Styles": treemapTags.styles,
    "TitleText": treemapTags.titleText,
    ": , ::: ;": treemapTags.separator
});
