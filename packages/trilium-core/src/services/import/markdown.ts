import { renderToHtml as renderToHtmlShared } from "@triliumnext/commons";

import { sanitizeHtml } from "../sanitizer.js";

function renderToHtml(content: string, title: string): string {
    return renderToHtmlShared(content, title, { sanitize: sanitizeHtml });
}

export default {
    renderToHtml
};
