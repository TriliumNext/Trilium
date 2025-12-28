import "ckeditor5/ckeditor5.css";
import 'ckeditor5-premium-features/ckeditor5-premium-features.css';
import "./theme/code_block_toolbar.css";
import { COMMON_PLUGINS, CORE_PLUGINS, POPUP_EDITOR_PLUGINS } from "./plugins.js";
import { BalloonEditor, DecoupledEditor, FindAndReplaceEditing, FindCommand } from "ckeditor5";
import "./translation_overrides.js";
export { default as EditorWatchdog } from "./custom_watchdog";
export { PREMIUM_PLUGINS } from "./plugins.js";
export type { EditorConfig, MentionFeed, MentionFeedObjectItem, ModelNode, ModelPosition, ModelElement, ModelText, WatchdogConfig, WatchdogState } from "ckeditor5";
export type { TemplateDefinition } from "ckeditor5-premium-features";
export { default as buildExtraCommands } from "./extra_slash_commands.js";
export { default as getCkLocale } from "./i18n.js";

// Import with sideffects to ensure that type augmentations are present.
import "@triliumnext/ckeditor5-math";
import "@triliumnext/ckeditor5-mermaid";

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
