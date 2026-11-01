import { styleTags } from "@lezer/highlight";
import { erTags } from "../../tags/index.js";

export const erHighlighting = styleTags({
    DiagramName: erTags.diagramName,
    EntityName: erTags.entity,
    AttrType: erTags.attributeType,
    AttrName: erTags.attributeName,
    KeyType: erTags.keyType,
    RelationshipToken: erTags.relationship,
    LabelText: erTags.label,
    String: erTags.string,
    LineComment: erTags.lineComment
});
