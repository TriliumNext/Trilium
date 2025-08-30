import express from "express";
import path from "path";
import favicon from "serve-favicon";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import compression from "compression";
import config from "./services/config.js";
import utils, { getResourceDir, isDev } from "./services/utils.js";
import assets from "./routes/assets.js";
import routes from "./routes/routes.js";
import custom from "./routes/custom.js";
import error_handlers from "./routes/error_handlers.js";
import { startScheduledCleanup } from "./services/erase.js";
import sql_init from "./services/sql_init.js";
import { auth } from "express-openid-connect";
import openID from "./services/open_id.js";
import { t } from "i18next";
import eventService from "./services/events.js";
import log from "./services/log.js";
import "./services/handlers.js";
import "./becca/becca_loader.js";
import { RESOURCE_DIR } from "./services/resource_dir.js";

export default async function buildApp() {
    const app = express();

    // Initialize DB
    sql_init.initializeDb();

    // Listen for database initialization event
    eventService.subscribe(eventService.DB_INITIALIZED, async () => {
        try {
            log.info("Database initialized, LLM features available");
            log.info("LLM features ready");
        } catch (error) {
            console.error("Error initializing LLM features:", error);
        }
    });

    // Initialize LLM features only if database is already initialized
    if (sql_init.isDbInitialized()) {
        try {
            log.info("LLM features ready");
        } catch (error) {
            console.error("Error initializing LLM features:", error);
        }
    } else {
        console.log("Database not initialized yet. LLM features will be initialized after setup.");
    }

    const publicDir = isDev ? path.join(getResourceDir(), "../dist/public") : path.join(getResourceDir(), "public");
    const publicAssetsDir = path.join(publicDir, "assets");
    const assetsDir = RESOURCE_DIR;

    // view engine setup
    app.set("views", path.join(assetsDir, "views"));
    app.engine("ejs", (await import("ejs")).renderFile);
    app.set("view engine", "ejs");

    app.use((req, res, next) => {
        // set CORS header
        if (config["Network"]["corsAllowOrigin"]) {
            res.header("Access-Control-Allow-Origin", config["Network"]["corsAllowOrigin"]);
        }
        if (config["Network"]["corsAllowMethods"]) {
            res.header("Access-Control-Allow-Methods", config["Network"]["corsAllowMethods"]);
        }
        if (config["Network"]["corsAllowHeaders"]) {
            res.header("Access-Control-Allow-Headers", config["Network"]["corsAllowHeaders"]);
        }

        res.locals.t = t;
        return next();
    });

    if (!utils.isElectron) {
        app.use(compression()); // HTTP compression
    }

    app.use(
        helmet({
            hidePoweredBy: false, // errors out in electron
            contentSecurityPolicy: false,
            crossOriginEmbedderPolicy: false
        })
    );

    app.use(express.text({ limit: "500mb" }));
    app.use(express.json({ limit: "500mb" }));
    app.use(express.raw({ limit: "500mb" }));
    app.use(express.urlencoded({ extended: false }));
    app.use(cookieParser());

    app.use(express.static(path.join(publicDir, "root")));
    app.use(`/manifest.webmanifest`, express.static(path.join(publicAssetsDir, "manifest.webmanifest")));
    app.use(`/robots.txt`, express.static(path.join(publicAssetsDir, "robots.txt")));
    app.use(`/icon.png`, express.static(path.join(publicAssetsDir, "icon.png")));

    const sessionParser = (await import("./routes/session_parser.js")).default;
    app.use(sessionParser);
    app.use(favicon(path.join(assetsDir, "icon.ico")));

    if (openID.isOpenIDEnabled()) {
        // Always log OAuth initialization for better debugging
        log.info('OAuth: Initializing OAuth authentication middleware');
        
        // Check for potential reverse proxy configuration issues
        const baseUrl = config.MultiFactorAuthentication.oauthBaseUrl;
        const trustProxy = app.get('trust proxy');
        
        log.info(`OAuth: Configuration check - baseURL=${baseUrl}, trustProxy=${trustProxy}`);
        
        // Log potential issue if OAuth is configured with HTTPS but trust proxy is not set
        if (baseUrl.startsWith('https://') && !trustProxy) {
            log.info('OAuth: baseURL uses HTTPS but trustedReverseProxy is not configured.');
            log.info('OAuth: If you are behind a reverse proxy, this MAY cause authentication failures.');
            log.info('OAuth: The OAuth library might generate HTTP redirect_uris instead of HTTPS.');
            log.info('OAuth: If authentication fails with redirect_uri errors, try setting:');
            log.info('OAuth:   In config.ini:  trustedReverseProxy=true');
            log.info('OAuth:   Or environment:  TRILIUM_NETWORK_TRUSTEDREVERSEPROXY=true');
            log.info('OAuth: Note: This is only needed if running behind a reverse proxy.');
        }
        
        // Test OAuth connectivity on startup for non-Google providers
        const issuerUrl = config.MultiFactorAuthentication.oauthIssuerBaseUrl;
        const isCustomProvider = issuerUrl && 
                                issuerUrl !== "" && 
                                issuerUrl !== "https://accounts.google.com";
        
        if (isCustomProvider) {
            // For non-Google providers, verify connectivity
            openID.testOAuthConnectivity().then(result => {
                if (result.success) {
                    log.info('OAuth: Provider connectivity verified successfully');
                } else {
                    log.error(`OAuth: Provider connectivity check failed: ${result.error}`);
                    log.error('OAuth: Authentication may not work. Please verify:');
                    log.error('  1. The OAuth provider URL is correct');
                    log.error('  2. Network connectivity between Trilium and the OAuth provider');
                    log.error('  3. Any firewall or proxy settings');
                }
            }).catch(err => {
                log.error(`OAuth: Connectivity test error: ${err.message || err}`);
            });
        }
        
        // Register OAuth middleware
        app.use(auth(openID.generateOAuthConfig()));
        
        // Add OAuth error logging middleware AFTER auth middleware
        app.use(openID.oauthErrorLogger);
        
        // Add diagnostic middleware for authentication initiation
        app.use('/authenticate', (req, res, next) => {
            log.info(`OAuth authenticate diagnostic: protocol=${req.protocol}, secure=${req.secure}, host=${req.get('host')}`);
            log.info(`OAuth authenticate: baseURL from req = ${req.protocol}://${req.get('host')}`);
            log.info(`OAuth authenticate: headers - x-forwarded-proto=${req.headers['x-forwarded-proto']}, x-forwarded-host=${req.headers['x-forwarded-host']}`);
            // The actual redirect_uri will be logged by express-openid-connect
            next();
        });
        
        // Add diagnostic middleware to log what protocol Express thinks it's using for callbacks
        app.use('/callback', (req, res, next) => {
            log.info(`OAuth callback diagnostic: protocol=${req.protocol}, secure=${req.secure}, originalUrl=${req.originalUrl}`);
            log.info(`OAuth callback headers: x-forwarded-proto=${req.headers['x-forwarded-proto']}, x-forwarded-for=${req.headers['x-forwarded-for']}, host=${req.headers['host']}`);
            
            // Log if there's a mismatch between expected and actual protocol
            const expectedProtocol = baseUrl.startsWith('https://') ? 'https' : 'http';
            if (req.protocol !== expectedProtocol) {
                log.error(`OAuth callback: PROTOCOL MISMATCH DETECTED!`);
                log.error(`OAuth callback: Expected ${expectedProtocol} (from baseURL) but got ${req.protocol}`);
                log.error(`OAuth callback: This indicates trustedReverseProxy may need to be set.`);
            }
            
            next();
        });
    }

    await assets.register(app);
    routes.register(app);
    custom.register(app);
    error_handlers.register(app);

    // triggers sync timer
    await import("./services/sync.js");

    // triggers backup timer
    await import("./services/backup.js");

    // trigger consistency checks timer
    await import("./services/consistency_checks.js");

    await import("./services/scheduler.js");

    startScheduledCleanup();

    if (utils.isElectron) {
        (await import("@electron/remote/main/index.js")).initialize();
    }

    return app;
}
