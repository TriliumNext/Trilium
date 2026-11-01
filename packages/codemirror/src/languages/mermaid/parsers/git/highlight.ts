import { styleTags } from "@lezer/highlight";
import { gitTags } from "../../tags/index.js";

export const gitHighlighting = styleTags({
    "DiagramName": gitTags.diagramName,
    "CommitKeyword BranchKeyword CheckoutKeyword MergeKeyword CherryPickKeyword":
    gitTags.keyword,
    "Direction": gitTags.direction,
    "BranchName": gitTags.branchName,
    "OptionKey": gitTags.optionKey,
    "String": gitTags.string,
    "Number": gitTags.number,
    "Value": gitTags.value,
    "LineComment": gitTags.lineComment
});
