import { type Command, createDropdown, type Locale, MenuBarMenuListItemButtonView, MenuBarMenuListItemView, MenuBarMenuListView, MenuBarMenuView, Plugin, SearchTextView } from "ckeditor5";

import SnippetsEditing from "./snippetsediting.js";
import SnippetListView from "./snippetlistview.js";
import templateIcon from "./theme/icons/template.svg?raw";
import "./theme/snippets.css";

/**
 * Registers the snippet UI: the `insertTemplate` toolbar dropdown (a searchable list) and the
 * `menuBar:insertTemplate` menu entry. Both render from {@link SnippetsEditing}'s live definition
 * collection, so snippet changes appear without recreating the editor.
 *
 * The user-facing strings say "text snippet" rather than the "template" wording of the premium
 * plugin this replaces. They used to reuse premium's English ids verbatim and be relabelled by a
 * global override; with the message ids being Trilium's own now, they simply say what they mean.
 */
export default class SnippetsUI extends Plugin {

    static get requires() {
        return [SnippetsEditing] as const;
    }

    static get pluginName() {
        return "SnippetsUI" as const;
    }

    public init(): void {
        const editor = this.editor;
        const t = editor.t;
        const editing = editor.plugins.get(SnippetsEditing);

        const insert = (data: string | (() => string)) => {
            editor.execute("insertTemplate", data);
            editor.editing.view.focus();
        };

        editor.ui.componentFactory.add("insertTemplate", (locale) => {
            // Cast (rather than guard) since `SnippetsUI` requires `SnippetsEditing`, which registers
            // the command in its `init()`; it is always present by the time the UI is built.
            const command = editor.commands.get("insertTemplate") as Command;
            const dropdownView = createDropdown(locale);

            const listView = new SnippetListView(locale, editing.definitions, (definition) => insert(definition.data));

            const searchView = new SearchTextView(locale, {
                filteredView: listView,
                queryView: {
                    label: t("Search text snippet")
                },
                class: "ck-template-form",
                infoView: {
                    text: {
                        notFound: {
                            primary: (query) => t("No text snippets were found matching \"%0\".", query as string),
                            secondary: t("Please try a different phrase or check the spelling.")
                        },
                        noSearchableItems: {
                            primary: t("No text snippets available.")
                        }
                    }
                }
            });

            searchView.on("search", (evt, data: { query: string; resultsCount: number }) => {
                if (data.query.length) {
                    // Phrased with the count last rather than as "%0 text snippets found", which
                    // would need a plural form: this is announced for every result count, one
                    // included, and the message dictionary has no plural handling.
                    editor.ui.ariaLiveAnnouncer.announce(t("Text snippets found: %0", data.resultsCount));
                }
            });

            dropdownView.bind("isEnabled").to(command);
            dropdownView.panelView.children.add(searchView);
            dropdownView.buttonView.set({
                label: t("Insert text snippet"),
                icon: templateIcon,
                tooltip: true
            });

            // Clear the query (and thus the filter/highlight) each time the dropdown is closed.
            dropdownView.on("change:isOpen", (evt, name, isOpen) => {
                if (!isOpen) {
                    searchView.reset();
                }
            });

            return dropdownView;
        });

        editor.ui.componentFactory.add("menuBar:insertTemplate", (locale) => {
            const command = editor.commands.get("insertTemplate") as Command;
            const menuView = new MenuBarMenuView(locale);
            menuView.buttonView.set({
                label: t("Text snippet"),
                icon: templateIcon
            });

            const listView = new MenuBarMenuListView(locale);
            this._populateMenuList(locale, listView, menuView, insert);

            // Rebuild the menu whenever the snippet set changes (kept in sync with the toolbar list).
            this.listenTo(editing.definitions, "change", () => {
                this._populateMenuList(locale, listView, menuView, insert);
            });

            menuView.panelView.children.add(listView);
            menuView.bind("isEnabled").to(command, "isEnabled");

            return menuView;
        });
    }

    private _populateMenuList(locale: Locale, listView: MenuBarMenuListView, menuView: MenuBarMenuView, insert: (data: string | (() => string)) => void): void {
        const editor = this.editor;
        const t = editor.t;
        const definitions = editor.plugins.get(SnippetsEditing).definitions;

        // Destroy the previous menu items before replacing them; `clear()` alone only detaches, so a
        // live snippet change would otherwise leak the old buttons and their listeners.
        const previous = [...listView.items];
        listView.items.clear();
        for (const item of previous) {
            item.destroy();
        }

        if (!definitions.length) {
            const emptyItem = new MenuBarMenuListItemView(locale, menuView);
            const emptyButton = new MenuBarMenuListItemButtonView(locale);
            emptyButton.set({ label: t("No text snippets available."), isEnabled: false });
            emptyItem.children.add(emptyButton);
            listView.items.add(emptyItem);
            return;
        }

        for (const definition of definitions) {
            const item = new MenuBarMenuListItemView(locale, menuView);
            const button = new MenuBarMenuListItemButtonView(locale);
            // No per-item note icon here: `MenuBarMenuListItemButtonView` only accepts an SVG icon,
            // and Trilium does not enable CKEditor's menu bar, so this surface is never shown anyway.
            button.set({
                class: "ck-template-button",
                label: definition.title
            });
            button.delegate("execute").to(menuView);
            button.on("execute", () => insert(definition.data));
            item.children.add(button);
            listView.items.add(item);
        }
    }
}
