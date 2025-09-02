import { Autoformat, AutoLink, BlockQuote, BlockToolbar, Bold, CKFinderUploadAdapter, Clipboard, Code, CodeBlock, Enter, FindAndReplace, Font, FontBackgroundColor, FontColor, GeneralHtmlSupport, Heading, HeadingButtonsUI, HorizontalLine, Image, ImageCaption, ImageInline, ImageResize, ImageStyle, ImageToolbar, ImageUpload, Alignment, Indent, IndentBlock, Italic, Link, List, ListProperties, Mention, PageBreak, Paragraph, ParagraphButtonUI, PasteFromOffice, PictureEditing, RemoveFormat, SelectAll, ShiftEnter, SpecialCharacters, SpecialCharactersEssentials, Strikethrough, Style, Subscript, Superscript, Table, TableCaption, TableCellProperties, TableColumnResize, TableProperties, TableSelection, TableToolbar, TextPartLanguage, TextTransformation, TodoList, Typing, Underline, Undo, Bookmark, Emoji, Notification, EmojiMention, EmojiPicker } from "ckeditor5";
import { SlashCommand, Template } from "ckeditor5-premium-features";
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

import "@triliumnext/ckeditor5-mermaid/index.css";
import "@triliumnext/ckeditor5-admonition/index.css";
import "@triliumnext/ckeditor5-footnotes/index.css";
import "@triliumnext/ckeditor5-math/index.css";
import CodeBlockToolbar from "./plugins/code_block_toolbar.js";
import CodeBlockLanguageDropdown from "./plugins/code_block_language_dropdown.js";
import MoveBlockUpDownPlugin from "./plugins/move_block_updown.js";
import ScrollOnUndoRedoPlugin from "./plugins/scroll_on_undo_redo.js"

import type { PluginMetadata, PluginRegistry } from "@triliumnext/commons";

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
	ScrollOnUndoRedoPlugin
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
    Template
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
	FindAndReplace,
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

/**
 * Plugin metadata registry for CKEditor plugins in Trilium.
 * This defines the configurable plugins with their metadata, dependencies, and categorization.
 */
export const PLUGIN_REGISTRY: PluginRegistry = {
    plugins: {
        // Core plugins (cannot be disabled)
        "clipboard": {
            id: "clipboard",
            name: "Clipboard",
            description: "Basic clipboard operations (copy, paste, cut)",
            category: "formatting",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: true,
            commands: ["copy", "paste", "cut"]
        },
        "enter": {
            id: "enter",
            name: "Enter Key",
            description: "Enter key handling for line breaks and paragraphs",
            category: "structure",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: true,
        },
        "typing": {
            id: "typing",
            name: "Typing",
            description: "Basic text input and keyboard handling",
            category: "formatting",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: true,
        },
        "undo": {
            id: "undo",
            name: "Undo/Redo",
            description: "Undo and redo functionality",
            category: "formatting",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: true,
            commands: ["undo", "redo"],
            toolbarItems: ["undo", "redo"]
        },
        "paragraph": {
            id: "paragraph",
            name: "Paragraph",
            description: "Basic paragraph formatting",
            category: "structure",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: true,
            commands: ["paragraph"]
        },

        // Formatting plugins
        "bold": {
            id: "bold",
            name: "Bold",
            description: "Bold text formatting",
            category: "formatting",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["bold"],
            toolbarItems: ["bold"]
        },
        "italic": {
            id: "italic",
            name: "Italic",
            description: "Italic text formatting",
            category: "formatting",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["italic"],
            toolbarItems: ["italic"]
        },
        "underline": {
            id: "underline",
            name: "Underline",
            description: "Underline text formatting",
            category: "formatting",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["underline"],
            toolbarItems: ["underline"]
        },
        "strikethrough": {
            id: "strikethrough",
            name: "Strikethrough",
            description: "Strikethrough text formatting",
            category: "formatting",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["strikethrough"],
            toolbarItems: ["strikethrough"]
        },
        "code": {
            id: "code",
            name: "Inline Code",
            description: "Inline code formatting",
            category: "formatting",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["code"],
            toolbarItems: ["code"]
        },
        "subscript": {
            id: "subscript",
            name: "Subscript",
            description: "Subscript text formatting",
            category: "formatting",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["subscript"],
            toolbarItems: ["subscript"]
        },
        "superscript": {
            id: "superscript",
            name: "Superscript",
            description: "Superscript text formatting",
            category: "formatting",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["superscript"],
            toolbarItems: ["superscript"]
        },

        // Structure plugins
        "heading": {
            id: "heading",
            name: "Headings",
            description: "Heading levels (H2-H6)",
            category: "structure",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["heading"],
            toolbarItems: ["heading"]
        },
        "blockquote": {
            id: "blockquote",
            name: "Block Quote",
            description: "Block quote formatting",
            category: "structure",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["blockQuote"],
            toolbarItems: ["blockQuote"]
        },
        "list": {
            id: "list",
            name: "Lists",
            description: "Bulleted and numbered lists",
            category: "structure",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["bulletedList", "numberedList"],
            toolbarItems: ["bulletedList", "numberedList"]
        },
        "todolist": {
            id: "todolist",
            name: "Todo List",
            description: "Checkable todo list items",
            category: "structure",
            defaultEnabled: true,
            dependencies: ["list"],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["todoList"],
            toolbarItems: ["todoList"]
        },
        "alignment": {
            id: "alignment",
            name: "Text Alignment",
            description: "Text alignment (left, center, right, justify)",
            category: "formatting",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["alignment"],
            toolbarItems: ["alignment"]
        },
        "indent": {
            id: "indent",
            name: "Indentation",
            description: "Text and block indentation",
            category: "formatting",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["indent", "outdent"],
            toolbarItems: ["indent", "outdent"]
        },

        // Media plugins
        "image": {
            id: "image",
            name: "Images",
            description: "Image insertion, resizing and styling",
            category: "media",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["insertImage"],
            toolbarItems: ["insertImage"]
        },
        "link": {
            id: "link",
            name: "Links",
            description: "Hyperlinks and internal note links",
            category: "formatting",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["link", "unlink"],
            toolbarItems: ["link", "unlink"]
        },

        // Table plugins
        "table": {
            id: "table",
            name: "Tables",
            description: "Table creation and editing",
            category: "tables",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["insertTable"],
            toolbarItems: ["insertTable"]
        },

        // Advanced plugins
        "codeblock": {
            id: "codeblock",
            name: "Code Blocks",
            description: "Syntax-highlighted code blocks",
            category: "advanced",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["codeBlock"],
            toolbarItems: ["codeBlock"]
        },
        "math": {
            id: "math",
            name: "Math Formulas",
            description: "Mathematical formulas using KaTeX",
            category: "advanced",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["math"],
            toolbarItems: ["math"]
        },
        "mermaid": {
            id: "mermaid",
            name: "Mermaid Diagrams",
            description: "Diagram creation using Mermaid syntax",
            category: "advanced",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["mermaid"],
            toolbarItems: ["mermaid"]
        },
        "admonition": {
            id: "admonition",
            name: "Admonitions",
            description: "Callout boxes and admonition blocks",
            category: "advanced",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["admonition"],
            toolbarItems: ["admonition"]
        },
        "footnotes": {
            id: "footnotes",
            name: "Footnotes",
            description: "Footnote references and definitions",
            category: "advanced",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["footnote"],
            toolbarItems: ["footnote"]
        },
        "keyboard": {
            id: "keyboard",
            name: "Keyboard Shortcuts",
            description: "Visual keyboard shortcut markers",
            category: "formatting",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["kbd"],
            toolbarItems: ["kbd"]
        },
        "horizontalline": {
            id: "horizontalline",
            name: "Horizontal Line",
            description: "Horizontal rule/divider line",
            category: "structure",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["horizontalLine"],
            toolbarItems: ["horizontalLine"]
        },
        "pagebreak": {
            id: "pagebreak",
            name: "Page Break",
            description: "Page break for printing",
            category: "structure",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["pageBreak"],
            toolbarItems: ["pageBreak"]
        },
        "removeformat": {
            id: "removeformat",
            name: "Remove Formatting",
            description: "Remove text formatting",
            category: "formatting",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["removeFormat"],
            toolbarItems: ["removeFormat"]
        },
        "findandreplace": {
            id: "findandreplace",
            name: "Find and Replace",
            description: "Text search and replace functionality",
            category: "advanced",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["findAndReplace"],
            toolbarItems: ["findAndReplace"]
        },
        "font": {
            id: "font",
            name: "Font Styling",
            description: "Font family, size, color, and background color",
            category: "formatting",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["fontFamily", "fontSize", "fontColor", "fontBackgroundColor"],
            toolbarItems: ["fontFamily", "fontSize", "fontColor", "fontBackgroundColor"]
        },
        "specialcharacters": {
            id: "specialcharacters",
            name: "Special Characters",
            description: "Insert special characters and symbols",
            category: "formatting",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["specialCharacters"],
            toolbarItems: ["specialCharacters"]
        },
        "emoji": {
            id: "emoji",
            name: "Emoji Support",
            description: "Emoji insertion and autocomplete",
            category: "formatting",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["emoji"],
            toolbarItems: ["emoji"]
        },

        // Premium plugins
        "slashcommand": {
            id: "slashcommand",
            name: "Slash Commands",
            description: "Quick command insertion with / key",
            category: "advanced",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: true,
            isCore: false,
            commands: ["slashCommand"]
        },
        "template": {
            id: "template",
            name: "Templates",
            description: "Text templates and snippets",
            category: "advanced",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: true,
            isCore: false,
            commands: ["template"],
            toolbarItems: ["template"]
        },

        // Trilium-specific plugins
        "uploadimage": {
            id: "uploadimage",
            name: "Image Upload",
            description: "Trilium-specific image upload handling",
            category: "trilium",
            defaultEnabled: true,
            dependencies: ["image"],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
        },
        "cuttonote": {
            id: "cuttonote",
            name: "Cut to Note",
            description: "Cut selected text to create a new note",
            category: "trilium",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["cutToNote"]
        },
        "internallink": {
            id: "internallink",
            name: "Internal Links",
            description: "Trilium-specific internal note linking",
            category: "trilium",
            defaultEnabled: true,
            dependencies: ["link"],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
        },
        "insertdatetime": {
            id: "insertdatetime",
            name: "Insert Date/Time",
            description: "Insert current date and time",
            category: "trilium",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["insertDateTime"]
        },
        "includenote": {
            id: "includenote",
            name: "Include Note",
            description: "Include content from other notes",
            category: "trilium",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["includeNote"]
        },
        "uploadfile": {
            id: "uploadfile",
            name: "File Upload",
            description: "Upload and attach files",
            category: "trilium",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["uploadFile"]
        },
        "markdownimport": {
            id: "markdownimport",
            name: "Markdown Import",
            description: "Import markdown content",
            category: "trilium",
            defaultEnabled: true,
            dependencies: [],
            conflicts: [],
            requiresPremium: false,
            isCore: false,
            commands: ["markdownImport"]
        }
    },
    version: "1.0.0",
    lastModified: new Date().toISOString()
};

/**
 * Get plugin metadata by ID
 */
export function getPluginMetadata(pluginId: string): PluginMetadata | undefined {
    return PLUGIN_REGISTRY.plugins[pluginId];
}

/**
 * Get all plugins in a category
 */
export function getPluginsByCategory(category: string): PluginMetadata[] {
    return Object.values(PLUGIN_REGISTRY.plugins).filter(plugin => plugin.category === category);
}

/**
 * Get core plugins (cannot be disabled)
 */
export function getCorePlugins(): PluginMetadata[] {
    return Object.values(PLUGIN_REGISTRY.plugins).filter(plugin => plugin.isCore);
}

/**
 * Get configurable plugins (can be enabled/disabled)
 */
export function getConfigurablePlugins(): PluginMetadata[] {
    return Object.values(PLUGIN_REGISTRY.plugins).filter(plugin => !plugin.isCore);
}

/**
 * Get default enabled plugins configuration as JSON string
 */
export function getDefaultPluginConfiguration(): string {
    const defaultConfig: Record<string, boolean> = {};
    Object.values(PLUGIN_REGISTRY.plugins).forEach(plugin => {
        if (!plugin.isCore) {
            defaultConfig[plugin.id] = plugin.defaultEnabled;
        }
    });
    return JSON.stringify(defaultConfig);
}
