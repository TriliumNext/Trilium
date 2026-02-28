/**
 * Toolbar customization types, defaults, and CKEditor5 conversion utilities.
 *
 * The stored config is a JSON string in the `textNoteToolbarConfig` option.
 * An empty string means "use built-in defaults", so existing installations
 * are unaffected when this feature is first deployed.
 */
import IconAlignCenter from "@ckeditor/ckeditor5-icons/theme/icons/align-center.svg?raw";

// ─── Data model ─────────────────────────────────────────────────────────────

/** A regular toolbar button/command (e.g. "bold", "insertTable"). */
export interface ToolbarItem {
    kind: "item";
    id: string;
    visible: boolean;
}

/** A visual separator rendered as a vertical bar "|" between toolbar sections. */
export interface ToolbarSeparator {
    kind: "separator";
}

/**
 * A dropdown group rendered as a labelled button that reveals child items.
 * Mirrors the CKEditor5 nested-toolbar format (see upstream docs).
 */
export interface ToolbarGroup {
    kind: "group";
    /** Stable identifier used for React keys and move-into-group logic. */
    id: string;
    label: string;
    /** Built-in icon name ("text", "plus", "threeVerticalDots") or the
     *  sentinel "__alignCenter__" that is resolved to the SVG at build time. */
    icon: string;
    visible: boolean;
    items: Array<ToolbarItem | ToolbarSeparator>;
}

export type ToolbarEntry = ToolbarItem | ToolbarSeparator | ToolbarGroup;

export interface ToolbarCustomConfig {
    version: 1;
    /** Fixed toolbar rendered at the top (classic / "ckeditor-classic" mode). */
    classic: ToolbarEntry[];
    /** Inline toolbar that pops up near the cursor (balloon / "ckeditor-balloon" mode). */
    floating: ToolbarEntry[];
    /** Block-level toolbar shown at the left margin in balloon mode. */
    blockToolbar: ToolbarEntry[];
}

// ─── Icon resolution ─────────────────────────────────────────────────────────

const ALIGN_CENTER_ICON_KEY = "__alignCenter__";

function resolveIcon(icon: string): string {
    return icon === ALIGN_CENTER_ICON_KEY ? IconAlignCenter : icon;
}

// ─── CKEditor5 conversion ────────────────────────────────────────────────────

/** Remove leading, trailing, and consecutive separators from a CKEditor item list. */
function cleanupSeparators(items: (string | object)[]): (string | object)[] {
    const result: (string | object)[] = [];
    for (const item of items) {
        if (item === "|") {
            if (result.length === 0 || result[result.length - 1] === "|") {
                continue;
            }
            result.push(item);
        } else {
            result.push(item);
        }
    }
    while (result.length > 0 && result[result.length - 1] === "|") {
        result.pop();
    }
    return result;
}

/**
 * Convert our toolbar config entries into the array format expected by CKEditor5.
 * Hidden items and empty groups are omitted; separators are cleaned up afterwards.
 */
export function entriesToCKItems(entries: ToolbarEntry[]): (string | object)[] {
    const raw: (string | object)[] = [];

    for (const entry of entries) {
        if (entry.kind === "separator") {
            raw.push("|");
        } else if (entry.kind === "group") {
            if (!entry.visible) {
                continue;
            }
            const childItems = entriesToCKItems(entry.items);
            if (childItems.length === 0) {
                continue;
            }
            raw.push({
                label: entry.label,
                icon: resolveIcon(entry.icon),
                items: childItems
            });
        } else {
            if (entry.visible) {
                raw.push(entry.id);
            }
        }
    }

    return cleanupSeparators(raw);
}

// ─── Human-readable labels ───────────────────────────────────────────────────

/** Maps CKEditor command names to display labels shown in the settings UI. */
export const TOOLBAR_ITEM_LABELS: Record<string, string> = {
    "heading": "Heading",
    "fontSize": "Font Size",
    "bold": "Bold",
    "italic": "Italic",
    "underline": "Underline",
    "strikethrough": "Strikethrough",
    "superscript": "Superscript",
    "subscript": "Subscript",
    "kbd": "Keyboard Input",
    "formatPainter": "Format Painter",
    "fontColor": "Font Color",
    "fontBackgroundColor": "Background Color",
    "removeFormat": "Remove Formatting",
    "bulletedList": "Bulleted List",
    "numberedList": "Numbered List",
    "todoList": "To-Do List",
    "blockQuote": "Block Quote",
    "admonition": "Admonition",
    "insertTable": "Insert Table",
    "code": "Inline Code",
    "codeBlock": "Code Block",
    "footnote": "Footnote",
    "imageUpload": "Upload Image",
    "link": "Link",
    "bookmark": "Bookmark",
    "internallink": "Internal Link",
    "includeNote": "Include Note",
    "specialCharacters": "Special Characters",
    "emoji": "Emoji",
    "math": "Math Formula",
    "mermaid": "Mermaid Diagram",
    "horizontalLine": "Horizontal Line",
    "pageBreak": "Page Break",
    "dateTime": "Date & Time",
    "alignment:left": "Align Left",
    "alignment:center": "Align Center",
    "alignment:right": "Align Right",
    "alignment:justify": "Justify",
    "outdent": "Decrease Indent",
    "indent": "Increase Indent",
    "insertTemplate": "Insert Template",
    "markdownImport": "Import from Markdown",
    "cuttonote": "Cut to Note"
};

export function getItemLabel(id: string): string {
    return TOOLBAR_ITEM_LABELS[id] ?? id;
}

// ─── Default configurations ──────────────────────────────────────────────────

/**
 * Default classic-toolbar configuration.
 * Must produce an identical result to the previous hardcoded buildClassicToolbar()
 * when all items are visible, so that existing behaviour is unchanged.
 */
export const DEFAULT_CLASSIC_TOOLBAR: ToolbarEntry[] = [
    { kind: "item", id: "heading", visible: true },
    { kind: "item", id: "fontSize", visible: true },
    { kind: "separator" },
    { kind: "item", id: "bold", visible: true },
    { kind: "item", id: "italic", visible: true },
    {
        kind: "group", id: "textFormatting",
        label: "Text formatting", icon: "text", visible: true,
        items: [
            { kind: "item", id: "underline", visible: true },
            { kind: "item", id: "strikethrough", visible: true },
            { kind: "separator" },
            { kind: "item", id: "superscript", visible: true },
            { kind: "item", id: "subscript", visible: true },
            { kind: "separator" },
            { kind: "item", id: "kbd", visible: true }
        ]
    },
    { kind: "item", id: "formatPainter", visible: true },
    { kind: "separator" },
    { kind: "item", id: "fontColor", visible: true },
    { kind: "item", id: "fontBackgroundColor", visible: true },
    { kind: "item", id: "removeFormat", visible: true },
    { kind: "separator" },
    { kind: "item", id: "bulletedList", visible: true },
    { kind: "item", id: "numberedList", visible: true },
    { kind: "item", id: "todoList", visible: true },
    { kind: "separator" },
    { kind: "item", id: "blockQuote", visible: true },
    { kind: "item", id: "admonition", visible: true },
    { kind: "item", id: "insertTable", visible: true },
    { kind: "separator" },
    { kind: "item", id: "code", visible: true },
    { kind: "item", id: "codeBlock", visible: true },
    { kind: "separator" },
    { kind: "item", id: "footnote", visible: true },
    {
        kind: "group", id: "insert",
        label: "Insert", icon: "plus", visible: true,
        items: [
            { kind: "item", id: "imageUpload", visible: true },
            { kind: "separator" },
            { kind: "item", id: "link", visible: true },
            { kind: "item", id: "bookmark", visible: true },
            { kind: "item", id: "internallink", visible: true },
            { kind: "item", id: "includeNote", visible: true },
            { kind: "separator" },
            { kind: "item", id: "specialCharacters", visible: true },
            { kind: "item", id: "emoji", visible: true },
            { kind: "item", id: "math", visible: true },
            { kind: "item", id: "mermaid", visible: true },
            { kind: "item", id: "horizontalLine", visible: true },
            { kind: "item", id: "pageBreak", visible: true },
            { kind: "item", id: "dateTime", visible: true }
        ]
    },
    { kind: "separator" },
    {
        kind: "group", id: "alignment",
        label: "Alignment", icon: ALIGN_CENTER_ICON_KEY, visible: true,
        items: [
            { kind: "item", id: "alignment:left", visible: true },
            { kind: "item", id: "alignment:center", visible: true },
            { kind: "item", id: "alignment:right", visible: true },
            { kind: "separator" },
            { kind: "item", id: "alignment:justify", visible: true }
        ]
    },
    { kind: "item", id: "outdent", visible: true },
    { kind: "item", id: "indent", visible: true },
    { kind: "separator" },
    { kind: "item", id: "insertTemplate", visible: true },
    { kind: "item", id: "markdownImport", visible: true },
    { kind: "item", id: "cuttonote", visible: true }
];

/** Default floating-toolbar configuration (balloon mode inline toolbar). */
export const DEFAULT_FLOATING_TOOLBAR: ToolbarEntry[] = [
    { kind: "item", id: "fontSize", visible: true },
    { kind: "item", id: "bold", visible: true },
    { kind: "item", id: "italic", visible: true },
    { kind: "item", id: "underline", visible: true },
    {
        kind: "group", id: "textFormatting",
        label: "Text formatting", icon: "text", visible: true,
        items: [
            { kind: "item", id: "strikethrough", visible: true },
            { kind: "separator" },
            { kind: "item", id: "superscript", visible: true },
            { kind: "item", id: "subscript", visible: true },
            { kind: "separator" },
            { kind: "item", id: "kbd", visible: true }
        ]
    },
    { kind: "item", id: "formatPainter", visible: true },
    { kind: "separator" },
    { kind: "item", id: "fontColor", visible: true },
    { kind: "item", id: "fontBackgroundColor", visible: true },
    { kind: "separator" },
    { kind: "item", id: "code", visible: true },
    { kind: "item", id: "link", visible: true },
    { kind: "item", id: "bookmark", visible: true },
    { kind: "item", id: "removeFormat", visible: true },
    { kind: "item", id: "internallink", visible: true },
    { kind: "item", id: "cuttonote", visible: true }
];

/** Default block-toolbar configuration (balloon mode block toolbar). */
export const DEFAULT_BLOCK_TOOLBAR: ToolbarEntry[] = [
    { kind: "item", id: "heading", visible: true },
    { kind: "separator" },
    { kind: "item", id: "bulletedList", visible: true },
    { kind: "item", id: "numberedList", visible: true },
    { kind: "item", id: "todoList", visible: true },
    { kind: "separator" },
    { kind: "item", id: "blockQuote", visible: true },
    { kind: "item", id: "admonition", visible: true },
    { kind: "item", id: "codeBlock", visible: true },
    { kind: "item", id: "insertTable", visible: true },
    { kind: "item", id: "footnote", visible: true },
    {
        kind: "group", id: "insert",
        label: "Insert", icon: "plus", visible: true,
        items: [
            { kind: "item", id: "link", visible: true },
            { kind: "item", id: "bookmark", visible: true },
            { kind: "item", id: "internallink", visible: true },
            { kind: "item", id: "includeNote", visible: true },
            { kind: "separator" },
            { kind: "item", id: "math", visible: true },
            { kind: "item", id: "mermaid", visible: true },
            { kind: "item", id: "horizontalLine", visible: true },
            { kind: "item", id: "pageBreak", visible: true },
            { kind: "item", id: "dateTime", visible: true }
        ]
    },
    { kind: "separator" },
    {
        kind: "group", id: "alignment",
        label: "Alignment", icon: ALIGN_CENTER_ICON_KEY, visible: true,
        items: [
            { kind: "item", id: "alignment:left", visible: true },
            { kind: "item", id: "alignment:center", visible: true },
            { kind: "item", id: "alignment:right", visible: true },
            { kind: "separator" },
            { kind: "item", id: "alignment:justify", visible: true }
        ]
    },
    { kind: "item", id: "outdent", visible: true },
    { kind: "item", id: "indent", visible: true },
    { kind: "separator" },
    { kind: "item", id: "insertTemplate", visible: true },
    { kind: "item", id: "imageUpload", visible: true },
    { kind: "item", id: "markdownImport", visible: true },
    { kind: "item", id: "specialCharacters", visible: true },
    { kind: "item", id: "emoji", visible: true }
];

/** Returns a deep copy of the default configuration. */
export function getDefaultConfig(): ToolbarCustomConfig {
    return {
        version: 1,
        classic: JSON.parse(JSON.stringify(DEFAULT_CLASSIC_TOOLBAR)) as ToolbarEntry[],
        floating: JSON.parse(JSON.stringify(DEFAULT_FLOATING_TOOLBAR)) as ToolbarEntry[],
        blockToolbar: JSON.parse(JSON.stringify(DEFAULT_BLOCK_TOOLBAR)) as ToolbarEntry[]
    };
}
