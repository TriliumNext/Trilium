import { Collection, Command, Plugin } from "ckeditor5";

import type { SnippetDefinition } from "./snippetsconfig.js";

/**
 * The headless half of the snippets feature: it owns the command that inserts a snippet's HTML at the
 * caret, and a live {@link Collection} of snippet definitions that the UI renders from.
 *
 * The collection is the key to dynamic reloading. The premium `Template` plugin this replaces read
 * its definitions once at startup, so any change to a snippet note forced the whole editor to be
 * rebuilt. Here the client instead calls {@link setDefinitions} whenever snippet notes change, and the
 * bound UI updates in place.
 */
export default class SnippetsEditing extends Plugin {

    /**
     * The live list of snippet definitions. The UI binds its list rows to this collection, so
     * mutating it (via {@link setDefinitions}) reflects in the open editor without recreating it.
     */
    public readonly definitions = new Collection<SnippetDefinition>();

    static get pluginName() {
        return "SnippetsEditing" as const;
    }

    public init(): void {
        const editor = this.editor;

        editor.commands.add("insertTemplate", new InsertSnippetCommand(editor));

        const initial = editor.config.get("snippets.definitions") ?? [];
        this.setDefinitions(initial);
    }

    /**
     * Replaces the current snippet definitions. Safe to call on a live editor: the bound UI list
     * re-renders in place, so titles, icons, descriptions and additions/removals apply immediately.
     */
    public setDefinitions(definitions: ReadonlyArray<SnippetDefinition>): void {
        this.definitions.clear();
        this.definitions.addMany([...definitions]);
    }
}

/**
 * Inserts a snippet's HTML at the current selection. The payload is either an HTML string or a
 * callback returning one — the callback form lets snippet content stay live without rebuilding the
 * definition.
 */
class InsertSnippetCommand extends Command {

    public override execute(data: string | (() => string)): void {
        const editor = this.editor;
        const html = typeof data === "function" ? data() : data;

        if (typeof html !== "string") {
            return;
        }

        editor.model.change(() => {
            const viewFragment = editor.data.processor.toView(html);
            const modelFragment = editor.data.toModel(viewFragment);
            editor.model.insertContent(modelFragment);
        });
    }
}
