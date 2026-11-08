import { styleTags } from "@lezer/highlight";
import { classTags } from "../../tags/index.js";

export const classHighlighting = styleTags({
    "DiagramName": classTags.diagramName,
    "Class NoteKw For DirectionKw": classTags.keyword,
    "ClassName": classTags.className,
    "RelationArrow": classTags.arrow,
    "Member LabelText": classTags.member,
    "DirectionValue": classTags.member,
    "String": classTags.string,
    "Annotation": classTags.annotation,
    "LineComment": classTags.lineComment
});
