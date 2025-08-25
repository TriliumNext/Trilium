/**
 * @module CKEditor Plugin Interface
 * 
 * This module defines the TypeScript interfaces and types for managing
 * CKEditor plugins in Trilium Notes. It provides type-safe configuration
 * for plugin enablement, metadata, and dependency management.
 */

/**
 * Defines the categories of CKEditor plugins available in Trilium.
 */
export type PluginCategory = 
    | "formatting"    // Text formatting (bold, italic, etc.)
    | "structure"     // Document structure (headings, lists, etc.)
    | "media"        // Images, files, embeds
    | "tables"       // Table-related functionality
    | "advanced"     // Advanced features (math, mermaid, etc.)
    | "trilium"      // Trilium-specific plugins
    | "external";    // Third-party plugins

/**
 * Represents the metadata for a CKEditor plugin.
 */
export interface PluginMetadata {
    /** Unique identifier for the plugin */
    id: string;
    /** Human-readable display name */
    name: string;
    /** Brief description of the plugin's functionality */
    description: string;
    /** Category this plugin belongs to */
    category: PluginCategory;
    /** Whether this plugin is enabled by default for new users */
    defaultEnabled: boolean;
    /** Array of plugin IDs that this plugin depends on */
    dependencies: string[];
    /** Array of plugin IDs that conflict with this plugin */
    conflicts: string[];
    /** Whether this plugin requires a premium CKEditor license */
    requiresPremium: boolean;
    /** Whether this plugin is part of the core editor functionality (cannot be disabled) */
    isCore: boolean;
    /** Toolbar items/commands provided by this plugin */
    toolbarItems?: string[];
    /** Commands provided by this plugin */
    commands?: string[];
}

/**
 * Configuration for a user's CKEditor plugin preferences.
 */
export interface PluginConfiguration {
    /** Plugin ID */
    id: string;
    /** Whether the plugin is enabled for this user */
    enabled: boolean;
    /** User-specific configuration for the plugin (if any) */
    config?: Record<string, unknown>;
}

/**
 * The complete registry of available CKEditor plugins.
 */
export interface PluginRegistry {
    /** Map of plugin ID to plugin metadata */
    plugins: Record<string, PluginMetadata>;
    /** Version of the plugin registry (for cache invalidation) */
    version: string;
    /** Last modified timestamp */
    lastModified: string;
}

/**
 * Result of plugin dependency validation.
 */
export interface PluginValidationResult {
    /** Whether the configuration is valid */
    valid: boolean;
    /** Array of validation errors */
    errors: PluginValidationError[];
    /** Array of warnings (non-blocking issues) */
    warnings: PluginValidationWarning[];
    /** Resolved list of plugins that should be enabled */
    resolvedPlugins: string[];
}

/**
 * Validation error for plugin configuration.
 */
export interface PluginValidationError {
    /** Type of error */
    type: "missing_dependency" | "circular_dependency" | "plugin_conflict" | "premium_required";
    /** Plugin ID that caused the error */
    pluginId: string;
    /** Human-readable error message */
    message: string;
    /** Additional context about the error */
    details?: Record<string, unknown>;
}

/**
 * Validation warning for plugin configuration.
 */
export interface PluginValidationWarning {
    /** Type of warning */
    type: "dependency_disabled" | "unused_dependency" | "performance_impact";
    /** Plugin ID that caused the warning */
    pluginId: string;
    /** Human-readable warning message */
    message: string;
    /** Additional context about the warning */
    details?: Record<string, unknown>;
}

/**
 * Request to update plugin configuration.
 */
export interface UpdatePluginConfigRequest {
    /** Array of plugin configurations to update */
    plugins: PluginConfiguration[];
    /** Whether to validate dependencies before saving */
    validate?: boolean;
}

/**
 * Response from updating plugin configuration.
 */
export interface UpdatePluginConfigResponse {
    /** Whether the update was successful */
    success: boolean;
    /** Validation result (if validation was requested) */
    validation?: PluginValidationResult;
    /** Updated plugin configurations */
    plugins: PluginConfiguration[];
    /** Any errors that occurred during the update */
    errors?: string[];
}

/**
 * Options for querying the plugin registry.
 */
export interface QueryPluginsOptions {
    /** Filter by category */
    category?: PluginCategory;
    /** Filter by enabled status */
    enabled?: boolean;
    /** Filter by core status */
    coreOnly?: boolean;
    /** Include user configuration in results */
    includeConfig?: boolean;
}

/**
 * Result of querying plugins.
 */
export interface QueryPluginsResult {
    /** Array of plugin metadata */
    plugins: (PluginMetadata & { enabled?: boolean; config?: Record<string, unknown> })[];
    /** Total count of plugins (before filtering) */
    totalCount: number;
    /** Categories available in the registry */
    categories: PluginCategory[];
}