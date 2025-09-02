/**
 * @module CKEditor Plugin Configuration Service
 * 
 * This service manages the dynamic configuration of CKEditor plugins based on user preferences.
 * It handles plugin enablement, dependency resolution, and toolbar configuration.
 */

import server from "./server.js";
import type { 
    PluginConfiguration, 
    PluginMetadata, 
    PluginRegistry,
    PluginValidationResult
} from "@triliumnext/commons";

/**
 * Cache for plugin registry and user configuration
 */
let pluginRegistryCache: PluginRegistry | null = null;
let userConfigCache: PluginConfiguration[] | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Get the plugin registry from server
 */
export async function getPluginRegistry(): Promise<PluginRegistry> {
    const now = Date.now();
    if (pluginRegistryCache && (now - cacheTimestamp) < CACHE_DURATION) {
        return pluginRegistryCache;
    }
    
    try {
        pluginRegistryCache = await server.get<PluginRegistry>('ckeditor-plugins/registry');
        cacheTimestamp = now;
        return pluginRegistryCache;
    } catch (error) {
        console.error('Failed to load CKEditor plugin registry:', error);
        throw error;
    }
}

/**
 * Get the user's plugin configuration from server
 */
export async function getUserPluginConfig(): Promise<PluginConfiguration[]> {
    const now = Date.now();
    if (userConfigCache && (now - cacheTimestamp) < CACHE_DURATION) {
        return userConfigCache;
    }
    
    try {
        userConfigCache = await server.get<PluginConfiguration[]>('ckeditor-plugins/config');
        cacheTimestamp = now;
        return userConfigCache;
    } catch (error) {
        console.error('Failed to load user plugin configuration:', error);
        throw error;
    }
}

/**
 * Clear the cache (call when configuration is updated)
 */
export function clearCache(): void {
    pluginRegistryCache = null;
    userConfigCache = null;
    cacheTimestamp = 0;
}

/**
 * Get the enabled plugins for the current user
 */
export async function getEnabledPlugins(): Promise<Set<string>> {
    const userConfig = await getUserPluginConfig();
    const enabledPlugins = new Set<string>();
    
    // Add all enabled user plugins
    userConfig.forEach(config => {
        if (config.enabled) {
            enabledPlugins.add(config.id);
        }
    });
    
    // Always include core plugins
    const registry = await getPluginRegistry();
    Object.values(registry.plugins).forEach(plugin => {
        if (plugin.isCore) {
            enabledPlugins.add(plugin.id);
        }
    });
    
    return enabledPlugins;
}

/**
 * Get disabled plugin names for CKEditor config
 */
export async function getDisabledPlugins(): Promise<string[]> {
    try {
        const registry = await getPluginRegistry();
        const enabledPlugins = await getEnabledPlugins();
        const disabledPlugins: string[] = [];
        
        // Find plugins that are disabled
        Object.values(registry.plugins).forEach(plugin => {
            if (!plugin.isCore && !enabledPlugins.has(plugin.id)) {
                // Map plugin ID to actual CKEditor plugin names if needed
                const pluginNames = getPluginNames(plugin.id);
                disabledPlugins.push(...pluginNames);
            }
        });
        
        return disabledPlugins;
    } catch (error) {
        console.warn("Failed to get disabled plugins, returning empty list:", error);
        return [];
    }
}

/**
 * Map plugin ID to actual CKEditor plugin names
 * Some plugins might have multiple names or different names than their ID
 */
function getPluginNames(pluginId: string): string[] {
    const nameMap: Record<string, string[]> = {
        "emoji": ["EmojiMention", "EmojiPicker"],
        "math": ["Math", "AutoformatMath"],
        "image": ["Image", "ImageCaption", "ImageInline", "ImageResize", "ImageStyle", "ImageToolbar", "ImageUpload"],
        "table": ["Table", "TableToolbar", "TableProperties", "TableCellProperties", "TableSelection", "TableCaption", "TableColumnResize"],
        "font": ["Font", "FontColor", "FontBackgroundColor"],
        "list": ["List", "ListProperties"],
        "specialcharacters": ["SpecialCharacters", "SpecialCharactersEssentials"],
        "findandreplace": ["FindAndReplace"],
        "horizontalline": ["HorizontalLine"],
        "pagebreak": ["PageBreak"],
        "removeformat": ["RemoveFormat"],
        "alignment": ["Alignment"],
        "indent": ["Indent", "IndentBlock"],
        "codeblock": ["CodeBlock"],
        "blockquote": ["BlockQuote"],
        "todolist": ["TodoList"],
        "heading": ["Heading", "HeadingButtonsUI"],
        "paragraph": ["ParagraphButtonUI"],
        // Add more mappings as needed
    };
    
    return nameMap[pluginId] || [pluginId.charAt(0).toUpperCase() + pluginId.slice(1)];
}

/**
 * Validate the current plugin configuration
 */
export async function validatePluginConfiguration(): Promise<PluginValidationResult> {
    try {
        const userConfig = await getUserPluginConfig();
        return await server.post<PluginValidationResult>('ckeditor-plugins/validate', {
            plugins: userConfig
        });
    } catch (error) {
        console.error('Failed to validate plugin configuration:', error);
        return {
            valid: false,
            errors: [{
                type: "missing_dependency",
                pluginId: "unknown",
                message: `Validation failed: ${error}`
            }],
            warnings: [],
            resolvedPlugins: []
        };
    }
}

/**
 * Get toolbar items that should be hidden based on disabled plugins
 */
export async function getHiddenToolbarItems(): Promise<string[]> {
    const registry = await getPluginRegistry();
    const enabledPlugins = await getEnabledPlugins();
    const hiddenItems: string[] = [];
    
    Object.values(registry.plugins).forEach(plugin => {
        if (!enabledPlugins.has(plugin.id) && plugin.toolbarItems) {
            hiddenItems.push(...plugin.toolbarItems);
        }
    });
    
    return hiddenItems;
}

/**
 * Update user plugin configuration
 */
export async function updatePluginConfiguration(plugins: PluginConfiguration[]): Promise<void> {
    try {
        const response = await server.put('ckeditor-plugins/config', {
            plugins,
            validate: true
        });
        
        if (!response.success) {
            throw new Error(response.errors?.join(", ") || "Update failed");
        }
        
        // Clear cache so next requests fetch fresh data
        clearCache();
    } catch (error) {
        console.error('Failed to update plugin configuration:', error);
        throw error;
    }
}

export default {
    getPluginRegistry,
    getUserPluginConfig,
    getEnabledPlugins,
    getDisabledPlugins,
    getHiddenToolbarItems,
    validatePluginConfiguration,
    updatePluginConfiguration,
    clearCache
};