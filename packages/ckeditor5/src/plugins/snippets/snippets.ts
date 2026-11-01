import { type Command, Plugin } from "ckeditor5";

import type { SnippetDefinition, SnippetsConfig } from "./snippetsconfig.js";
import SnippetsEditing from "./snippetsediting.js";
import SnippetsUI from "./snippetsui.js";

/**
 * Trilium's GPL replacement for the premium `Template` feature: a searchable dropdown of text
 * snippets (notes labelled `#snippet` / `#textSnippet`).
 *
 * The key difference from the premium plugin is **live reloading** — {@link updateDefinitions} pushes a
 * new snippet list into an already-open editor, so creating, deleting, renaming or re-icon-ing a
 * snippet note no longer forces the whole editor to be torn down and rebuilt.
 */
export default class TriliumSnippets extends Plugin {

    static get requires() {
        return [SnippetsEditing, SnippetsUI] as const;
    }

    static get pluginName() {
        return "TriliumSnippets" as const;
    }

    /**
     * Updates the snippet list on the live editor. The bound dropdown/menu re-render in place.
     */
    public updateDefinitions(definitions: ReadonlyArray<SnippetDefinition>): void {
        this.editor.plugins.get(SnippetsEditing).setDefinitions(definitions);
    }
}

declare module "ckeditor5" {
    interface EditorConfig {
        snippets?: SnippetsConfig;
    }

    interface PluginsMap {
        [TriliumSnippets.pluginName]: TriliumSnippets;
        [SnippetsEditing.pluginName]: SnippetsEditing;
        [SnippetsUI.pluginName]: SnippetsUI;
    }

    interface CommandsMap {
        insertTemplate: Command;
    }
}
