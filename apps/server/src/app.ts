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

    app.use(express.static(path.join(publicDir, "root")));
    app.use(`/manifest.webmanifest`, express.static(path.join(publicAssetsDir, "manifest.webmanifest")));
    app.use(`/robots.txt`, express.static(path.join(publicAssetsDir, "robots.txt")));
    app.use(`/icon.png`, express.static(path.join(publicAssetsDir, "icon.png")));

    const sessionParser = (await import("./routes/session_parser.js")).default;
    app.use(sessionParser);
    app.use(favicon(path.join(assetsDir, "icon.ico")));

    if (openID.isOpenIDEnabled())
        app.use(auth(openID.generateOAuthConfig()));

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
