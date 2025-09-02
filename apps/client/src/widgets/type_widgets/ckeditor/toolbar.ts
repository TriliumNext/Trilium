import utils from "../../../services/utils.js";
import options from "../../../services/options.js";
import ckeditorPluginConfigService from "../../../services/ckeditor_plugin_config.js";

const TEXT_FORMATTING_GROUP = {
    label: "Text formatting",
    icon: "text"
};

export async function buildToolbarConfig(isClassicToolbar: boolean) {
    const hiddenItems = await getHiddenToolbarItems();
    
    if (utils.isMobile()) {
        return buildMobileToolbar(hiddenItems);
    } else if (isClassicToolbar) {
        const multilineToolbar = utils.isDesktop() && options.get("textNoteEditorMultilineToolbar") === "true";
        return buildClassicToolbar(multilineToolbar, hiddenItems);
    } else {
        return buildFloatingToolbar(hiddenItems);
    }
}

async function getHiddenToolbarItems(): Promise<Set<string>> {
    try {
        const hiddenItems = await ckeditorPluginConfigService.getHiddenToolbarItems();
        return new Set(hiddenItems);
    } catch (error) {
        console.warn("Failed to get hidden toolbar items, using empty set:", error);
        return new Set();
    }
}

/**
 * Filter toolbar items based on disabled plugins
 */
function filterToolbarItems(items: (string | object)[], hiddenItems: Set<string>): (string | object)[] {
    return items.filter(item => {
        if (typeof item === 'string') {
            // Don't hide separators
            if (item === '|') return true;
            // Check if this item should be hidden
            return !hiddenItems.has(item);
        } else if (typeof item === 'object' && item !== null && 'items' in item) {
            // Filter nested items recursively
            const nestedItem = item as { items: (string | object)[] };
            const filteredNested = filterToolbarItems(nestedItem.items, hiddenItems);
            // Only keep the group if it has at least one non-separator item
            const hasNonSeparatorItems = filteredNested.some(subItem => 
                typeof subItem === 'string' ? subItem !== '|' : true
            );
            if (hasNonSeparatorItems) {
                return { ...item, items: filteredNested };
            }
            return null;
        }
        return true;
    }).filter(item => item !== null) as (string | object)[];
}

export function buildMobileToolbar(hiddenItems: Set<string>) {
    const classicConfig = buildClassicToolbar(false, hiddenItems);
    const items: string[] = [];

    for (const item of classicConfig.toolbar.items) {
        if (typeof item === "object" && "items" in item) {
            for (const subitem of (item as any).items) {
                items.push(subitem);
            }
        } else {
            items.push(item as string);
        }
    }

    return {
        ...classicConfig,
        toolbar: {
            ...classicConfig.toolbar,
            items
        }
    };
}

export function buildClassicToolbar(multilineToolbar: boolean, hiddenItems: Set<string>) {
    // For nested toolbars, refer to https://ckeditor.com/docs/ckeditor5/latest/getting-started/setup/toolbar.html#grouping-toolbar-items-in-dropdowns-nested-toolbars.
    const items = [
        "heading",
        "fontSize",
        "|",
        "bold",
        "italic",
        {
            ...TEXT_FORMATTING_GROUP,
            items: ["underline", "strikethrough", "|", "superscript", "subscript", "|", "kbd"]
        },
        "|",
        "fontColor",
        "fontBackgroundColor",
        "removeFormat",
        "|",
        "bulletedList",
        "numberedList",
        "todoList",
        "|",
        "blockQuote",
        "admonition",
        "insertTable",
        "|",
        "code",
        "codeBlock",
        "|",
        "footnote",
        {
            label: "Insert",
            icon: "plus",
            items: ["imageUpload", "|", "link", "bookmark", "internallink", "includeNote", "|", "specialCharacters", "emoji", "math", "mermaid", "horizontalLine", "pageBreak", "dateTime"]
        },
        "|",
        "alignment",
        "outdent",
        "indent",
        "|",
        "insertTemplate",
        "markdownImport",
        "cuttonote",
        "findAndReplace"
    ];

    return {
        toolbar: {
            items: filterToolbarItems(items, hiddenItems),
            shouldNotGroupWhenFull: multilineToolbar
        }
    };
}

export function buildFloatingToolbar(hiddenItems: Set<string>) {
    const toolbarItems = [
        "fontSize",
        "bold",
        "italic",
        "underline",
        {
            ...TEXT_FORMATTING_GROUP,
            items: [ "strikethrough", "|", "superscript", "subscript", "|", "kbd" ]
        },
        "|",
        "fontColor",
        "fontBackgroundColor",
        "|",
        "code",
        "link",
        "bookmark",
        "removeFormat",
        "internallink",
        "cuttonote"
    ];

    const blockToolbarItems = [
        "heading",
        "|",
        "bulletedList",
        "numberedList",
        "todoList",
        "|",
        "blockQuote",
        "admonition",
        "codeBlock",
        "insertTable",
        "footnote",
        {
            label: "Insert",
            icon: "plus",
            items: ["link", "bookmark", "internallink", "includeNote", "|", "math", "mermaid", "horizontalLine", "pageBreak", "dateTime"]
        },
        "|",
        "alignment",
        "outdent",
        "indent",
        "|",
        "insertTemplate",
        "imageUpload",
        "markdownImport",
        "specialCharacters",
        "emoji",
        "findAndReplace"
    ];

    return {
        toolbar: {
            items: filterToolbarItems(toolbarItems, hiddenItems)
        },
        blockToolbar: filterToolbarItems(blockToolbarItems, hiddenItems)
    };
}
