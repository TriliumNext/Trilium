import "ckeditor5/ckeditor5.css";
// Baseline block-quote styling from CKEditor's block-quote feature. It arrived here with the
// admonition plugin (which was forked from block-quote) but styles `blockquote`, not admonitions —
// the client's theme-next stylesheet overrides parts of it with `!important`.
import "./theme/blockquote.css";
import "./theme/code_block_toolbar.css";
import "./theme/link_embed_form.css";
import { COMMON_PLUGINS, CORE_PLUGINS, POPUP_EDITOR_PLUGINS } from "./plugins.js";
import { BalloonEditor, DecoupledEditor, FindAndReplaceEditing, FindCommand } from "ckeditor5";
export { default as EditorWatchdog } from "./custom_watchdog";
export { CHAT_INPUT_PLUGINS, MEMO_PLUGINS } from "./plugins.js";
export type { EditorConfig, MentionFeed, MentionFeedObjectItem, ModelNode, ModelPosition, ModelElement, ModelText, WatchdogConfig, WatchdogState } from "ckeditor5";
export type { SlashCommandConfig, SlashCommandDefinition } from "./plugins/mention/slash_commands.js";
export type { TriliumMentionFeed } from "./plugins/mention/types.js";
export { default as TriliumSnippets } from "./plugins/snippets/snippets.js";
export type { SnippetDefinition } from "./plugins/snippets/snippetsconfig.js";
export { default as getCkLocale, registerCkTranslations } from "./i18n.js";
export { MESSAGE_KEY_PREFIX, MESSAGE_OVERRIDES, slugify } from "./messages.js";
export * from "./utils.js";

// Import with sideffects to ensure that type augmentations are present.
import "./plugins/math/math.js";
import "./plugins/mermaid/mermaid.js";

window[Symbol.for("cke distribution")] = "trilium";

/**
 * Short-hand for the CKEditor classes supported by Trilium for text editing.
 * Specialized editors such as the {@link AttributeEditor} are not included.
 */
export type CKTextEditor = (ClassicEditor | PopupEditor) & {
    getSelectedHtml(): string;
    removeSelection(): Promise<void>;
};

export type FindAndReplaceState = FindAndReplaceEditing["state"];
export type FindCommandResult = ReturnType<FindCommand["execute"]>;

/**
 * The text editor that can be used for editing attributes and relations.
 */
export class AttributeEditor extends BalloonEditor {

    static override get builtinPlugins() {
        return CORE_PLUGINS;
    }
}

/**
 * A text editor configured as a {@link DecoupledEditor} (fixed toolbar mode), as well as its preconfigured plugins.
 */
export class ClassicEditor extends DecoupledEditor {
    static override get builtinPlugins() {
        return COMMON_PLUGINS;
    }
}

/**
 * A text editor configured as a {@link BalloonEditor} (floating toolbar mode), as well as its preconfigured plugins.
 */
export class PopupEditor extends BalloonEditor {
    static override get builtinPlugins() {
        return POPUP_EDITOR_PLUGINS;
    }
}

declare module "ckeditor5" {
    interface Editor {
        getSelectedHtml(): string;
        removeSelection(): Promise<void>;
    }

    interface EditorConfig {
        syntaxHighlighting?: {
            loadHighlightJs: () => Promise<any>;
            mapLanguageName(mimeType: string): string;
            defaultMimeType: string;
            enabled: boolean;
        },
        moveBlockUp?: {
            keystroke: string[];
        },
        moveBlockDown?: {
            keystroke: string[];
        },
        clipboard?: {
            copy(text: string): void;
        }
    }
}
