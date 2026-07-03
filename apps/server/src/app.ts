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
import { createReactiveOidcMiddleware, refreshOidcTokenIfNeeded } from "./services/open_id.js";
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

    app.use(express.text({ limit: "500mb" }));
    app.use(express.json({ limit: "500mb" }));
    app.use(express.raw({ limit: "500mb" }));
    app.use(express.urlencoded({ extended: false }));
    app.use(cookieParser());

    // MCP is registered before session/auth middleware — it uses its own
    // localhost-only guard and does not require Trilium authentication.
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
    // Refresh an expired OIDC access token before the request is handled. Mounted immediately after the
    // OIDC middleware so `req.oidc` is populated; it no-ops for non-OIDC requests and when no refresh
    // token is present, so it is safe to mount unconditionally alongside the reactive OIDC middleware.
    app.use(refreshOidcTokenIfNeeded);

    await assets.register(app);
    routes.register(app);
    custom.register(app);
    error_handlers.register(app);

    const { sync, consistency_checks, scheduler } = await import("@triliumnext/core");
    sync.startSyncTimer();

    consistency_checks.startConsistencyChecks();
    scheduler.startScheduler();

    erase.startScheduledCleanup();

    return app;
}
