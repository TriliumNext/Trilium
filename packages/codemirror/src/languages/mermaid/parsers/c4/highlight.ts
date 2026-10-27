import { styleTags } from "@lezer/highlight";
import { c4Tags } from "../../tags/index.js";

export const c4Highlighting = styleTags({
    DiagramName: c4Tags.diagramName,
    Title: c4Tags.keyword,
    TitleText: c4Tags.titleText,
    FunctionName: c4Tags.functionName,
    Value: c4Tags.identifier,
    Key: c4Tags.key,
    String: c4Tags.string,
    LineComment: c4Tags.lineComment
});
