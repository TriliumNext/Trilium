import { Autoformat, AutoLink, BlockQuote, BlockToolbar, Bold, CKFinderUploadAdapter, Clipboard, Code, CodeBlock, Enter, Font, FontBackgroundColor, FontColor, GeneralHtmlSupport, Heading, HeadingButtonsUI, HorizontalLine, Image, ImageCaption, ImageInline, ImageResize, ImageStyle, ImageToolbar, ImageUpload, Alignment, Indent, IndentBlock, Italic, Link, List, ListProperties, MentionEditing, PageBreak, Paragraph, ParagraphButtonUI, PasteFromOffice, PictureEditing, RemoveFormat, SelectAll, ShiftEnter, SpecialCharacters, SpecialCharactersEssentials, Strikethrough, Style, Subscript, Superscript, Table, TableCaption, TableCellProperties, TableColumnResize, TableProperties, TableSelection, TableToolbar, TextPartLanguage, TextTransformation, TodoList, Typing, Underline, Undo, Bookmark, EmojiPicker, FindAndReplaceEditing } from "ckeditor5";
// Nothing here comes from `ckeditor5-premium-features` any more: every premium plugin Trilium
// once loaded has an in-tree GPL replacement — `SlashCommand` -> `TriliumSlashCommands`,
// `FormatPainter` -> `TriliumFormatPainter`, `Template` -> `TriliumSnippets`. See each plugin's
// doc comment for the details.
import type { Plugin } from "ckeditor5";
import CutToNotePlugin from "./plugins/cuttonote.js";
import UploadimagePlugin from "./plugins/uploadimage.js";
import ItalicAsEmPlugin from "./plugins/italic_as_em.js";
import StrikethroughAsDel from "./plugins/strikethrough_as_del.js";
import InternalLinkPlugin from "./plugins/internallink.js";
import InsertDateTimePlugin from "./plugins/insert_date_time.js";
import ReferenceLink from "./plugins/referencelink.js";
import RemoveFormatLinksPlugin from "./plugins/remove_format_links.js";
import IndentBlockShortcutPlugin from "./plugins/indent_block_shortcut.js";
import MarkdownImportPlugin from "./plugins/markdownimport.js";
import MentionCustomization from "./plugins/mention_customization.js";
import TriliumEmojiMention from "./plugins/mention/emoji_mention.js";
import TriliumMentionUI from "./plugins/mention/trilium_mention_ui.js";
import TriliumSlashCommands from "./plugins/mention/slash_commands.js";
import TriliumFormatPainter from "./plugins/format_painter/format_painter.js";
import IncludeNote from "./plugins/includenote.js";
import LinkEmbed from "./plugins/link_embed/link_embed.js";
import Uploadfileplugin from "./plugins/file_upload/uploadfileplugin.js";
import SyntaxHighlighting from "./plugins/syntax_highlighting/index.js";
import Kbd from "./plugins/keyboard_marker/keyboard_marker.js";
import Mermaid from "./plugins/mermaid/mermaid.js";
import Admonition from "./plugins/admonition/admonition.js";
import Collapsible from "./plugins/collapsible/collapsible.js";
import Footnotes from "./plugins/footnotes/footnotes.js";
import Math from "./plugins/math/math.js";
import AutoformatMath from "./plugins/math/autoformat_math.js";
import CopyAnchorLinkButton from "./plugins/copy_anchor_link.js";
import AnnotateImagePlugin from "./plugins/annotate_image.js";
import CopyLinkUrlButton from "./plugins/copy_link_url.js";
import ImageActions from "./plugins/image_actions.js";
import TriliumSnippets from "./plugins/snippets/snippets.js";

import CodeBlockToolbar from "./plugins/code_block_toolbar.js";
import CodeBlockLanguageDropdown from "./plugins/code_block_language_dropdown.js";
import CodeBlockInsertParagraph from "./plugins/code_block_insert_paragraph.js";
import CodeBlockHljsClass from "./plugins/code_block_hljs_class.js";
import MoveBlockUpDownPlugin from "./plugins/move_block_updown.js";
import ScrollOnUndoRedoPlugin from "./plugins/scroll_on_undo_redo.js"
import InlineCodeNoSpellcheck from "./plugins/inline_code_no_spellcheck.js";
import InlineCodeToolbar from "./plugins/inline_code_toolbar.js";
import AdmonitionTypeDropdown from "./plugins/admonition/admonition_type_dropdown.js";
import AdmonitionToolbar from "./plugins/admonition/admonition_toolbar.js";
import IncludeNoteBoxSizeDropdown from "./plugins/include_note_box_size_dropdown.js";
import IncludeNoteToolbar from "./plugins/include_note_toolbar.js";
import LinkEmbedToolbar from "./plugins/link_embed/link_embed_toolbar.js";
import TodoListMultistate from "./plugins/todo_list_multistate/todo_list_multistate.js";
import TodoListUncheckOnEnter from "./plugins/todo_list_uncheck_on_enter.js";
import CollapsibleListItems from "./plugins/collapsible_list_items.js";
import TableIndent from "./plugins/table_indent.js";

/**
 * Plugins that are specific to Trilium and not part of the CKEditor 5 core, included in both text editors but not in the attribute editor.
 */
const TRILIUM_PLUGINS: typeof Plugin[] = [
    UploadimagePlugin,
    CutToNotePlugin,
    ItalicAsEmPlugin,
	StrikethroughAsDel,
    InternalLinkPlugin,
	InsertDateTimePlugin,
    RemoveFormatLinksPlugin,
    IndentBlockShortcutPlugin,
    MarkdownImportPlugin,
    IncludeNote,
    LinkEmbed,
    Uploadfileplugin,
    SyntaxHighlighting,
    CodeBlockLanguageDropdown,
    CodeBlockToolbar,
    CodeBlockInsertParagraph,
    CodeBlockHljsClass,
    MoveBlockUpDownPlugin,
    ScrollOnUndoRedoPlugin,
    InlineCodeNoSpellcheck,
    InlineCodeToolbar,
    AdmonitionTypeDropdown,
    AdmonitionToolbar,
    IncludeNoteBoxSizeDropdown,
    IncludeNoteToolbar,
    LinkEmbedToolbar,
    TodoListMultistate,
    CollapsibleListItems,
    TableIndent,
    CopyAnchorLinkButton,
    AnnotateImagePlugin,
    CopyLinkUrlButton,
    ImageActions,
    TriliumSnippets,
];

/**
 * External plugins that are not part of the CKEditor 5 core and not part of Trilium, included in both text editors but not in the attribute editor.
 */
const EXTERNAL_PLUGINS: typeof Plugin[] = [
    Kbd,
    Mermaid,
    Admonition,
    Collapsible,
    Footnotes,
    Math,
	AutoformatMath
];

/**
 * The minimal set of plugins required for the editor to work. This is used both in normal text editors (floating or fixed toolbar) and in the attribute editor.
 */
export const CORE_PLUGINS: typeof Plugin[] = [
    Clipboard, Enter, SelectAll,
    ShiftEnter, Typing, Undo,
	Paragraph,

    // `MentionEditing` + `TriliumMentionUI` rather than the `Mention` façade: the façade also pulls
    // in upstream's `MentionUI`, which `TriliumMentionUI` replaces. See its doc comment for why.
    MentionEditing,

    // Trilium plugins
    TriliumMentionUI,
    MentionCustomization,
    ReferenceLink
];

/**
 * Lightweight formatting plugins for a minimal reply input (e.g. the AI chat) — added on top of an
 * {@link AttributeEditor} instance via `extraPlugins` to enable markdown **autoformatting** for block
 * quotes, fenced code blocks, lists and links, without a toolbar. Kept out of {@link CORE_PLUGINS} so
 * the plain attribute/relation editor stays plain.
 */
export const CHAT_INPUT_PLUGINS: typeof Plugin[] = [
    Autoformat,
    BlockQuote,
    CodeBlock,
    List,
    Link,
    AutoLink
];

/**
 * {@link CHAT_INPUT_PLUGINS} and the marks a sentence is written with, for an input whose text is
 * kept rather than sent on — the memo of a mind map node. Added to an {@link AttributeEditor} the
 * same way, and worth a toolbar there: a {@link BalloonEditor} raises one over the selection out of
 * whatever `toolbar` it is configured with.
 *
 * Kept apart from {@link CHAT_INPUT_PLUGINS} rather than added to it, though the chat box would
 * take these as readily: what is typed there is turned into markdown before it is sent, and that
 * pass keeps the text of an inline wrapper and drops the wrapper. Bold offered there would be bold
 * lost on its way to the model.
 *
 * `Autoformat` is what carries most of this: it registers `**bold**`, `_italic_`, `` `code` `` and
 * `~~struck~~` only where the matching command exists, so the marks below are what make those
 * spellings work at all — and the plainer way in, for anyone who would rather type than reach.
 *
 * The two Trilium converters ride along with them: they are what write italics as `<em>` and a
 * strikethrough as `<del>`, which is how the rest of Trilium stores both.
 */
export const MEMO_PLUGINS: typeof Plugin[] = [
    ...CHAT_INPUT_PLUGINS,
    Bold,
    Italic,
    ItalicAsEmPlugin,
    Strikethrough,
    StrikethroughAsDel,
    Code
];

/**
 * The set of plugins that are required for the editor to work. This is used in normal text editors (floating or fixed toolbar) but not in the attribute editor.
 */
export const COMMON_PLUGINS: typeof Plugin[] = [
    ...CORE_PLUGINS,

	CKFinderUploadAdapter,
	Autoformat,
	Bold,
	Italic,
	Underline,
	Strikethrough,
    FindAndReplaceEditing,
	Code,
	Superscript,
	Subscript,
	BlockQuote,
	Heading,
	Image,
	ImageCaption,
	ImageStyle,
	ImageToolbar,
	ImageUpload,
	ImageResize,
	ImageInline,
	Link,
	AutoLink,
	List,
	ListProperties,
	TodoList,
	TodoListUncheckOnEnter,
	PasteFromOffice,
	PictureEditing,
	Table,
	TableToolbar,
	TableProperties,
	TableCellProperties,
	TableSelection,
	TableCaption,
	TableColumnResize,
	Alignment,
	Indent,
	IndentBlock,
	ParagraphButtonUI,
	HeadingButtonsUI,
	TextTransformation,
	Font,
	FontColor,
	FontBackgroundColor,
	CodeBlock,
	SelectAll,
	HorizontalLine,
	RemoveFormat,
	SpecialCharacters,
	SpecialCharactersEssentials,
	PageBreak,
	GeneralHtmlSupport,
	TextPartLanguage,
    Style,
    Bookmark,
    // Upstream's `EmojiMention` is replaced by `TriliumEmojiMention` for the same reason as
    // `SlashCommand` — it `requires` the `Mention` façade. `EmojiPicker` and `EmojiRepository` do
    // not, so the picker and the emoji data stay upstream's.
    EmojiPicker,
    TriliumEmojiMention,
    TriliumSlashCommands,

    // GPL reimplementation of premium `FormatPainter` (the `formatPainter` toolbar button), built on
    // the public `isFormatting` schema flag, so the commercial plugin can be dropped.
    TriliumFormatPainter,

    ...TRILIUM_PLUGINS,
    ...EXTERNAL_PLUGINS
];

/**
 * The set of plugins specific to the popup editor (floating toolbar mode), and not the fixed toolbar mode.
 */
export const POPUP_EDITOR_PLUGINS: typeof Plugin[] = [
    ...COMMON_PLUGINS,
    BlockToolbar,
];
