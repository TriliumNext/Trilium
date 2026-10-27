import { styleTags, tags as t } from "@lezer/highlight";

import { radarTags } from "../../tags/index.js";

export const radarHighlighting = styleTags({
    "AxisRef": radarTags.axisRef,
    "Boolean": radarTags.boolean,
    "DiagramName": radarTags.diagramName,
    "Graticule": radarTags.graticule,
    "Keyword": radarTags.keyword,
    "LineComment": radarTags.lineComment,
    "Name": t.definition(radarTags.name),
    "Number": radarTags.number,
    "String": radarTags.string,
    "TitleText": radarTags.titleText,
    "[ ]": radarTags.squareBracket,
    "{ }": radarTags.brace,
    ", :": radarTags.separator
});
