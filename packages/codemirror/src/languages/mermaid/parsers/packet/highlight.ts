import { styleTags } from "@lezer/highlight";
import { packetTags } from "../../tags/index.js";

export const packetHighlighting = styleTags({
    DiagramName: packetTags.diagramName,
    Title: packetTags.keyword,
    TitleText: packetTags.titleText,
    Number: packetTags.number,
    String: packetTags.string,
    LineComment: packetTags.lineComment
});
