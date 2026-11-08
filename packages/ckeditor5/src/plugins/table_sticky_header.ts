import { Plugin } from "ckeditor5";

import { StickyTableHeaders } from "./table_sticky_header_read_only.js";

/**
 * Keeps the header rows of a table at the top of the scrolled area while the rest of the table
 * passes under them. `table_sticky_header.css` moves the rows; this plugin measures them.
 */
export default class TableStickyHeader extends Plugin {

    private readonly headers = new StickyTableHeaders();

    static get pluginName() {
        return "TableStickyHeader" as const;
    }

    init() {
        const view = this.editor.editing.view;
        this.listenTo(view, "render", () => {
            for (const domRoot of view.domRoots.values()) {
                this.headers.observe(domRoot);
            }
        });
    }

    override destroy() {
        this.headers.disconnect();
        super.destroy();
    }

}

declare module "ckeditor5" {
    interface PluginsMap {
        [TableStickyHeader.pluginName]: TableStickyHeader;
    }
}
