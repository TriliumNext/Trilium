import { renderToHtml as renderToHtmlShared } from "@triliumnext/commons";

import { sanitizeHtml } from "../sanitizer.js";
import { getTaskStates } from "../task_states.js";

function renderToHtml(content: string, title: string): string {
    return renderToHtmlShared(content, title, {
        sanitize: sanitizeHtml,
        taskStates: getTaskStates()
    });
}

export default {
    renderToHtml
};
