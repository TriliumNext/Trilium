import { FindAndReplaceEditing, type ModelPosition, Plugin } from "ckeditor5";

/**
 * The position that "Search in note" shows: the start of the highlighted find result, or the
 * position that `show()` sets for a match that no find result marks, such as a match inside a
 * content embed. Plugins that hide content, such as collapsible blocks and tabs, reveal what holds
 * this position.
 */
export default class FindReveal extends Plugin {

    static get pluginName() {
        return "FindReveal" as const;
    }

    /**
     * The position to reveal, or `null` while the find shows no match.
     *
     * @observable
     * @readonly
     */
    declare position: ModelPosition | null;

    private highlighted: ModelPosition | null = null;
    private shown: ModelPosition | null = null;

    init() {
        this.set("position", null);

        // FindAndReplaceEditing can load after this plugin, and creates its state in its init().
        this.listenTo(this.editor, "ready", () => {
            const plugins = this.editor.plugins;
            const state = plugins.has(FindAndReplaceEditing)
                ? plugins.get(FindAndReplaceEditing).state
                : undefined;
            if (!state) {
                return;
            }

            this.listenTo(state, "change:highlightedResult", (_evt, _name, result) => {
                this.highlighted = result?.marker?.getStart() ?? null;
                this.update();
            });
        });
    }

    /** Reveals `position` while no find result is highlighted. `null` stops revealing it. */
    show(position: ModelPosition | null) {
        this.shown = position;
        this.update();
    }

    private update() {
        this.position = this.highlighted ?? this.shown;
    }

}

declare module "ckeditor5" {
    interface PluginsMap {
        [FindReveal.pluginName]: FindReveal;
    }
}
