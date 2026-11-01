import { type Collection, type FilteredView, ListItemView, ListView, type Locale } from "ckeditor5";

import type { SnippetDefinition } from "./snippetsconfig.js";
import SnippetListItemButtonView from "./snippetlistitembuttonview.js";

interface SnippetRow {
    item: ListItemView;
    button: SnippetListItemButtonView;
}

/**
 * The scrollable list of snippets shown inside the `insertTemplate` search dropdown.
 *
 * It rebuilds itself from a live {@link Collection} of definitions — adding, removing or editing a
 * snippet note re-renders the rows in place, no editor rebuild. It implements {@link FilteredView} so
 * the surrounding {@link module:ui/search/text/searchtextview~SearchTextView} can filter it by query.
 */
export default class SnippetListView extends ListView implements FilteredView {

    private readonly rows: SnippetRow[] = [];

    constructor(locale: Locale, definitions: Collection<SnippetDefinition>, insert: (definition: SnippetDefinition) => void) {
        super(locale);

        this.extendTemplate({
            attributes: {
                role: "listbox",
                class: ["ck-template-list"]
            }
        });

        this._rebuild(definitions, insert);
        this.listenTo(definitions, "change", () => this._rebuild(definitions, insert));
    }

    public filter(regExp: RegExp | null): { resultsCount: number; totalItemsCount: number } {
        let resultsCount = 0;

        for (const { item, button } of this.rows) {
            const isVisible = regExp ? !!button.isMatching(regExp) : true;

            item.isVisible = isVisible;
            button.highlightText(isVisible && regExp ? regExp : null);

            if (isVisible) {
                resultsCount++;
            }
        }

        return {
            resultsCount,
            totalItemsCount: this.rows.length
        };
    }

    public override focus(): void {
        // Focus the first *visible* row so keyboard users skip rows hidden by the current filter.
        for (const { item, button } of this.rows) {
            if (item.isVisible) {
                button.focus();
                return;
            }
        }
    }

    private _rebuild(definitions: Collection<SnippetDefinition>, insert: (definition: SnippetDefinition) => void): void {
        // `ViewCollection.clear()` only detaches its views, so destroy the previous rows (which
        // cascades to their buttons and icon/text subviews) before discarding them — otherwise
        // rebuilding on every snippet change would leak views and their `execute` listeners.
        const previous = this.rows.splice(0);
        this.items.clear();
        for (const { item } of previous) {
            item.destroy();
        }

        for (const definition of definitions) {
            const item = new ListItemView(this.locale);
            const button = new SnippetListItemButtonView(this.locale, definition);

            button.on("execute", () => insert(definition));

            item.children.add(button);
            this.items.add(item);
            this.rows.push({ item, button });
        }
    }
}
