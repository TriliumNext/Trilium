import { styleTags } from "@lezer/highlight";

import { wardleyTags } from "../../tags/index.js";

export const wardleyHighlighting = styleTags({
    "Arrow Port": wardleyTags.arrow,
    "DiagramName": wardleyTags.diagramName,
    "Keyword": wardleyTags.keyword,
    "LineComment": wardleyTags.lineComment,
    "LinkLabel": wardleyTags.linkLabel,
    "Name": wardleyTags.name,
    "Number": wardleyTags.number,
    "Strategy": wardleyTags.strategy,
    "String": wardleyTags.string,
    "TitleText": wardleyTags.titleText,
    "[ ] ( ) { }": wardleyTags.bracket,
    ', @ "/"': wardleyTags.separator
});
