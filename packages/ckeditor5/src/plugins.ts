import { Autoformat, AutoLink, BlockQuote, BlockToolbar, Bold, CKFinderUploadAdapter, Clipboard, Code, CodeBlock, Enter, Font, FontBackgroundColor, FontColor, GeneralHtmlSupport, Heading, HeadingButtonsUI, HorizontalLine, Image, ImageCaption, ImageInline, ImageResize, ImageStyle, ImageToolbar, ImageUpload, Alignment, Indent, IndentBlock, Italic, Link, List, ListProperties, Mention, PageBreak, Paragraph, ParagraphButtonUI, PasteFromOffice, PictureEditing, RemoveFormat, SelectAll, ShiftEnter, SpecialCharacters, SpecialCharactersEssentials, Strikethrough, Style, Subscript, Superscript, Table, TableCaption, TableCellProperties, TableColumnResize, TableProperties, TableSelection, TableToolbar, TextPartLanguage, TextTransformation, TodoList, Typing, Underline, Undo, Bookmark, EmojiMention, EmojiPicker, FindAndReplaceEditing } from "ckeditor5";
import { SlashCommand, Template, FormatPainter } from "ckeditor5-premium-features";
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
import IncludeNote from "./plugins/includenote.js";
import Uploadfileplugin from "./plugins/file_upload/uploadfileplugin.js";
import SyntaxHighlighting from "./plugins/syntax_highlighting/index.js";
import { Kbd } from "@triliumnext/ckeditor5-keyboard-marker";
import { Mermaid } from "@triliumnext/ckeditor5-mermaid";
import { Admonition } from "@triliumnext/ckeditor5-admonition";
import { Footnotes } from "@triliumnext/ckeditor5-footnotes";
import { Math, AutoformatMath } from "@triliumnext/ckeditor5-math";

// import "@triliumnext/ckeditor5-mermaid/index.css";
// import "@triliumnext/ckeditor5-admonition/index.css";
// import "@triliumnext/ckeditor5-footnotes/index.css";
// import "@triliumnext/ckeditor5-math/index.css";
import CodeBlockToolbar from "./plugins/code_block_toolbar.js";
import CodeBlockLanguageDropdown from "./plugins/code_block_language_dropdown.js";
import MoveBlockUpDownPlugin from "./plugins/move_block_updown.js";
import ScrollOnUndoRedoPlugin from "./plugins/scroll_on_undo_redo.js"
import InlineCodeNoSpellcheck from "./plugins/inline_code_no_spellcheck.js";

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
    Uploadfileplugin,
    SyntaxHighlighting,
    CodeBlockLanguageDropdown,
    CodeBlockToolbar,
    MoveBlockUpDownPlugin,
    ScrollOnUndoRedoPlugin,
    InlineCodeNoSpellcheck,
];

/**
 * External plugins that are not part of the CKEditor 5 core and not part of Trilium, included in both text editors but not in the attribute editor.
 */
const EXTERNAL_PLUGINS: typeof Plugin[] = [
    Kbd,
    Mermaid,
    Admonition,
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
    Mention,

    // Trilium plugins
    MentionCustomization,
    ReferenceLink
];

/**
 * Plugins that require a premium CKEditor license key to work.
 */
export const PREMIUM_PLUGINS: typeof Plugin[] = [
    SlashCommand,
    Template,
	FormatPainter
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
    EmojiMention,
    EmojiPicker,

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
