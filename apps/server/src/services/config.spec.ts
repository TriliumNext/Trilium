import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import ini from "ini";

// Mock dependencies
vi.mock("fs");
vi.mock("./data_dir.js", () => ({
    default: {
        CONFIG_INI_PATH: "/test/config.ini"
    }
}));
vi.mock("./resource_dir.js", () => ({
    default: {
        RESOURCE_DIR: "/test/resources"
    }
}));

describe("Config Service", () => {
    let originalEnv: NodeJS.ProcessEnv;
    
    beforeEach(() => {
        // Save original environment
        originalEnv = { ...process.env };
        
        // Clear all TRILIUM env vars
        Object.keys(process.env).forEach(key => {
            if (key.startsWith("TRILIUM_")) {
                delete process.env[key];
            }
        });

        // Mock fs to return empty config
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockImplementation((path) => {
            if (String(path).includes("config-sample.ini")) {
                return "" as any; // Return string for INI parsing
            }
            // Return empty INI config as string
            return `
[General]
[Network]
[Session]
[Sync]
[MultiFactorAuthentication]
[Logging]
            ` as any;
        });
        
        // Clear module cache to reload config with new env vars
        vi.resetModules();
    });
    
    afterEach(() => {
        // Restore original environment
        process.env = originalEnv;
        vi.clearAllMocks();
    });

    describe("Environment Variable Naming", () => {
        it("should use standard environment variables following TRILIUM_[SECTION]_[KEY] pattern", async () => {
            // Set standard env vars
            process.env.TRILIUM_GENERAL_INSTANCENAME = "test-instance";
            process.env.TRILIUM_NETWORK_CORSALLOWORIGIN = "https://example.com";
            process.env.TRILIUM_SYNC_SYNCSERVERHOST = "sync.example.com";
            process.env.TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHBASEURL = "https://auth.example.com";
            process.env.TRILIUM_LOGGING_RETENTIONDAYS = "30";

            const { default: config } = await import("./config.js");

            expect(config.General.instanceName).toBe("test-instance");
            expect(config.Network.corsAllowOrigin).toBe("https://example.com");
            expect(config.Sync.syncServerHost).toBe("sync.example.com");
            expect(config.MultiFactorAuthentication.oauthBaseUrl).toBe("https://auth.example.com");
            expect(config.Logging.retentionDays).toBe(30);
        });

        it("should maintain backward compatibility with alias environment variables", async () => {
            // Set alias/legacy env vars
            process.env.TRILIUM_NETWORK_CORS_ALLOW_ORIGIN = "https://legacy.com";
            process.env.TRILIUM_SYNC_SERVER_HOST = "legacy-sync.com";
            process.env.TRILIUM_OAUTH_BASE_URL = "https://legacy-auth.com";
            process.env.TRILIUM_LOGGING_RETENTION_DAYS = "60";

            const { default: config } = await import("./config.js");

            expect(config.Network.corsAllowOrigin).toBe("https://legacy.com");
            expect(config.Sync.syncServerHost).toBe("legacy-sync.com");
            expect(config.MultiFactorAuthentication.oauthBaseUrl).toBe("https://legacy-auth.com");
            expect(config.Logging.retentionDays).toBe(60);
        });

        it("should prioritize standard env vars over aliases when both are set", async () => {
            // Set both standard and alias env vars - standard should win
            process.env.TRILIUM_NETWORK_CORSALLOWORIGIN = "standard-cors.com";
            process.env.TRILIUM_NETWORK_CORS_ALLOW_ORIGIN = "alias-cors.com";
            
            process.env.TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHBASEURL = "standard-auth.com";
            process.env.TRILIUM_OAUTH_BASE_URL = "alias-auth.com";

            const { default: config } = await import("./config.js");

            expect(config.Network.corsAllowOrigin).toBe("standard-cors.com");
            expect(config.MultiFactorAuthentication.oauthBaseUrl).toBe("standard-auth.com");
        });

        it("should handle all CORS environment variables correctly", async () => {
            // Test with standard naming
            process.env.TRILIUM_NETWORK_CORSALLOWORIGIN = "*";
            process.env.TRILIUM_NETWORK_CORSALLOWMETHODS = "GET,POST,PUT";
            process.env.TRILIUM_NETWORK_CORSALLOWHEADERS = "Content-Type,Authorization";

            let { default: config } = await import("./config.js");

            expect(config.Network.corsAllowOrigin).toBe("*");
            expect(config.Network.corsAllowMethods).toBe("GET,POST,PUT");
            expect(config.Network.corsAllowHeaders).toBe("Content-Type,Authorization");

            // Clear and test with alias naming
            delete process.env.TRILIUM_NETWORK_CORSALLOWORIGIN;
            delete process.env.TRILIUM_NETWORK_CORSALLOWMETHODS;
            delete process.env.TRILIUM_NETWORK_CORSALLOWHEADERS;
            
            process.env.TRILIUM_NETWORK_CORS_ALLOW_ORIGIN = "https://app.com";
            process.env.TRILIUM_NETWORK_CORS_ALLOW_METHODS = "GET,POST";
            process.env.TRILIUM_NETWORK_CORS_ALLOW_HEADERS = "X-Custom-Header";
            
            vi.resetModules();
            config = (await import("./config.js")).default;

            expect(config.Network.corsAllowOrigin).toBe("https://app.com");
            expect(config.Network.corsAllowMethods).toBe("GET,POST");
            expect(config.Network.corsAllowHeaders).toBe("X-Custom-Header");
        });

        it("should handle all OAuth/MFA environment variables correctly", async () => {
            // Test with standard naming
            process.env.TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHBASEURL = "https://oauth.standard.com";
            process.env.TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHCLIENTID = "standard-client-id";
            process.env.TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHCLIENTSECRET = "standard-secret";
            process.env.TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHISSUERBASEURL = "https://issuer.standard.com";
            process.env.TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHISSUERNAME = "Standard Auth";
            process.env.TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHISSUERICON = "standard-icon.png";

            let { default: config } = await import("./config.js");

            expect(config.MultiFactorAuthentication.oauthBaseUrl).toBe("https://oauth.standard.com");
            expect(config.MultiFactorAuthentication.oauthClientId).toBe("standard-client-id");
            expect(config.MultiFactorAuthentication.oauthClientSecret).toBe("standard-secret");
            expect(config.MultiFactorAuthentication.oauthIssuerBaseUrl).toBe("https://issuer.standard.com");
            expect(config.MultiFactorAuthentication.oauthIssuerName).toBe("Standard Auth");
            expect(config.MultiFactorAuthentication.oauthIssuerIcon).toBe("standard-icon.png");

            // Clear and test with alias naming
            Object.keys(process.env).forEach(key => {
                if (key.startsWith("TRILIUM_MULTIFACTORAUTHENTICATION_")) {
                    delete process.env[key];
                }
            });
            
            process.env.TRILIUM_OAUTH_BASE_URL = "https://oauth.alias.com";
            process.env.TRILIUM_OAUTH_CLIENT_ID = "alias-client-id";
            process.env.TRILIUM_OAUTH_CLIENT_SECRET = "alias-secret";
            process.env.TRILIUM_OAUTH_ISSUER_BASE_URL = "https://issuer.alias.com";
            process.env.TRILIUM_OAUTH_ISSUER_NAME = "Alias Auth";
            process.env.TRILIUM_OAUTH_ISSUER_ICON = "alias-icon.png";
            
            vi.resetModules();
            config = (await import("./config.js")).default;

            expect(config.MultiFactorAuthentication.oauthBaseUrl).toBe("https://oauth.alias.com");
            expect(config.MultiFactorAuthentication.oauthClientId).toBe("alias-client-id");
            expect(config.MultiFactorAuthentication.oauthClientSecret).toBe("alias-secret");
            expect(config.MultiFactorAuthentication.oauthIssuerBaseUrl).toBe("https://issuer.alias.com");
            expect(config.MultiFactorAuthentication.oauthIssuerName).toBe("Alias Auth");
            expect(config.MultiFactorAuthentication.oauthIssuerIcon).toBe("alias-icon.png");
        });

        it("should handle all Sync environment variables correctly", async () => {
            // Test with standard naming
            process.env.TRILIUM_SYNC_SYNCSERVERHOST = "sync-standard.com";
            process.env.TRILIUM_SYNC_SYNCSERVERTIMEOUT = "60000";
            process.env.TRILIUM_SYNC_SYNCPROXY = "proxy-standard.com";

            let { default: config } = await import("./config.js");

            expect(config.Sync.syncServerHost).toBe("sync-standard.com");
            expect(config.Sync.syncServerTimeout).toBe("60000");
            expect(config.Sync.syncProxy).toBe("proxy-standard.com");

            // Clear and test with alias naming
            delete process.env.TRILIUM_SYNC_SYNCSERVERHOST;
            delete process.env.TRILIUM_SYNC_SYNCSERVERTIMEOUT;
            delete process.env.TRILIUM_SYNC_SYNCPROXY;
            
            process.env.TRILIUM_SYNC_SERVER_HOST = "sync-alias.com";
            process.env.TRILIUM_SYNC_SERVER_TIMEOUT = "30000";
            process.env.TRILIUM_SYNC_SERVER_PROXY = "proxy-alias.com";
            
            vi.resetModules();
            config = (await import("./config.js")).default;

            expect(config.Sync.syncServerHost).toBe("sync-alias.com");
            expect(config.Sync.syncServerTimeout).toBe("30000");
            expect(config.Sync.syncProxy).toBe("proxy-alias.com");
        });
    });

    describe("INI Config Integration", () => {
        it("should fall back to INI config when no env vars are set", async () => {
            // Mock INI config with values
            vi.mocked(fs.readFileSync).mockImplementation((path) => {
                if (String(path).includes("config-sample.ini")) {
                    return "" as any;
                }
                return `
[General]
instanceName=ini-instance

[Network]
corsAllowOrigin=https://ini-cors.com
port=9000

[Sync]
syncServerHost=ini-sync.com

[MultiFactorAuthentication]
oauthBaseUrl=https://ini-oauth.com

[Logging]
retentionDays=45
                ` as any;
            });

            const { default: config } = await import("./config.js");

            expect(config.General.instanceName).toBe("ini-instance");
            expect(config.Network.corsAllowOrigin).toBe("https://ini-cors.com");
            expect(config.Network.port).toBe("9000");
            expect(config.Sync.syncServerHost).toBe("ini-sync.com");
            expect(config.MultiFactorAuthentication.oauthBaseUrl).toBe("https://ini-oauth.com");
            expect(config.Logging.retentionDays).toBe(45);
        });

        it("should prioritize env vars over INI config", async () => {
            // Mock INI config with values
            vi.mocked(fs.readFileSync).mockImplementation((path) => {
                if (String(path).includes("config-sample.ini")) {
                    return "" as any;
                }
                return `
[General]
instanceName=ini-instance

[Network]
corsAllowOrigin=https://ini-cors.com
                ` as any;
            });

            // Set env vars that should override INI
            process.env.TRILIUM_GENERAL_INSTANCENAME = "env-instance";
            process.env.TRILIUM_NETWORK_CORS_ALLOW_ORIGIN = "https://env-cors.com"; // Using alias

            const { default: config } = await import("./config.js");

            expect(config.General.instanceName).toBe("env-instance");
            expect(config.Network.corsAllowOrigin).toBe("https://env-cors.com");
        });
    });

    describe("Type Transformations", () => {
        it("should correctly transform boolean values", async () => {
            process.env.TRILIUM_GENERAL_NOAUTHENTICATION = "true";
            process.env.TRILIUM_GENERAL_NOBACKUP = "1";
            process.env.TRILIUM_GENERAL_READONLY = "false";
            process.env.TRILIUM_NETWORK_HTTPS = "0";

            const { default: config } = await import("./config.js");

            expect(config.General.noAuthentication).toBe(true);
            expect(config.General.noBackup).toBe(true);
            expect(config.General.readOnly).toBe(false);
            expect(config.Network.https).toBe(false);
        });

        it("should correctly transform integer values", async () => {
            process.env.TRILIUM_SESSION_COOKIEMAXAGE = "3600";
            process.env.TRILIUM_LOGGING_RETENTIONDAYS = "7";

            const { default: config } = await import("./config.js");

            expect(config.Session.cookieMaxAge).toBe(3600);
            expect(config.Logging.retentionDays).toBe(7);
        });

        it("should use default values for invalid integers", async () => {
            process.env.TRILIUM_SESSION_COOKIEMAXAGE = "invalid";
            process.env.TRILIUM_LOGGING_RETENTION_DAYS = "not-a-number"; // Using alias

            const { default: config } = await import("./config.js");

            expect(config.Session.cookieMaxAge).toBe(21 * 24 * 60 * 60); // Default
            expect(config.Logging.retentionDays).toBe(90); // Default
        });
    });

    describe("Default Values", () => {
        it("should use correct default values when no config is provided", async () => {
            const { default: config } = await import("./config.js");

            // General defaults
            expect(config.General.instanceName).toBe("");
            expect(config.General.noAuthentication).toBe(false);
            expect(config.General.noBackup).toBe(false);
            expect(config.General.noDesktopIcon).toBe(false);
            expect(config.General.readOnly).toBe(false);

            // Network defaults
            expect(config.Network.host).toBe("0.0.0.0");
            expect(config.Network.port).toBe("3000");
            expect(config.Network.https).toBe(false);
            expect(config.Network.certPath).toBe("");
            expect(config.Network.keyPath).toBe("");
            expect(config.Network.trustedReverseProxy).toBe(false);
            expect(config.Network.corsAllowOrigin).toBe("");
            expect(config.Network.corsAllowMethods).toBe("");
            expect(config.Network.corsAllowHeaders).toBe("");

            // Session defaults
            expect(config.Session.cookieMaxAge).toBe(21 * 24 * 60 * 60);

            // Sync defaults
            expect(config.Sync.syncServerHost).toBe("");
            expect(config.Sync.syncServerTimeout).toBe("120000");
            expect(config.Sync.syncProxy).toBe("");

            // OAuth defaults
            expect(config.MultiFactorAuthentication.oauthBaseUrl).toBe("");
            expect(config.MultiFactorAuthentication.oauthClientId).toBe("");
            expect(config.MultiFactorAuthentication.oauthClientSecret).toBe("");
            expect(config.MultiFactorAuthentication.oauthIssuerBaseUrl).toBe("https://accounts.google.com");
            expect(config.MultiFactorAuthentication.oauthIssuerName).toBe("Google");
            expect(config.MultiFactorAuthentication.oauthIssuerIcon).toBe("");

            // Logging defaults
            expect(config.Logging.retentionDays).toBe(90);
        });
    });
});