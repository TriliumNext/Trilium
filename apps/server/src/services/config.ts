/**
 * ╔════════════════════════════════════════════════════════════════════════════╗
 * ║                     TRILIUM CONFIGURATION RESOLUTION ORDER                 ║
 * ╠════════════════════════════════════════════════════════════════════════════╣
 * ║                                                                            ║
 * ║   Priority │ Source                          │ Example                     ║
 * ║   ─────────┼─────────────────────────────────┼─────────────────────────────║
 * ║      1     │ Environment Variables           │ TRILIUM_NETWORK_PORT=8080   ║
 * ║      ↓     │ (Highest Priority - Overrides all)                            ║
 * ║            │                                                                ║
 * ║      2     │ config.ini File                 │ [Network]                   ║
 * ║      ↓     │ (User Configuration)            │ port=8080                   ║
 * ║            │                                                                ║
 * ║      3     │ Default Values                  │ port='3000'                 ║
 * ║            │ (Lowest Priority - Fallback)    │ (hardcoded defaults)        ║
 * ║                                                                            ║
 * ╠════════════════════════════════════════════════════════════════════════════╣
 * ║ IMPORTANT: Environment variables ALWAYS override config.ini values!        ║
 * ╚════════════════════════════════════════════════════════════════════════════╝
 */

import { utils } from "@triliumnext/core";
import fs from "fs";
import ini from "ini";
import path from "path";

import dataDir from "./data_dir.js";
import resourceDir from "./resource_dir.js";

/**
 * Path to the sample configuration file copied into the data directory on first
 * run. Desktop builds get a trimmed template: web-deployment options (host, port,
 * CORS, reverse proxy, sessions, OAuth) don't apply because the renderer talks to
 * the bundled server in-process, and network/scripting are managed through the UI.
 * `process.versions.electron` is used (not the core `isElectron()`) because this
 * runs at module load, before the platform is initialized.
 */
const configSampleFileName = process.versions.electron ? "config-sample-desktop.ini" : "config-sample.ini";
const configSampleFilePath = path.resolve(resourceDir.RESOURCE_DIR, configSampleFileName);

/**
 * Initialize config.ini file if it doesn't exist.
 * On first run, copies the sample configuration to the data directory,
 * allowing users to customize their settings.
 */
if (!fs.existsSync(dataDir.CONFIG_INI_PATH)) {
    const configSample = fs.readFileSync(configSampleFilePath).toString("utf8");
    fs.writeFileSync(dataDir.CONFIG_INI_PATH, configSample);
}

/**
 * Type definition for the parsed INI configuration structure.
 * The ini parser returns an object with string keys and values that can be
 * strings, booleans, numbers, or nested objects.
 */
type IniConfigValue = string | number | boolean | null | undefined;
type IniConfigSection = Record<string, IniConfigValue>;
type IniConfig = Record<string, IniConfigSection | IniConfigValue>;

/**
 * Parse the config.ini file into a JavaScript object.
 * This object contains all user-defined configuration from the INI file,
 * which will be merged with environment variables and defaults.
 */
const iniConfig = ini.parse(fs.readFileSync(dataDir.CONFIG_INI_PATH, "utf-8")) as IniConfig;

/**
 * Complete type-safe configuration interface for Trilium.
 * This interface defines all configuration options available through
 * environment variables, config.ini, or defaults.
 */
export interface TriliumConfig {
    /** General application settings */
    General: {
        /** Custom instance name for identifying this Trilium instance */
        instanceName: string;
        /** Whether to disable authentication (useful for local-only instances) */
        noAuthentication: boolean;
        /** Whether to disable automatic backups */
        noBackup: boolean;
        /** Whether to prevent desktop icon creation (desktop app only) */
        noDesktopIcon: boolean;
        /** Whether to run in read-only mode (prevents all data modifications) */
        readOnly: boolean;
    };
    /** Network and server configuration */
    Network: {
        /** Host/IP address to bind the server to (e.g., '0.0.0.0' for all interfaces) */
        host: string;
        /** Port number for the HTTP/HTTPS server */
        port: string;
        /** Whether to enable HTTPS (requires certPath and keyPath) */
        https: boolean;
        /** Path to SSL certificate file (required when https=true) */
        certPath: string;
        /** Path to SSL private key file (required when https=true) */
        keyPath: string;
        /** Trust reverse proxy headers (boolean or specific IP/subnet string) */
        trustedReverseProxy: boolean | string;
        /** CORS allowed origins (comma-separated list or '*' for all) */
        corsAllowOrigin: string;
        /** CORS allowed methods (comma-separated HTTP methods) */
        corsAllowMethods: string;
        /** CORS allowed headers (comma-separated header names) */
        corsAllowHeaders: string;
        /** CORS Resource Policy ('same-origin', 'same-site', 'cross-origin') */
        corsResourcePolicy: string;
    };
    /** Session management configuration */
    Session: {
        /** Maximum age of session cookies in seconds (default: 21 days) */
        cookieMaxAge: number;
    };
    /** Synchronization settings for multi-instance setups */
    Sync: {
        /** URL of the sync server to connect to */
        syncServerHost: string;
        /** Timeout for sync operations in milliseconds */
        syncServerTimeout: string;
        /** Proxy URL for sync connections (if behind corporate proxy) */
        syncProxy: string;
    };
    /** Multi-factor authentication and OAuth/OpenID configuration */
    MultiFactorAuthentication: {
        /** Base URL for OAuth authentication endpoint */
        oauthBaseUrl: string;
        /** OAuth client ID from your identity provider */
        oauthClientId: string;
        /** OAuth client secret from your identity provider */
        oauthClientSecret: string;
        /** Base URL of the OAuth issuer (e.g., 'https://accounts.google.com') */
        oauthIssuerBaseUrl: string;
        /** Display name of the OAuth provider (shown in UI) */
        oauthIssuerName: string;
        /** URL to the OAuth provider's icon/logo */
        oauthIssuerIcon: string;
        /** Timeout in milliseconds for OAuth/OIDC HTTP requests (discovery, token exchange, userinfo). Default: 30000 */
        oauthHttpTimeout: number;
        /** Space-separated OIDC scopes requested at login. Default: 'openid profile email' */
        oauthScope: string;
    };
    /** Logging configuration */
    Logging: {
        /**
         * The number of days to keep the log files around. When rotating the logs,
         * log files created by Trilium older than the specified amount of time will be deleted.
         */
        retentionDays: number;
    };
    /** Security and code execution configuration */
    Security: {
        /** Whether backend script execution is enabled (default: false for server, true for desktop) */
        backendScriptingEnabled: boolean;
        /** Whether the SQL console is accessible (default: false) */
        sqlConsoleEnabled: boolean;
        /**
         * Desktop only: whether the TCP listener binds all interfaces (LAN-reachable)
         * instead of loopback. Managed via the desktop `security.json` override, not
         * config.ini. Consumed by host.ts; has no effect on server builds.
         */
        allowLanAccess: boolean;
    };
}

/**
 * Default retention period for log files in days.
 * After this period, old log files are automatically deleted during rotation.
 */
export const LOGGING_DEFAULT_RETENTION_DAYS = 90;

/**
 * Configuration value source with precedence handling.
 * This interface defines how each configuration value is resolved from multiple sources.
 */
interface ConfigValue<T> {
    /**
     * Standard environment variable name following TRILIUM_[SECTION]_[KEY] pattern.
     * This is the primary way to override configuration via environment.
     */
    standardEnvVar?: string;
    /**
     * Alternative environment variable names for additional flexibility.
     * These provide shorter or more intuitive names for common settings.
     */
    aliasEnvVars?: string[];
    /**
     * Function to retrieve the value from the parsed INI configuration.
     * Returns undefined if the value is not set in config.ini.
     */
    iniGetter: () => IniConfigValue | IniConfigSection;
    /**
     * Default value used when no environment variable or INI value is found.
     * This ensures every configuration has a sensible default.
     */
    defaultValue: T;
    /**
     * Optional transformer function to convert string values to the correct type.
     * Common transformers handle boolean and integer conversions.
     */
    transformer?: (value: unknown) => T;
}

/**
 * Core configuration resolution function.
 *
 * Resolves configuration values using a clear precedence order:
 * 1. Standard environment variable (highest priority) - Follows TRILIUM_[SECTION]_[KEY] pattern
 * 2. Alias environment variables - Alternative names for convenience and compatibility
 * 3. INI config file value - User-defined settings in config.ini
 * 4. Default value (lowest priority) - Fallback to ensure valid configuration
 *
 * This precedence allows for flexible configuration management:
 * - Environment variables for container/cloud deployments
 * - config.ini for traditional installations
 * - Defaults ensure the application always has valid settings
 *
 * @param config - Configuration value definition with sources and transformers
 * @returns The resolved configuration value with appropriate type
 */
function getConfigValue<T>(config: ConfigValue<T>): T {
    // Check standard env var first
    if (config.standardEnvVar && process.env[config.standardEnvVar] !== undefined) {
        const value = process.env[config.standardEnvVar];
        return config.transformer ? config.transformer(value) : value as T;
    }

    // Check alternative env vars for additional flexibility
    if (config.aliasEnvVars) {
        for (const aliasVar of config.aliasEnvVars) {
            if (process.env[aliasVar] !== undefined) {
                const value = process.env[aliasVar];
                return config.transformer ? config.transformer(value) : value as T;
            }
        }
    }

    // Check INI config
    const iniValue = config.iniGetter();
    if (iniValue !== undefined && iniValue !== null && iniValue !== '') {
        return config.transformer ? config.transformer(iniValue) : iniValue as T;
    }

    // Return default
    return config.defaultValue;
}

/**
 * Helper function to safely access INI config sections.
 * The ini parser can return either a section object or a primitive value,
 * so we need to check the type before accessing nested properties.
 *
 * @param sectionName - The name of the INI section to access
 * @returns The section object or undefined if not found or not an object
 */
function getIniSection(sectionName: string): IniConfigSection | undefined {
    const section = iniConfig[sectionName];
    if (section && typeof section === 'object' && !Array.isArray(section)) {
        return section as IniConfigSection;
    }
    return undefined;
}

/**
 * Transform a value to boolean, handling various input formats.
 *
 * This function provides flexible boolean parsing to handle different
 * configuration sources (environment variables, INI files, etc.):
 * - String "true"/"false" (case-insensitive)
 * - String "1"/"0"
 * - Numeric 1/0
 * - Actual boolean values
 * - Any other value defaults to false
 *
 * @param value - The value to transform (string, number, boolean, etc.)
 * @returns The boolean value or false as default
 */
function transformBoolean(value: unknown): boolean {
    // First try the standard envToBoolean function which handles "true"/"false" strings
    const result = utils.envToBoolean(String(value));
    if (result !== undefined) return result;

    // Handle numeric boolean values (both string and number types)
    if (value === "1" || value === 1) return true;
    if (value === "0" || value === 0) return false;

    // Default to false for any other value
    return false;
}

/**
 * Complete configuration mapping that defines how each setting is resolved.
 *
 * This mapping structure:
 * 1. Mirrors the INI file sections for consistency
 * 2. Defines multiple sources for each configuration value
 * 3. Provides type transformers where needed
 * 4. Maintains compatibility with various environment variable formats
 *
 * Environment Variable Patterns:
 * - Standard: TRILIUM_[SECTION]_[KEY] (e.g., TRILIUM_GENERAL_INSTANCENAME)
 * - Aliases: Shorter alternatives (e.g., TRILIUM_OAUTH_BASE_URL)
 *
 * Both patterns are equally valid and can be used based on preference.
 * The standard pattern provides consistency, while aliases offer convenience.
 */
const configMapping = {
    General: {
        instanceName: {
            standardEnvVar: 'TRILIUM_GENERAL_INSTANCENAME',
            iniGetter: () => getIniSection("General")?.instanceName,
            defaultValue: ''
        },
        noAuthentication: {
            standardEnvVar: 'TRILIUM_GENERAL_NOAUTHENTICATION',
            iniGetter: () => getIniSection("General")?.noAuthentication,
            defaultValue: false,
            transformer: transformBoolean
        },
        noBackup: {
            standardEnvVar: 'TRILIUM_GENERAL_NOBACKUP',
            iniGetter: () => getIniSection("General")?.noBackup,
            defaultValue: false,
            transformer: transformBoolean
        },
        noDesktopIcon: {
            standardEnvVar: 'TRILIUM_GENERAL_NODESKTOPICON',
            iniGetter: () => getIniSection("General")?.noDesktopIcon,
            defaultValue: false,
            transformer: transformBoolean
        },
        readOnly: {
            standardEnvVar: 'TRILIUM_GENERAL_READONLY',
            iniGetter: () => getIniSection("General")?.readOnly,
            defaultValue: false,
            transformer: transformBoolean
        }
    },
    Network: {
        host: {
            // Web/server only — desktop ignores this and resolves its bind
            // address from the `allowLanAccess` security override (see host.ts).
            standardEnvVar: 'TRILIUM_NETWORK_HOST',
            iniGetter: () => getIniSection("Network")?.host,
            defaultValue: '0.0.0.0'
        },
        port: {
            standardEnvVar: 'TRILIUM_NETWORK_PORT',
            iniGetter: () => getIniSection("Network")?.port,
            defaultValue: '3000'
        },
        https: {
            standardEnvVar: 'TRILIUM_NETWORK_HTTPS',
            iniGetter: () => getIniSection("Network")?.https,
            defaultValue: false,
            transformer: transformBoolean
        },
        certPath: {
            standardEnvVar: 'TRILIUM_NETWORK_CERTPATH',
            iniGetter: () => getIniSection("Network")?.certPath,
            defaultValue: ''
        },
        keyPath: {
            standardEnvVar: 'TRILIUM_NETWORK_KEYPATH',
            iniGetter: () => getIniSection("Network")?.keyPath,
            defaultValue: ''
        },
        trustedReverseProxy: {
            standardEnvVar: 'TRILIUM_NETWORK_TRUSTEDREVERSEPROXY',
            iniGetter: () => getIniSection("Network")?.trustedReverseProxy,
            defaultValue: false as boolean | string
        },
        corsAllowOrigin: {
            standardEnvVar: 'TRILIUM_NETWORK_CORSALLOWORIGIN',
            // alternative with underscore format
            aliasEnvVars: ['TRILIUM_NETWORK_CORS_ALLOW_ORIGIN'],
            iniGetter: () => getIniSection("Network")?.corsAllowOrigin,
            defaultValue: ''
        },
        corsAllowMethods: {
            standardEnvVar: 'TRILIUM_NETWORK_CORSALLOWMETHODS',
            // alternative with underscore format
            aliasEnvVars: ['TRILIUM_NETWORK_CORS_ALLOW_METHODS'],
            iniGetter: () => getIniSection("Network")?.corsAllowMethods,
            defaultValue: ''
        },
        corsAllowHeaders: {
            standardEnvVar: 'TRILIUM_NETWORK_CORSALLOWHEADERS',
            // alternative with underscore format
            aliasEnvVars: ['TRILIUM_NETWORK_CORS_ALLOW_HEADERS'],
            iniGetter: () => getIniSection("Network")?.corsAllowHeaders,
            defaultValue: ''
        },
        corsResourcePolicy: {
            standardEnvVar: 'TRILIUM_NETWORK_CORSRESOURCEPOLICY',
            aliasEnvVars: ['TRILIUM_NETWORK_CORS_RESOURCE_POLICY'],
            iniGetter: () => getIniSection("Network")?.corsResourcePolicy,
            defaultValue: 'same-origin' as 'same-origin' | 'same-site' | 'cross-origin'
        }
    },
    Session: {
        cookieMaxAge: {
            standardEnvVar: 'TRILIUM_SESSION_COOKIEMAXAGE',
            iniGetter: () => getIniSection("Session")?.cookieMaxAge,
            defaultValue: 21 * 24 * 60 * 60, // 21 Days in Seconds
            transformer: (value: unknown) => parseInt(String(value)) || 21 * 24 * 60 * 60
        }
    },
    Sync: {
        syncServerHost: {
            standardEnvVar: 'TRILIUM_SYNC_SYNCSERVERHOST',
            // alternative format
            aliasEnvVars: ['TRILIUM_SYNC_SERVER_HOST'],
            iniGetter: () => getIniSection("Sync")?.syncServerHost,
            defaultValue: ''
        },
        syncServerTimeout: {
            standardEnvVar: 'TRILIUM_SYNC_SYNCSERVERTIMEOUT',
            // alternative format
            aliasEnvVars: ['TRILIUM_SYNC_SERVER_TIMEOUT'],
            iniGetter: () => getIniSection("Sync")?.syncServerTimeout,
            // Empty string signals "no override" so sync_options falls back to
            // the user's `syncServerTimeout` DB option. Setting a literal
            // default here would always take precedence and silently shadow
            // the value the user configured in the settings UI.
            defaultValue: ''
        },
        syncProxy: {
            standardEnvVar: 'TRILIUM_SYNC_SYNCPROXY',
            // alternative shorter formats
            aliasEnvVars: ['TRILIUM_SYNC_SERVER_PROXY'],
            // The INI config uses 'syncServerProxy' key for historical reasons (see config-sample.ini)
            // We check both 'syncProxy' and 'syncServerProxy' for backward compatibility with old configs
            iniGetter: () => getIniSection("Sync")?.syncProxy || getIniSection("Sync")?.syncServerProxy,
            defaultValue: ''
        }
    },
    MultiFactorAuthentication: {
        oauthBaseUrl: {
            standardEnvVar: 'TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHBASEURL',
            // alternative shorter format (commonly used)
            aliasEnvVars: ['TRILIUM_OAUTH_BASE_URL'],
            iniGetter: () => getIniSection("MultiFactorAuthentication")?.oauthBaseUrl,
            defaultValue: ''
        },
        oauthClientId: {
            standardEnvVar: 'TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHCLIENTID',
            // alternative format
            aliasEnvVars: ['TRILIUM_OAUTH_CLIENT_ID'],
            iniGetter: () => getIniSection("MultiFactorAuthentication")?.oauthClientId,
            defaultValue: ''
        },
        oauthClientSecret: {
            standardEnvVar: 'TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHCLIENTSECRET',
            // alternative format
            aliasEnvVars: ['TRILIUM_OAUTH_CLIENT_SECRET'],
            iniGetter: () => getIniSection("MultiFactorAuthentication")?.oauthClientSecret,
            defaultValue: ''
        },
        oauthIssuerBaseUrl: {
            standardEnvVar: 'TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHISSUERBASEURL',
            // alternative format
            aliasEnvVars: ['TRILIUM_OAUTH_ISSUER_BASE_URL'],
            iniGetter: () => getIniSection("MultiFactorAuthentication")?.oauthIssuerBaseUrl,
            defaultValue: 'https://accounts.google.com'
        },
        oauthIssuerName: {
            standardEnvVar: 'TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHISSUERNAME',
            // alternative format
            aliasEnvVars: ['TRILIUM_OAUTH_ISSUER_NAME'],
            iniGetter: () => getIniSection("MultiFactorAuthentication")?.oauthIssuerName,
            defaultValue: 'Google'
        },
        oauthIssuerIcon: {
            standardEnvVar: 'TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHISSUERICON',
            // alternative format
            aliasEnvVars: ['TRILIUM_OAUTH_ISSUER_ICON'],
            iniGetter: () => getIniSection("MultiFactorAuthentication")?.oauthIssuerIcon,
            defaultValue: ''
        },
        oauthHttpTimeout: {
            standardEnvVar: 'TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHHTTPTIMEOUT',
            aliasEnvVars: ['TRILIUM_OAUTH_HTTP_TIMEOUT'],
            iniGetter: () => getIniSection("MultiFactorAuthentication")?.oauthHttpTimeout,
            defaultValue: 30000,
            transformer: (value: unknown) => {
                const parsed = parseInt(String(value));
                // express-openid-connect requires httpTimeout >= 500; fall back to the default otherwise.
                return Number.isFinite(parsed) && parsed >= 500 ? parsed : 30000;
            }
        },
        oauthScope: {
            standardEnvVar: 'TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHSCOPE',
            aliasEnvVars: ['TRILIUM_OAUTH_SCOPE'],
            iniGetter: () => getIniSection("MultiFactorAuthentication")?.oauthScope,
            defaultValue: 'openid profile email',
            transformer: (value: unknown) => {
                const trimmed = String(value).trim();
                if (!trimmed) return 'openid profile email';
                // 'openid' is required by the OIDC spec; silently prepend it if the user forgot.
                const tokens = trimmed.split(/\s+/);
                return tokens.includes('openid') ? trimmed : `openid ${trimmed}`;
            }
        }
    },
    Logging: {
        retentionDays: {
            standardEnvVar: 'TRILIUM_LOGGING_RETENTIONDAYS',
            // alternative with underscore format
            aliasEnvVars: ['TRILIUM_LOGGING_RETENTION_DAYS'],
            iniGetter: () => getIniSection("Logging")?.retentionDays,
            defaultValue: LOGGING_DEFAULT_RETENTION_DAYS,
            transformer: (value: unknown) => utils.stringToInt(String(value)) ?? LOGGING_DEFAULT_RETENTION_DAYS
        }
    },
    Security: {
        backendScriptingEnabled: {
            standardEnvVar: 'TRILIUM_SECURITY_BACKEND_SCRIPTING_ENABLED',
            iniGetter: () => getIniSection("Security")?.backendScriptingEnabled,
            defaultValue: false,
            transformer: transformBoolean
        },
        sqlConsoleEnabled: {
            standardEnvVar: 'TRILIUM_SECURITY_SQL_CONSOLE_ENABLED',
            aliasEnvVars: ['TRILIUM_SECURITY_SQLCONSOLEENABLED'],
            iniGetter: () => getIniSection("Security")?.sqlConsoleEnabled,
            defaultValue: false,
            transformer: transformBoolean
        },
        allowLanAccess: {
            // Desktop-only: normally written to security.json and applied by the
            // Electron main process at startup; host.ts reads it instead of the
            // [Network] host. Kept off the documented config surface on purpose.
            iniGetter: () => getIniSection("Security")?.allowLanAccess,
            defaultValue: false,
            transformer: transformBoolean
        }
    }
};

/**
 * Build the final configuration object by resolving all values through the mapping.
 *
 * This creates the runtime configuration used throughout the application by:
 * 1. Iterating through each section and key in the mapping
 * 2. Calling getConfigValue() to resolve each setting with proper precedence
 * 3. Applying type transformers where needed (booleans, integers)
 * 4. Returning a fully typed TriliumConfig object
 *
 * The resulting config object is immutable at runtime and represents
 * the complete application configuration.
 */
const config: TriliumConfig = {
    General: {
        instanceName: getConfigValue(configMapping.General.instanceName),
        noAuthentication: getConfigValue(configMapping.General.noAuthentication),
        noBackup: getConfigValue(configMapping.General.noBackup),
        noDesktopIcon: getConfigValue(configMapping.General.noDesktopIcon),
        readOnly: getConfigValue(configMapping.General.readOnly)
    },
    Network: {
        host: getConfigValue(configMapping.Network.host),
        port: getConfigValue(configMapping.Network.port),
        https: getConfigValue(configMapping.Network.https),
        certPath: getConfigValue(configMapping.Network.certPath),
        keyPath: getConfigValue(configMapping.Network.keyPath),
        trustedReverseProxy: getConfigValue(configMapping.Network.trustedReverseProxy),
        corsAllowOrigin: getConfigValue(configMapping.Network.corsAllowOrigin),
        corsAllowMethods: getConfigValue(configMapping.Network.corsAllowMethods),
        corsAllowHeaders: getConfigValue(configMapping.Network.corsAllowHeaders),
        corsResourcePolicy: getConfigValue(configMapping.Network.corsResourcePolicy)
    },
    Session: {
        cookieMaxAge: getConfigValue(configMapping.Session.cookieMaxAge)
    },
    Sync: {
        syncServerHost: getConfigValue(configMapping.Sync.syncServerHost),
        syncServerTimeout: getConfigValue(configMapping.Sync.syncServerTimeout),
        syncProxy: getConfigValue(configMapping.Sync.syncProxy)
    },
    MultiFactorAuthentication: {
        oauthBaseUrl: getConfigValue(configMapping.MultiFactorAuthentication.oauthBaseUrl),
        oauthClientId: getConfigValue(configMapping.MultiFactorAuthentication.oauthClientId),
        oauthClientSecret: getConfigValue(configMapping.MultiFactorAuthentication.oauthClientSecret),
        oauthIssuerBaseUrl: getConfigValue(configMapping.MultiFactorAuthentication.oauthIssuerBaseUrl),
        oauthIssuerName: getConfigValue(configMapping.MultiFactorAuthentication.oauthIssuerName),
        oauthIssuerIcon: getConfigValue(configMapping.MultiFactorAuthentication.oauthIssuerIcon),
        oauthHttpTimeout: getConfigValue(configMapping.MultiFactorAuthentication.oauthHttpTimeout),
        oauthScope: getConfigValue(configMapping.MultiFactorAuthentication.oauthScope)
    },
    Logging: {
        retentionDays: getConfigValue(configMapping.Logging.retentionDays)
    },
    Security: {
        backendScriptingEnabled: getConfigValue(configMapping.Security.backendScriptingEnabled),
        sqlConsoleEnabled: getConfigValue(configMapping.Security.sqlConsoleEnabled),
        allowLanAccess: getConfigValue(configMapping.Security.allowLanAccess)
    }
};


/**
 * =====================================================================
 * ENVIRONMENT VARIABLE REFERENCE
 * =====================================================================
 *
 * Trilium supports flexible environment variable configuration with multiple
 * naming patterns. Both formats below are equally valid and can be used
 * based on your preference.
 *
 * CONFIGURATION PRECEDENCE:
 * 1. Environment variables (highest priority)
 * 2. config.ini file values
 * 3. Default values (lowest priority)
 *
 * FULL FORMAT VARIABLES (following TRILIUM_[SECTION]_[KEY] pattern):
 * ====================================================================
 *
 * General Section:
 * - TRILIUM_GENERAL_INSTANCENAME         : Custom instance identifier
 * - TRILIUM_GENERAL_NOAUTHENTICATION     : Disable auth (true/false)
 * - TRILIUM_GENERAL_NOBACKUP             : Disable backups (true/false)
 * - TRILIUM_GENERAL_NODESKTOPICON        : No desktop icon (true/false)
 * - TRILIUM_GENERAL_READONLY             : Read-only mode (true/false)
 *
 * Network Section:
 * - TRILIUM_NETWORK_HOST                 : Bind address (e.g., "0.0.0.0")
 * - TRILIUM_NETWORK_PORT                 : Server port (e.g., "8080")
 * - TRILIUM_NETWORK_HTTPS                : Enable HTTPS (true/false)
 * - TRILIUM_NETWORK_CERTPATH             : SSL certificate file path
 * - TRILIUM_NETWORK_KEYPATH              : SSL private key file path
 * - TRILIUM_NETWORK_TRUSTEDREVERSEPROXY  : Trust proxy headers (true/false/IP)
 * - TRILIUM_NETWORK_CORSALLOWORIGIN      : CORS allowed origins
 * - TRILIUM_NETWORK_CORSALLOWMETHODS     : CORS allowed HTTP methods
 * - TRILIUM_NETWORK_CORSALLOWHEADERS     : CORS allowed headers
 * - TRILIUM_NETWORK_CORSRESOURCEPOLICY   : CORS Resource Policy
 *
 * Session Section:
 * - TRILIUM_SESSION_COOKIEMAXAGE         : Cookie lifetime in seconds
 *
 * Sync Section:
 * - TRILIUM_SYNC_SYNCSERVERHOST          : Sync server URL
 * - TRILIUM_SYNC_SYNCSERVERTIMEOUT       : Sync timeout in milliseconds
 * - TRILIUM_SYNC_SYNCPROXY               : Proxy URL for sync
 *
 * Multi-Factor Authentication Section:
 * - TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHBASEURL       : OAuth base URL
 * - TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHCLIENTID      : OAuth client ID
 * - TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHCLIENTSECRET  : OAuth client secret
 * - TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHISSUERBASEURL : OAuth issuer URL
 * - TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHISSUERNAME    : OAuth provider name
 * - TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHISSUERICON    : OAuth provider icon
 * - TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHHTTPTIMEOUT   : OAuth HTTP timeout in ms (default 30000)
 * - TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHSCOPE         : Space-separated OIDC scopes (default 'openid profile email')
 *
 * Logging Section:
 * - TRILIUM_LOGGING_RETENTIONDAYS        : Log retention period in days
 *
 * SHORTER ALTERNATIVE VARIABLES (equally valid, for convenience):
 * ================================================================
 *
 * Network CORS (with underscores):
 * - TRILIUM_NETWORK_CORS_ALLOW_ORIGIN    : Same as TRILIUM_NETWORK_CORSALLOWORIGIN
 * - TRILIUM_NETWORK_CORS_ALLOW_METHODS   : Same as TRILIUM_NETWORK_CORSALLOWMETHODS
 * - TRILIUM_NETWORK_CORS_ALLOW_HEADERS   : Same as TRILIUM_NETWORK_CORSALLOWHEADERS
 * - TRILIUM_NETWORK_CORS_RESOURCE_POLICY : Same as TRILIUM_NETWORK_CORSRESOURCEPOLICY
 *
 * Sync (with SERVER prefix):
 * - TRILIUM_SYNC_SERVER_HOST             : Same as TRILIUM_SYNC_SYNCSERVERHOST
 * - TRILIUM_SYNC_SERVER_TIMEOUT          : Same as TRILIUM_SYNC_SYNCSERVERTIMEOUT
 * - TRILIUM_SYNC_SERVER_PROXY            : Same as TRILIUM_SYNC_SYNCPROXY
 *
 * OAuth (simplified without section name):
 * - TRILIUM_OAUTH_BASE_URL               : Same as TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHBASEURL
 * - TRILIUM_OAUTH_CLIENT_ID              : Same as TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHCLIENTID
 * - TRILIUM_OAUTH_CLIENT_SECRET          : Same as TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHCLIENTSECRET
 * - TRILIUM_OAUTH_ISSUER_BASE_URL        : Same as TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHISSUERBASEURL
 * - TRILIUM_OAUTH_ISSUER_NAME            : Same as TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHISSUERNAME
 * - TRILIUM_OAUTH_ISSUER_ICON            : Same as TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHISSUERICON
 * - TRILIUM_OAUTH_HTTP_TIMEOUT           : Same as TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHHTTPTIMEOUT
 * - TRILIUM_OAUTH_SCOPE                  : Same as TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHSCOPE
 *
 * Logging (with underscore):
 * - TRILIUM_LOGGING_RETENTION_DAYS       : Same as TRILIUM_LOGGING_RETENTIONDAYS
 *
 * BOOLEAN VALUES:
 * - Accept: "true", "false", "1", "0", 1, 0
 * - Default to false for invalid values
 *
 * EXAMPLES:
 * export TRILIUM_NETWORK_PORT="8080"                      # Using full format
 * export TRILIUM_OAUTH_CLIENT_ID="my-client-id"           # Using shorter alternative
 * export TRILIUM_GENERAL_NOAUTHENTICATION="true"          # Boolean value
 * export TRILIUM_SYNC_SERVER_HOST="https://sync.example.com"  # Using alternative with SERVER
 */

/**
 * The exported configuration object used throughout the Trilium application.
 * This object is resolved once at startup and remains immutable during runtime.
 *
 * To override any setting:
 * 1. Set an environment variable (see documentation above)
 * 2. Edit config.ini in your data directory
 * 3. Defaults will be used if neither is provided
 *
 * @example
 * // Accessing configuration in other modules:
 * import config from './services/config.js';
 *
 * if (config.General.noAuthentication) {
 *     // Skip authentication checks
 * }
 *
 * const server = https.createServer({
 *     cert: fs.readFileSync(config.Network.certPath),
 *     key: fs.readFileSync(config.Network.keyPath)
 * });
 */
export default config;
