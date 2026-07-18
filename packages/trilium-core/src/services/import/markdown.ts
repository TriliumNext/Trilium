import { renderToHtml as renderToHtmlShared } from "@triliumnext/commons/src/lib/markdown_renderer.js";

import { sanitizeHtml } from "../sanitizer.js";
import { getTaskStates } from "../task_states.js";

function renderToHtml(content: string, title: string, opts?: { obsidian?: boolean }): string {
    return renderToHtmlShared(content, title, {
        sanitize: sanitizeHtml,
        taskStates: getTaskStates(),
        obsidian: opts?.obsidian
    });
}

export default {
    renderToHtml
};
