import { styleTags } from "@lezer/highlight";

import { cynefinTags } from "../../tags/index.js";

export const cynefinHighlighting = styleTags({
    "DiagramName": cynefinTags.diagramName,
    "DomainName": cynefinTags.domainName,
    "Keyword": cynefinTags.keyword,
    "LineComment": cynefinTags.lineComment,
    "String": cynefinTags.string,
    "TitleText": cynefinTags.titleText,
    "-->": cynefinTags.arrow,
    ":": cynefinTags.separator
});
