import { styleTags } from "@lezer/highlight";

import { treeViewTags } from "../../tags/index.js";

export const treeViewHighlighting = styleTags({
    "ClassAnnotation": treeViewTags.className,
    "Description": treeViewTags.description,
    "DiagramName": treeViewTags.diagramName,
    "Icon": treeViewTags.icon,
    "Keyword": treeViewTags.keyword,
    "LineComment": treeViewTags.lineComment,
    "Name String": treeViewTags.name,
    "TitleText": treeViewTags.titleText
});
