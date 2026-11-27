import { generateBlockId, isMarkdownMime } from "@triliumnext/commons";
import {
    addMarkdownHeadingReference, findMarkdownTargets
} from "@triliumnext/commons/src/lib/markdown_references.js";

import { serverBlockHost } from "../import/markdown.js";
import { type ReferenceProvider, readContent } from "./index.js";

/**
 * The headings and anchors of Markdown notes, read from the note as it renders. A heading links
 * through `?block=` once it owns a block id, which `createReference()` writes as a block marker.
 */
const markdownReferences: ReferenceProvider = {
    isFor: (type, mime) => type === "code" && isMarkdownMime(mime),
    findTargets(source) {
        const content = readContent(source);
        return typeof content === "string" ? findMarkdownTargets(content, serverBlockHost) : [];
    },
    createReference(content, request) {
        if (typeof content !== "string" || request.kind !== "heading") {
            return null;
        }
        return addMarkdownHeadingReference(content, request, generateBlockId, serverBlockHost);
    },
    acceptsLine: true
};

export default markdownReferences;
