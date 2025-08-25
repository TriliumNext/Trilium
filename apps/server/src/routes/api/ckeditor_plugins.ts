/**
 * @module CKEditor Plugins API
 * 
 * This module provides REST endpoints for managing CKEditor plugin configuration
 * in Trilium Notes. It handles plugin enablement, validation, and user preferences.
 */

import options from "../../services/options.js";
import type { Request, Response } from "express";
import type { 
    PluginConfiguration, 
    PluginRegistry, 
    PluginValidationResult, 
    UpdatePluginConfigRequest,
    UpdatePluginConfigResponse,
    QueryPluginsOptions,
    QueryPluginsResult,
    PluginMetadata
} from "@triliumnext/commons";
import { PLUGIN_REGISTRY, getPluginMetadata, getPluginsByCategory, getConfigurablePlugins } from "@triliumnext/ckeditor5";
import log from "../../services/log.js";

/**
 * Get the complete plugin registry with metadata
 */
export function getPluginRegistry(): PluginRegistry {
    return PLUGIN_REGISTRY;
}

/**
 * Get current user's plugin configuration
 */
export function getUserPluginConfig(): PluginConfiguration[] {
    const enabledPluginsJson = options.getOptionOrNull("ckeditorEnabledPlugins");
    
    if (!enabledPluginsJson) {
        // Return default configuration if none exists
        return getDefaultPluginConfiguration();
    }

    try {
        const enabledPlugins = JSON.parse(enabledPluginsJson) as string[];
        
        // Convert to PluginConfiguration array
        return Object.keys(PLUGIN_REGISTRY.plugins).map(pluginId => ({
            id: pluginId,
            enabled: enabledPlugins.includes(pluginId)
        }));
    } catch (error) {
        log.error(`Failed to parse CKEditor plugin configuration: ${error}`);
        return getDefaultPluginConfiguration();
    }
}

/**
 * Get default plugin configuration (all non-premium plugins enabled)
 */
function getDefaultPluginConfiguration(): PluginConfiguration[] {
    return Object.values(PLUGIN_REGISTRY.plugins).map(plugin => ({
        id: plugin.id,
        enabled: plugin.defaultEnabled && !plugin.requiresPremium
    }));
}

/**
 * Update user's plugin configuration
 */
export function updateUserPluginConfig(request: UpdatePluginConfigRequest): UpdatePluginConfigResponse {
    const { plugins, validate = true } = request;
    
    try {
        // Validate if requested
        let validation: PluginValidationResult | undefined;
        if (validate) {
            validation = validatePluginConfiguration(plugins);
            if (!validation.valid) {
                return {
                    success: false,
                    validation,
                    plugins: [],
                    errors: validation.errors.map(err => err.message)
                };
            }
        }

        // Save configuration
        const enabledPluginIds = plugins
            .filter(plugin => plugin.enabled)
            .map(plugin => plugin.id);

        options.setOption("ckeditorEnabledPlugins", JSON.stringify(enabledPluginIds));

        log.info(`Updated CKEditor plugin configuration: ${enabledPluginIds.length} plugins enabled`);

        return {
            success: true,
            validation,
            plugins: plugins,
            errors: []
        };
    } catch (error) {
        log.error(`Failed to update CKEditor plugin configuration: ${error}`);
        return {
            success: false,
            plugins: [],
            errors: [`Failed to update configuration: ${error}`]
        };
    }
}

/**
 * Query plugins with filtering options
 */
export function queryPlugins(options: QueryPluginsOptions = {}): QueryPluginsResult {
    const { category, enabled, coreOnly, includeConfig } = options;
    
    let plugins = Object.values(PLUGIN_REGISTRY.plugins);

    // Apply filters
    if (category) {
        plugins = plugins.filter(plugin => plugin.category === category);
    }

    if (coreOnly === true) {
        plugins = plugins.filter(plugin => plugin.isCore);
    } else if (coreOnly === false) {
        plugins = plugins.filter(plugin => !plugin.isCore);
    }

    // Get user configuration if requested or filtering by enabled status
    let userConfig: PluginConfiguration[] = [];
    if (includeConfig || enabled !== undefined) {
        userConfig = getUserPluginConfig();
    }

    // Filter by enabled status
    if (enabled !== undefined) {
        const enabledPluginIds = new Set(
            userConfig.filter(config => config.enabled).map(config => config.id)
        );
        plugins = plugins.filter(plugin => 
            enabled ? enabledPluginIds.has(plugin.id) : !enabledPluginIds.has(plugin.id)
        );
    }

    // Add user configuration if requested
    const result = plugins.map(plugin => {
        if (includeConfig) {
            const config = userConfig.find(config => config.id === plugin.id);
            return {
                ...plugin,
                enabled: config?.enabled ?? false,
                config: config?.config
            };
        }
        return plugin;
    });

    // Get available categories
    const categories = [...new Set(Object.values(PLUGIN_REGISTRY.plugins).map(plugin => plugin.category))];

    return {
        plugins: result,
        totalCount: Object.keys(PLUGIN_REGISTRY.plugins).length,
        categories: categories as any[]
    };
}

/**
 * Validate plugin configuration for dependencies and conflicts
 */
export function validatePluginConfiguration(plugins: PluginConfiguration[]): PluginValidationResult {
    const errors: any[] = [];
    const warnings: any[] = [];
    const enabledPlugins = new Set(plugins.filter(p => p.enabled).map(p => p.id));
    const resolvedPlugins = new Set<string>();

    // Check each enabled plugin
    for (const plugin of plugins.filter(p => p.enabled)) {
        const metadata = getPluginMetadata(plugin.id);
        
        if (!metadata) {
            errors.push({
                type: "missing_dependency",
                pluginId: plugin.id,
                message: `Plugin '${plugin.id}' not found in registry`
            });
            continue;
        }

        // Check premium requirements
        if (metadata.requiresPremium && !hasPremiumLicense()) {
            errors.push({
                type: "premium_required",
                pluginId: plugin.id,
                message: `Plugin '${metadata.name}' requires a premium CKEditor license`
            });
            continue;
        }

        // Check dependencies
        for (const depId of metadata.dependencies) {
            if (!enabledPlugins.has(depId)) {
                const depMetadata = getPluginMetadata(depId);
                errors.push({
                    type: "missing_dependency",
                    pluginId: plugin.id,
                    message: `Plugin '${metadata.name}' requires '${depMetadata?.name || depId}' to be enabled`,
                    details: { dependency: depId }
                });
            }
        }

        // Check conflicts
        for (const conflictId of metadata.conflicts) {
            if (enabledPlugins.has(conflictId)) {
                const conflictMetadata = getPluginMetadata(conflictId);
                errors.push({
                    type: "plugin_conflict",
                    pluginId: plugin.id,
                    message: `Plugin '${metadata.name}' conflicts with '${conflictMetadata?.name || conflictId}'`,
                    details: { conflict: conflictId }
                });
            }
        }

        resolvedPlugins.add(plugin.id);
    }

    // Add core plugins to resolved list (they're always enabled)
    for (const plugin of Object.values(PLUGIN_REGISTRY.plugins)) {
        if (plugin.isCore) {
            resolvedPlugins.add(plugin.id);
        }
    }

    // Check for circular dependencies (simplified check)
    const visited = new Set<string>();
    const visiting = new Set<string>();

    function hasCircularDependency(pluginId: string): boolean {
        if (visiting.has(pluginId)) {
            return true;
        }
        if (visited.has(pluginId)) {
            return false;
        }

        visiting.add(pluginId);
        const metadata = getPluginMetadata(pluginId);
        
        if (metadata) {
            for (const depId of metadata.dependencies) {
                if (enabledPlugins.has(depId) && hasCircularDependency(depId)) {
                    return true;
                }
            }
        }

        visiting.delete(pluginId);
        visited.add(pluginId);
        return false;
    }

    for (const pluginId of enabledPlugins) {
        if (hasCircularDependency(pluginId)) {
            errors.push({
                type: "circular_dependency",
                pluginId: pluginId,
                message: `Circular dependency detected for plugin '${getPluginMetadata(pluginId)?.name || pluginId}'`
            });
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        resolvedPlugins: Array.from(resolvedPlugins)
    };
}

/**
 * Check if user has premium CKEditor license
 */
function hasPremiumLicense(): boolean {
    // This would check the actual license key
    // For now, assume no premium license
    return process.env.VITE_CKEDITOR_KEY !== undefined && process.env.VITE_CKEDITOR_KEY !== "";
}

/**
 * Reset plugin configuration to defaults
 */
export function resetPluginConfigToDefaults(): UpdatePluginConfigResponse {
    const defaultConfig = getDefaultPluginConfiguration();
    
    return updateUserPluginConfig({
        plugins: defaultConfig,
        validate: false
    });
}

/**
 * Get plugin statistics
 */
export function getPluginStats() {
    const userConfig = getUserPluginConfig();
    const enabledCount = userConfig.filter(p => p.enabled).length;
    const totalCount = Object.keys(PLUGIN_REGISTRY.plugins).length;
    const coreCount = Object.values(PLUGIN_REGISTRY.plugins).filter(p => p.isCore).length;
    const premiumCount = Object.values(PLUGIN_REGISTRY.plugins).filter(p => p.requiresPremium).length;

    const categoryCounts = Object.values(PLUGIN_REGISTRY.plugins).reduce((acc, plugin) => {
        acc[plugin.category] = (acc[plugin.category] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    return {
        enabled: enabledCount,
        total: totalCount,
        core: coreCount,
        premium: premiumCount,
        configurable: totalCount - coreCount,
        categories: categoryCounts,
        hasPremiumLicense: hasPremiumLicense()
    };
}

// Express route handlers
function getPluginRegistryHandler(req: Request, res: Response) {
    res.json(getPluginRegistry());
}

function getUserPluginConfigHandler(req: Request, res: Response) {
    res.json(getUserPluginConfig());
}

function updateUserPluginConfigHandler(req: Request, res: Response) {
    const updateRequest: UpdatePluginConfigRequest = req.body;
    const result = updateUserPluginConfig(updateRequest);
    
    if (!result.success) {
        res.status(400).json(result);
    } else {
        res.json(result);
    }
}

function queryPluginsHandler(req: Request, res: Response) {
    const queryOptions: QueryPluginsOptions = {
        category: req.query.category as string,
        enabled: req.query.enabled === 'true' ? true : req.query.enabled === 'false' ? false : undefined,
        coreOnly: req.query.coreOnly === 'true' ? true : req.query.coreOnly === 'false' ? false : undefined,
        includeConfig: req.query.includeConfig === 'true'
    };
    
    res.json(queryPlugins(queryOptions));
}

function validatePluginConfigurationHandler(req: Request, res: Response) {
    const plugins: PluginConfiguration[] = req.body.plugins || [];
    res.json(validatePluginConfiguration(plugins));
}

function resetPluginConfigToDefaultsHandler(req: Request, res: Response) {
    const result = resetPluginConfigToDefaults();
    
    if (!result.success) {
        res.status(400).json(result);
    } else {
        res.json(result);
    }
}

function getPluginStatsHandler(req: Request, res: Response) {
    res.json(getPluginStats());
}

export default {
    getPluginRegistry: getPluginRegistryHandler,
    getUserPluginConfig: getUserPluginConfigHandler,
    updateUserPluginConfig: updateUserPluginConfigHandler,
    queryPlugins: queryPluginsHandler,
    validatePluginConfiguration: validatePluginConfigurationHandler,
    resetPluginConfigToDefaults: resetPluginConfigToDefaultsHandler,
    getPluginStats: getPluginStatsHandler
};