import type { Request } from "express";

import markdownService from "../../services/import/markdown.js";
import markdown from "../../services/export/markdown.js";
import { RenderMarkdownResponse, ToMarkdownResponse } from "@triliumnext/commons";

function renderMarkdown(req: Request) {
    const { markdownContent } = req.body;
    if (!markdownContent || typeof markdownContent !== 'string') {
        throw new Error('markdownContent parameter is required and must be a string');
    }
    return {
        htmlContent: markdownService.renderToHtml(markdownContent, "")
    } satisfies RenderMarkdownResponse;
}

function toMarkdown(req: Request) {
    const { htmlContent } = req.body;
    if (!htmlContent || typeof htmlContent !== 'string') {
        throw new Error('htmlContent parameter is required and must be a string');
    }
    return {
        markdownContent: markdown.toMarkdown(htmlContent)
    } satisfies ToMarkdownResponse;
}

export default {
    renderMarkdown,
    toMarkdown
};
