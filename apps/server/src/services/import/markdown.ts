import { renderToHtml as renderToHtmlShared } from "@triliumnext/commons";

import htmlSanitizer from "../html_sanitizer.js";

function renderToHtml(content: string, title: string): string {
    return renderToHtmlShared(content, title, { sanitize: htmlSanitizer.sanitize });
}

export default {
    renderToHtml
};
