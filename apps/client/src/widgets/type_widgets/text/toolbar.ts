import options from "../../../services/options.js";
import utils from "../../../services/utils.js";
import {
    DEFAULT_BLOCK_TOOLBAR,
    DEFAULT_CLASSIC_TOOLBAR,
    DEFAULT_FLOATING_TOOLBAR,
    entriesToCKItems,
    type ToolbarCustomConfig
} from "./toolbar_config.js";

export function buildToolbarConfig(isClassicToolbar: boolean) {
    if (utils.isMobile()) {
        return buildMobileToolbar();
    } else if (isClassicToolbar) {
        const multilineToolbar = utils.isDesktop() && options.get("textNoteEditorMultilineToolbar") === "true";
        return buildClassicToolbar(multilineToolbar);
    } else {
        return buildFloatingToolbar();
    }
}

export function buildMobileToolbar() {
    const classicConfig = buildClassicToolbar(false);
    const items: string[] = [];

    for (const item of classicConfig.toolbar.items) {
        if (typeof item === "object" && "items" in item) {
            for (const subitem of (item as { items: string[] }).items) {
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

export function buildClassicToolbar(multilineToolbar: boolean) {
    // For nested toolbars, refer to https://ckeditor.com/docs/ckeditor5/latest/getting-started/setup/toolbar.html#grouping-toolbar-items-in-dropdowns-nested-toolbars.
    return {
        toolbar: {
            items: resolveClassicItems(),
            shouldNotGroupWhenFull: multilineToolbar
        }
    };
}

export function buildFloatingToolbar() {
    return {
        toolbar: {
            items: resolveFloatingItems()
        },

        blockToolbar: resolveBlockToolbarItems()
    };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Parse the stored toolbar config option.
 * Returns null when no custom config is set (empty string or invalid JSON).
 */
function parseStoredConfig(): ToolbarCustomConfig | null {
    const raw = options.get("textNoteToolbarConfig");
    if (!raw) {
        return null;
    }
    try {
        return JSON.parse(raw) as ToolbarCustomConfig;
    } catch {
        return null;
    }
}

function resolveClassicItems(): (string | object)[] {
    const cfg = parseStoredConfig();
    return entriesToCKItems(cfg?.classic ?? DEFAULT_CLASSIC_TOOLBAR);
}

function resolveFloatingItems(): (string | object)[] {
    const cfg = parseStoredConfig();
    return entriesToCKItems(cfg?.floating ?? DEFAULT_FLOATING_TOOLBAR);
}

function resolveBlockToolbarItems(): (string | object)[] {
    const cfg = parseStoredConfig();
    return entriesToCKItems(cfg?.blockToolbar ?? DEFAULT_BLOCK_TOOLBAR);
}
