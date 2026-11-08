import { styleTags } from "@lezer/highlight";
import { stateTags } from "../../tags/index.js";

export const stateHighlighting = styleTags({
    "DiagramName": stateTags.diagramName,
    "State NoteKw As Of Left Right DirectionKw": stateTags.keyword,
    "StartEnd": stateTags.startEnd,
    "StateName DirectionValue": stateTags.stateName,
    "Arrow": stateTags.arrow,
    "LabelText": stateTags.label,
    "String": stateTags.string,
    "Annotation": stateTags.annotation,
    "LineComment": stateTags.lineComment
});
