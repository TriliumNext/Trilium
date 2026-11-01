import { styleTags } from "@lezer/highlight";
import { kanbanTags } from "../../tags/index.js";

export const kanbanHighlighting = styleTags({
    DiagramName: kanbanTags.diagramName,
    ColumnTitle: kanbanTags.columnTitle,
    NodeId: kanbanTags.nodeId,
    CardText: kanbanTags.cardText,
    Metadata: kanbanTags.metadata,
    LineComment: kanbanTags.lineComment
});
