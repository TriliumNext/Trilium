import { styleTags, tags as t } from "@lezer/highlight";
import { mindmapTags } from "../../tags/index.js";

export const mindmapHighlighting = styleTags({
    "( ) (( )) {{ }}": t.paren,
    "[ ]": t.squareBracket,
    ":: :::": t.punctuation,
    "DiagramName": mindmapTags.diagramName,
    "Directive": mindmapTags.directive,
    "Icon": mindmapTags.keyword,
    "LineComment": mindmapTags.lineComment,
    "LineText1": mindmapTags.lineText1,
    "LineText2": mindmapTags.lineText2,
    "LineText3": mindmapTags.lineText3,
    "LineText4": mindmapTags.lineText4,
    "LineText5": mindmapTags.lineText5,
    [lineTextsIn("NodeId")]: mindmapTags.nodeId,
    [lineTextsIn("IconLine")]: mindmapTags.icon,
    [lineTextsIn("ClassLine")]: mindmapTags.className
});

/** A selector for the text of a line, whatever its level, as a child of `parent`. */
function lineTextsIn(parent: string) {
    return [ 1, 2, 3, 4, 5 ].map((level) => `${parent}/LineText${level}`).join(" ");
}
