import { getSql } from "@triliumnext/core";
import { initShare } from "@triliumnext/core/src/share/index.js";
import template404 from "@triliumnext/share-theme/templates/404.ejs?raw";
import templatePage from "@triliumnext/share-theme/templates/page.ejs?raw";
import templatePrevNext from "@triliumnext/share-theme/templates/prev_next.ejs?raw";
import templateTocItem from "@triliumnext/share-theme/templates/toc_item.ejs?raw";
import templateTreeItem from "@triliumnext/share-theme/templates/tree_item.ejs?raw";

/**
 * The share theme's templates, bundled rather than read from disk: this build has no filesystem to
 * read them from, and they are small enough that the lazy share chunk can carry them whole.
 */
const TEMPLATES: Record<string, string> = {
    "404": template404,
    page: templatePage,
    prev_next: templatePrevNext,
    toc_item: templateTocItem,
    tree_item: templateTreeItem
};

let registered = false;

/**
 * Registers the share subsystem against this build: one database connection rather than the
 * server's separate read-only one, and bundled templates.
 */
export function registerShareProvider() {
    if (registered) {
        return;
    }

    initShare({
        sql: {
            getRawRows: (query, params = []) => getSql().getRawRows(query, params),
            getRow: (query, params = []) => getSql().getRow(query, params),
            getColumn: (query, params = []) => getSql().getColumn(query, params)
        },
        readTemplate,
        // A shared note's own EJS template runs arbitrary JavaScript in the renderer. The server
        // gates that on backend scripting being enabled; this build has no such setting and no
        // backend scripting, so a note's template is never executed.
        isScriptingEnabled: () => false,
        // The share cache reads the same connection every other route does, so it is ready as soon
        // as the worker answers at all.
        isReady: () => true
    });
    registered = true;
}

function readTemplate(name: string) {
    const template = TEMPLATES[name];

    if (template === undefined) {
        throw new Error(`Unknown share template '${name}'.`);
    }

    return template;
}
