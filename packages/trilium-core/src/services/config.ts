/**
 * Subset of application config consumed by trilium-core.
 *
 * The full config (INI parsing, env-var precedence, etc.) lives on the server
 * side and is not available in browser-based runtimes like standalone. Core
 * only needs these fields, so the host (server / desktop / standalone) injects
 * them via `initConfig()` at startup.
 *
 * Empty strings / `false` signal "no override" — `sync_options` then falls
 * back to the DB option. Standalone uses an all-empty config by default.
 */
export interface CoreConfig {
    General: {
        instanceName: string;
        readOnly: boolean;
    };
    Sync: {
        syncServerHost: string;
        syncServerTimeout: string;
        syncProxy: string;
    };
    Security: {
        backendScriptingEnabled: boolean;
        sqlConsoleEnabled: boolean;
    };
}

const EMPTY_CONFIG: CoreConfig = {
    General: {
        instanceName: "",
        readOnly: false
    },
    Sync: {
        syncServerHost: "",
        syncServerTimeout: "",
        syncProxy: ""
    },
    Security: {
        backendScriptingEnabled: false,
        sqlConsoleEnabled: false
    }
};

let injected: CoreConfig = EMPTY_CONFIG;

export function initConfig(config: CoreConfig) {
    injected = config;
}

export function getConfig(): CoreConfig {
    return injected;
}

// Legacy `import config from "./config.js"` reads stay working: the Proxy
// resolves each top-level access against the currently injected config, so
// existing call sites that read inside functions (e.g. `config.General.readOnly`
// inside a request handler) see the live values without modification.
export default new Proxy({} as CoreConfig, {
    get: (_target, prop: string) => injected[prop as keyof CoreConfig]
});
