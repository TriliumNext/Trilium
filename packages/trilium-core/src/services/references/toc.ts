import { MAX_TOC_DEPTH, type ReferenceTarget, type TocCache } from "@triliumnext/commons";

import BAttachment from "../../becca/entities/battachment.js";
import { findTocFormat, getToc, type TocDocumentRef, type TocFormat } from "../toc/index.js";
import type { ReferenceProvider, ReferenceSource } from "./index.js";

/**
 * The headings of every document that has a ToC format, such as the outline of a PDF file, read
 * from its ToC cache. Every heading that leads somewhere has link parameters.
 */
const tocReferences: ReferenceProvider = {
    isFor: (type, mime) => !!findTocFormat(type, mime),
    async findTargets(source) {
        const result = await getToc(toTocRef(source));
        if (result?.status === "client") {
            return { targets: [], pendingToc: { format: result.format.name } };
        }
        if (result?.status === "ready") {
            const { cache, format } = result;
            return { targets: toTargets(cache, format), blobId: cache.targetBlobHash };
        }
        return [];
    }
};

export default tocReferences;

/** Names `source` by its id, which a build resolves again after it waits. */
export function toTocRef(source: ReferenceSource): TocDocumentRef {
    return source instanceof BAttachment
        ? { kind: "attachment", attachmentId: String(source.attachmentId) }
        : { kind: "note", noteId: source.noteId };
}

/**
 * The headings of `cache` that a link can point at, as targets, then the other targets of its
 * format. A target's level is one more than the number of its ancestors that are targets, so a
 * target under a heading without a link is listed at that heading's place. Levels past
 * `MAX_TOC_DEPTH` are shown at that depth.
 */
export function toTargets(cache: TocCache, format: TocFormat): ReferenceTarget[] {
    const targets: ReferenceTarget[] = [];
    // The ancestors of the next heading, outermost first, and how many of them are targets.
    const ancestors: { level: number; isTarget: boolean }[] = [];
    let targetAncestors = 0;
    for (const heading of cache.headings) {
        while ((ancestors.at(-1)?.level ?? -Infinity) >= heading.level) {
            targetAncestors -= ancestors.pop()?.isTarget ? 1 : 0;
        }
        const params = format.getLinkParams(heading);
        if (params) {
            const level = Math.min(targetAncestors + 1, MAX_TOC_DEPTH);
            targets.push({ kind: "heading", title: heading.title, level, params });
        }
        ancestors.push({ level: heading.level, isTarget: !!params });
        targetAncestors += params ? 1 : 0;
    }
    targets.push(...format.getOtherTargets?.(cache) ?? []);
    return targets;
}
