import becca from "../../becca/becca";

import { RenderMarkdownResponse, ToMarkdownResponse } from "@triliumnext/commons";
import type { Request, Response } from "../../http_interface";

import { ValidationError } from "../../errors.js";
import markdown from "../../services/export/markdown.js";
import { getIconPackGlyphCss } from "../../services/bootstrap_utils.js";
import { generateIconRegistry, getIconPacks } from "../../services/icon_packs.js";
import markdownImportService from "../../services/import/markdown.js";

function renderMarkdown(req: Request) {
    const { markdownContent } = req.body;
    if (typeof markdownContent !== 'string') {
        throw new ValidationError('markdownContent parameter is required and must be a string');
    }
    return {
        htmlContent: markdownImportService.renderToHtml(markdownContent, "")
    } satisfies RenderMarkdownResponse;
}

function toMarkdown(req: Request) {
    const { htmlContent, headerlessTables } = req.body;
    if (typeof htmlContent !== 'string') {
        throw new ValidationError('htmlContent parameter is required and must be a string');
    }
    if (headerlessTables !== undefined && headerlessTables !== "keepHtml"
            && headerlessTables !== "emptyHeader") {
        throw new ValidationError('headerlessTables must be "keepHtml" or "emptyHeader"');
    }
    return {
        markdownContent: markdown.toMarkdown(htmlContent, { headerlessTables })
    } satisfies ToMarkdownResponse;
}

function getIconUsage() {
    const iconClassToCountMap: Record<string, number> = {};

    for (const { value: iconClass, noteId } of becca.findAttributes("label", "iconClass")) {
        if (noteId.startsWith("_")) {
            continue; // ignore icons of "system" notes since they were not set by the user
        }

        if (!iconClass?.trim()) {
            continue;
        }

        for (const clazz of iconClass.trim().split(/\s+/)) {
            if (clazz === "bx") {
                continue;
            }

            iconClassToCountMap[clazz] = (iconClassToCountMap[clazz] || 0) + 1;
        }
    }

    return { iconClassToCountMap };
}

/** Every icon of each icon pack, which the icon picker searches. */
function getIconRegistry() {
    return generateIconRegistry(getIconPacks());
}

/**
 * The glyph of every icon, which the client loads after its first render. The bootstrap names it
 * by its content, so a URL always serves the same stylesheet.
 */
function serveIconPackGlyphCss(_req: Request, res: Response) {
    res.setHeader("Content-Type", "text/css");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.send(getIconPackGlyphCss());
}

export default {
    serveIconPackGlyphCss,
    getIconRegistry,
    getIconUsage,
    renderMarkdown,
    toMarkdown
}
