void import("@triliumnext/core");

import { erase } from "@triliumnext/core";
import compression from "compression";
import cookieParser from "cookie-parser";
import ejs from "ejs";
import express from "express";
import helmet from "helmet";
import { t } from "i18next";
import path from "path";
import favicon from "serve-favicon";
import type serveStatic from "serve-static";

import assets from "./routes/assets.js";
import custom from "./routes/custom.js";
import error_handlers from "./routes/error_handlers.js";
import mcpRoutes from "./routes/mcp.js";
import routes from "./routes/routes.js";
import config from "./services/config.js";
import { getLog } from "@triliumnext/core";
import { desktopNetworkAccessGate } from "./services/desktop_network_gate.js";
import { createReactiveOidcMiddleware } from "./services/open_id.js";
import { setupSecondFactor } from "./services/setup_second_factor.js";
import { RESOURCE_DIR } from "./services/resource_dir.js";
import utils, { getResourceDir, isDev } from "./services/utils.js";

// Allow serving assets even if the installation path contains a hidden (dot-prefixed) directory.
const STATIC_OPTIONS: serveStatic.ServeStaticOptions = { dotfiles: "allow" };

export default async function buildApp() {
    const app = express();

    const publicDir = isDev ? path.join(getResourceDir(), "../dist/public") : path.join(getResourceDir(), "public");
    const publicAssetsDir = path.join(publicDir, "assets");
    const assetsDir = RESOURCE_DIR;

    // view engine setup
    app.set("views", path.join(assetsDir, "views"));
    app.engine("ejs", (filePath, options, callback) => ejs.renderFile(filePath, options, callback));
    app.set("view engine", "ejs");

    app.use((req, res, next) => {
        // set CORS headers
        if (config["Network"]["corsAllowOrigin"]) {
            res.header("Access-Control-Allow-Origin", config["Network"]["corsAllowOrigin"]);
            res.header("Access-Control-Allow-Credentials", "true");
        }
        if (config["Network"]["corsAllowMethods"]) {
            res.header("Access-Control-Allow-Methods", config["Network"]["corsAllowMethods"]);
        }
        if (config["Network"]["corsAllowHeaders"]) {
            res.header("Access-Control-Allow-Headers", config["Network"]["corsAllowHeaders"]);
        }

        // Handle preflight OPTIONS requests
        if (req.method === "OPTIONS" && config["Network"]["corsAllowOrigin"]) {
            res.sendStatus(204);
            return;
        }

        res.locals.t = t;
        return next();
    });

    if (!utils.isElectron) {
        app.use(compression({
            // Skip compression for SSE endpoints to enable real-time streaming
            filter: (req, res) => {
                // Skip compression for SSE-capable endpoints
                if (req.path === "/api/llm-chat/stream" || req.path === "/mcp") {
                    return false;
                }
                return compression.filter(req, res);
            }
        }));
    }

    let resourcePolicy = config["Network"]["corsResourcePolicy"] as 'same-origin' | 'same-site' | 'cross-origin' | undefined;
    if(resourcePolicy !== 'same-origin' && resourcePolicy !== 'same-site' && resourcePolicy !== 'cross-origin') {
        getLog().error(`Invalid CORS Resource Policy value: '${resourcePolicy}', defaulting to 'same-origin'`);
        resourcePolicy = 'same-origin';
    }

    app.use(
        helmet({
            hidePoweredBy: false, // errors out in electron
            contentSecurityPolicy: false,
            crossOriginResourcePolicy: {
                policy: resourcePolicy
            },
            crossOriginEmbedderPolicy: false
        })
    );

    // Also accept text/* and XML besides the text/plain default: custom request handlers
    // (script notes with #customRequestHandler) receive external protocol payloads such as
    // text/vcard and application/xml, and backend scripts are synchronous, so a body that no
    // parser consumed is unreadable by the time the script runs (req.body stays undefined).
    app.use(express.text({ limit: "500mb", type: ["text/*", "application/xml", "application/*+xml"] }));
    app.use(express.json({ limit: "500mb" }));
    app.use(express.raw({ limit: "500mb" }));
    app.use(express.urlencoded({ extended: false }));
    app.use(cookieParser());

    // Desktop only: gate web access (SPA/login, /share, /api, static assets) behind
    // the network-access opt-in. Mounted before the static/app/share routes, and before
    // MCP so that the gate's loopback-Host check applies there too — Express dispatches
    // in registration order, so a route registered first would answer before this ever
    // ran. The localhost integrations it exempts stay reachable on loopback while the
    // web app does not, unless the user enables network access. No-op on the server build.
    app.use(desktopNetworkAccessGate);

    // MCP is registered before session/auth middleware — it authenticates with its own
    // guard (an ETAPI token, always required) and never uses the Trilium session, which
    // would make the endpoint CSRF-able.
    mcpRoutes.register(app);

    app.use(express.static(path.join(publicDir, "root"), STATIC_OPTIONS));
    app.use(`/manifest.webmanifest`, express.static(path.join(publicAssetsDir, "manifest.webmanifest"), STATIC_OPTIONS));
    app.use(`/robots.txt`, express.static(path.join(publicAssetsDir, "robots.txt"), STATIC_OPTIONS));
    app.use(`/icon.png`, express.static(path.join(publicAssetsDir, "icon.png"), STATIC_OPTIONS));

    const { default: sessionParser, startSessionCleanup } = await import("./routes/session_parser.js");
    app.use(sessionParser);
    startSessionCleanup();
    app.use(favicon(path.join(assetsDir, isDev ? "icon-dev.ico" : "icon.ico")));

    // Always mount the OIDC middleware, but have it activate reactively from the current `mfaMethod`
    // option rather than from a one-time startup check. This lets a switch to (or away from) OpenID take
    // effect without a server restart; the underlying express-openid-connect handler is built lazily on
    // first use, so it costs nothing while OAuth is unselected. See createReactiveOidcMiddleware.
    app.use(createReactiveOidcMiddleware());

    await assets.register(app);
    routes.register(app);
    custom.register(app);
    error_handlers.register(app);

    const { sync, consistency_checks, initSetupSecondFactor, scheduler, sql_init, becca_loader, i18n } = await import("@triliumnext/core");
    sync.startSyncTimer();

    // What the setup wizard asks for besides the password, where this instance has one. Registered
    // here rather than handed to `initializeCore`, because it is the server that has a second factor
    // at all: the browser-only build never runs this file. Desktop reaches it through the same
    // www.js → buildApp path, and is exempt from the wizard's gate for its own reasons.
    initSetupSecondFactor(setupSecondFactor);

    // Server-side i18next always boots on "en" (initTranslations runs before initSql in initializeCore),
    // so re-sync it with the document's stored locale before the scheduler's dbReady.then(checkHiddenSubtree)
    // rebuilds the built-in titles — otherwise they are (re-)generated in English on every start. The read
    // goes through becca, so wait for it; guard on isDbInitialized so we don't await beccaLoaded (which never
    // resolves pre-setup) on a fresh install. Desktop reaches this via the same www.js → buildApp path.
    if (sql_init.isDbInitialized()) {
        await becca_loader.beccaLoaded;
        await i18n.reconcileLanguageAfterDbInit();
    }

    consistency_checks.startConsistencyChecks();
    scheduler.startScheduler();

    erase.startScheduledCleanup();

    return app;
}
