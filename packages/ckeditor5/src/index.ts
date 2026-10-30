import "ckeditor5/ckeditor5.css";
// Baseline block-quote styling from CKEditor's block-quote feature. It arrived here with the
// admonition plugin (which was forked from block-quote) but styles `blockquote`, not admonitions —
// the client's theme-next stylesheet overrides parts of it with `!important`.
import "./theme/blockquote.css";
import "./theme/content_colors.css";
import "./theme/code_block_toolbar.css";
import type { ClipboardImageEmbedConfig } from "./plugins/clipboard_image_embed.js";
import type { ImageEditingSourceConfig } from "./plugins/image_editing_source.js";
import type { PasteTarget } from "./plugins/cuttonote.js";
import { CLASSIC_EDITOR_PLUGINS, CORE_PLUGINS, POPUP_EDITOR_PLUGINS } from "./plugins.js";
import { BalloonEditor, DecoupledEditor, FindAndReplaceEditing, FindCommand } from "ckeditor5";
export { onTextEditorError } from "./editor_errors.js";
export { CHAT_INPUT_PLUGINS, MEMO_PLUGINS } from "./plugins.js";
export type { CKEditorError, EditorConfig, FindResultType, MentionFeed, MentionFeedObjectItem, ModelNode, ModelPosition, ModelElement, ModelText, TextTransformationConfig, TextTypingTransformationDescription } from "ckeditor5";
export type { ClipboardImageEmbedConfig } from "./plugins/clipboard_image_embed.js";
export type { ImageEditingSourceConfig } from "./plugins/image_editing_source.js";
export type { FileUploadData, FileUploadEvent } from "./plugins/file_upload/fileuploadediting.js";
export type { PasteTarget } from "./plugins/cuttonote.js";
export type {
    ContentEmbedCodeView, ContentEmbedState
} from "./plugins/content_embed/content_embed.js";
export type { EmbedEdge } from "./plugins/content_embed/content_embed_caret.js";
export { default as EmbedHistory } from "./plugins/content_embed/embed_history.js";
export type {
    EmbedHistoryEntry, EmbedHistoryStep
} from "./plugins/content_embed/embed_history.js";
export type { InlineEmbedSource } from "./plugins/content_embed/inline_source.js";
export type { ContentEmbedHost } from "./plugins/content_embed/content_embed.js";
export type { AttachmentLinkChange } from "./plugins/referencelink.js";
export type { ChildNoteHost } from "./plugins/child_note.js";
export { getLinkAtSelection, replaceLinkAtSelection } from "./plugins/internallink.js";
export type { LinkAtSelection, LinkDialogRequest } from "./plugins/internallink.js";
export type { default as TriliumEmojiMention, EmojiSuggestion } from "./plugins/mention/emoji_mention.js";
export type { default as TriliumSlashCommands, SlashCommandConfig, SlashCommandDefinition, SlashCommandItem } from "./plugins/mention/slash_commands.js";
export type { MentionHostedFeed, MentionHostedList, MentionHostedListState } from "./plugins/mention/types.js";
export type { ToolbarGroupMenuEntry, ToolbarGroupMenuHost, ToolbarGroupMenuItem, ToolbarGroupMenuRequest } from "./plugins/toolbar_group_menu.js";
export type { default as TextFormattingToolbar } from "./plugins/text_formatting_toolbar.js";
export type { default as ContextToolbar } from "./plugins/context_toolbar.js";
export type { default as MobileToolbarItems } from "./plugins/mobile_toolbar_items.js";
export type { LinkDisplayMode, LinkEmbedHost } from "./plugins/link_embed/link_embed_commands.js";
export type { AttachmentUploadHost } from "./plugins/uploadimage.js";
export type { IconPickerRequest } from "./plugins/inline_icon/inline_icon_ui.js";
export type { BlockReferenceHost } from "./plugins/block_reference/block_reference.js";
export type { SortTargetKind } from "./plugins/sort_selection/sort_targets.js";
export type { ColorMenuHost, ColorMenuRequest, ColorMenuTarget } from "./plugins/color_menu.js";
export { default as TriliumSnippets } from "./plugins/snippets/snippets.js";
export type { SnippetDefinition } from "./plugins/snippets/snippetsconfig.js";
export { default as TriliumAiAssistant } from "./plugins/ai_assistant/ai_assistant.js";
export type { AiAssistantConfig, AiCompletionRequest, AiCompletionUsage, AiConversationTurn, AiDiffFunction, AiDiffResult, AiQuickAction, AiQuickActionFooter, AiQuickActionGroup, AiReviewView, AiSanitizeFunction, AiStreamCallback, AiStreamFunction, AiSurroundings } from "./plugins/ai_assistant/ai_assistant_config.js";
export { default as getCkLocale, registerCkTranslations } from "./i18n.js";
export { MESSAGE_KEY_PREFIX, MESSAGE_OVERRIDES, slugify } from "./messages.js";
export * from "./utils.js";

// Import with sideffects to ensure that type augmentations are present.
import "./plugins/file_upload/uploadfileplugin.js";
import "./plugins/block_reference/block_reference.js";
import "./plugins/child_note.js";
import "./plugins/content_embed/content_embed.js";
import "./plugins/content_embed/content_embed_caret.js";
import "./plugins/find_in_link_widgets.js";
import "./plugins/find_reveal.js";
import "./plugins/image_to_drawing.js";
import "./plugins/insert_date_time.js";
import "./plugins/markdownimport.js";
import "./plugins/math/math.js";
import "./plugins/tabs/tabs.js";
import "./plugins/multicolumn/multicolumn.js";
import "./plugins/mermaid/mermaid.js";
import "./plugins/referencelink.js";
import "./plugins/sort_selection/sort_selection.js";
import "./plugins/table_column_bar/table_column_bar.js";
import "./plugins/table_context_menu.js";
import "./plugins/table_paste_rows.js";

window[Symbol.for("cke distribution")] = "trilium";

/**
 * Short-hand for the CKEditor classes supported by Trilium for text editing.
 * Specialized editors such as the {@link AttributeEditor} are not included.
 */
export type CKTextEditor = (ClassicEditor | PopupEditor) & {
    getSelectedHtml(): string;
    getSelectedPlainText(): string;
    pasteContent(html: string, text: string): void;
    capturePasteTarget(): PasteTarget;
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
        return CLASSIC_EDITOR_PLUGINS;
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
        getSelectedPlainText(): string;
        pasteContent(html: string, text: string): void;
        capturePasteTarget(): PasteTarget;
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
            /**
             * Copies rich HTML, with `plainText` as the plain-text alternative. Provided by the host
             * because `navigator.clipboard.write()` only exists in secure contexts, and Trilium is
             * routinely served over plain HTTP on a LAN — the host falls back to a copy-event
             * handler there.
             */
            copyHtml?(html: string, plainText: string): void;
        },
        clipboardImageEmbed?: ClipboardImageEmbedConfig,
        imageEditingSource?: ImageEditingSourceConfig,
        autoSort?: {
            /** More date formats for table sorting to recognize, in Day.js syntax. */
            dateFormats?: string[];
        }
    }
}
