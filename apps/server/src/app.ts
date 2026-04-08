import "./services/handlers.js";
import "./becca/becca_loader.js";

import compression from "compression";
import cookieParser from "cookie-parser";
import ejs from "ejs";
import express from "express";
import { auth } from "express-openid-connect";
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
import { startScheduledCleanup } from "./services/erase.js";
import log from "./services/log.js";
import openID from "./services/open_id.js";
import { RESOURCE_DIR } from "./services/resource_dir.js";
import sql_init from "./services/sql_init.js";
import utils, { getResourceDir, isDev } from "./services/utils.js";

// Allow serving assets even if the installation path contains a hidden (dot-prefixed) directory.
const STATIC_OPTIONS: serveStatic.ServeStaticOptions = { dotfiles: "allow" };

export default async function buildApp() {
    const app = express();

    // Initialize DB
    sql_init.initializeDb();

    const publicDir = isDev ? path.join(getResourceDir(), "../dist/public") : path.join(getResourceDir(), "public");
    const publicAssetsDir = path.join(publicDir, "assets");
    const assetsDir = RESOURCE_DIR;

    // view engine setup
    app.set("views", path.join(assetsDir, "views"));
    app.engine("ejs", (filePath, options, callback) => ejs.renderFile(filePath, options, callback));
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
        log.error(`Invalid CORS Resource Policy value: '${resourcePolicy}', defaulting to 'same-origin'`);
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

    if (openID.isOpenIDEnabled())
        app.use(auth(openID.generateOAuthConfig()));

    await assets.register(app);
    routes.register(app);
    custom.register(app);
    error_handlers.register(app);

    const { startSyncTimer } = await import("./services/sync.js");
    startSyncTimer();

    await import("./services/backup.js");

    const { startConsistencyChecks } = await import("./services/consistency_checks.js");
    startConsistencyChecks();

    const { startScheduler } = await import("./services/scheduler.js");
    startScheduler();

    startScheduledCleanup();

    if (utils.isElectron) {
        (await import("@electron/remote/main/index.js")).initialize();
    }

    return app;
}
