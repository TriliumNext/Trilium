import fs from "fs";
import http from "http";
import https from "https";
import tmp from "tmp";
import config from "./services/config.js";
import log from "./services/log.js";
import appInfo from "./services/app_info.js";
import ws from "./services/ws.js";
import utils, { formatSize, formatUtcTime } from "./services/utils.js";
import port from "./services/port.js";
import host from "./services/host.js";
import buildApp from "./app.js";
import type { Express } from "express";
import { getDbSize } from "./services/sql_init.js";
import { isScriptingEnabled } from "./services/scripting_guard.js";

const MINIMUM_NODE_VERSION = "20.0.0";

const LOGO = `\
 _____     _ _ _
|_   _| __(_) (_)_   _ _ __ ___   | \\ | | ___ | |_ ___  ___
  | || '__| | | | | | | '_ \` _ \\  |  \\| |/ _ \\| __/ _ \\/ __|
  | || |  | | | | |_| | | | | | | | |\\  | (_) | ||  __/\\__ \\
  |_||_|  |_|_|_|\\__,_|_| |_| |_| |_| \\_|\\___/ \\__\\___||___/ [version]
`;

export default async function startTriliumServer() {
    await displayStartupMessage();

    // setup basic error handling even before requiring dependencies, since those can produce errors as well
    process.on("unhandledRejection", (error: Error) => {
        // this makes sure that stacktrace of failed promise is printed out
        console.log(error);

        // but also try to log it into file
        log.info(error);
    });

    function exit() {
        console.log("Caught interrupt/termination signal. Exiting.");
        process.exit(0);
    }

    process.on("SIGINT", exit);
    process.on("SIGTERM", exit);

    if (utils.compareVersions(process.versions.node, MINIMUM_NODE_VERSION) < 0) {
        console.error();
        console.error(`The Trilium server requires Node.js ${MINIMUM_NODE_VERSION} and later in order to start.\n`);
        console.error(`\tCurrent version:\t${process.versions.node}`);
        console.error(`\tExpected version:\t${MINIMUM_NODE_VERSION}`);
        console.error();
        process.exit(1);
    }

    tmp.setGracefulCleanup();

    const app = await buildApp();
    const httpServer = startHttpServer(app);

    const sessionParser = (await import("./routes/session_parser.js")).default;
    ws.init(httpServer, sessionParser as any); // TODO: Not sure why session parser is incompatible.

    if (utils.isElectron) {
        const electronRouting = await import("./routes/electron.js");
        electronRouting.default(app);
    }
}

async function displayStartupMessage() {
    log.info("\n" + LOGO.replace("[version]", appInfo.appVersion));
    log.info(`📦 Versions:    app=${appInfo.appVersion} db=${appInfo.dbVersion} sync=${appInfo.syncVersion} clipper=${appInfo.clipperProtocolVersion}`)
    log.info(`🔧 Build:       ${formatUtcTime(appInfo.buildDate)} (${appInfo.buildRevision.substring(0, 10)})`);
    log.info(`📂 Data dir:    ${appInfo.dataDirectory}`);
    log.info(`⏰ UTC time:    ${formatUtcTime(appInfo.utcDateTime)}`);

    // for perf. issues it's good to know the rough configuration
    const cpuInfos = (await import("os")).cpus();
    if (cpuInfos && cpuInfos[0] !== undefined) {
        // https://github.com/zadam/trilium/pull/3957
        const cpuModel = (cpuInfos[0].model || "").trimEnd();
        log.info(`💻 CPU:         ${cpuModel} (${cpuInfos.length}-core @ ${cpuInfos[0].speed} Mhz)`);
    }
    log.info(`💾 DB size:     ${formatSize(getDbSize() * 1024)}`);

    if (isScriptingEnabled()) {
        log.info("WARNING: Script execution is ENABLED. Scripts have full server access including " +
                 "filesystem, network, and OS commands. Only enable in trusted environments.");
    } else {
        log.info("Script execution is DISABLED. Set [Scripting] enabled=true in config.ini to enable.");
    }

    log.info("");
}

function startHttpServer(app: Express) {
    app.set("port", port);
    app.set("host", host);

    // Check from config whether to trust reverse proxies to supply user IPs, hostnames and protocols
    if (config["Network"]["trustedReverseProxy"]) {
        if (config["Network"]["trustedReverseProxy"] === true || config["Network"]["trustedReverseProxy"].trim().length) {
            app.set("trust proxy", config["Network"]["trustedReverseProxy"]);
        }
    }

    log.info(`Trusted reverse proxy: ${app.get("trust proxy")}`);

    let httpServer: http.Server | https.Server;

    if (config["Network"]["https"]) {
        if (!config["Network"]["keyPath"] || !config["Network"]["keyPath"].trim().length) {
            throw new Error("keyPath in config.ini is required when https=true, but it's empty");
        }

        if (!config["Network"]["certPath"] || !config["Network"]["certPath"].trim().length) {
            throw new Error("certPath in config.ini is required when https=true, but it's empty");
        }

        const options = {
            key: fs.readFileSync(config["Network"]["keyPath"]),
            cert: fs.readFileSync(config["Network"]["certPath"])
        };

        httpServer = https.createServer(options, app);

        log.info(`App HTTPS server starting up at port ${port}`);
    } else {
        httpServer = http.createServer(app);

        log.info(`App HTTP server starting up at port ${port}`);
    }

    /**
     * Listen on provided port, on all network interfaces.
     */

    httpServer.keepAliveTimeout = 120000 * 5;
    const listenOnTcp = port !== 0;

    if (listenOnTcp) {
        httpServer.listen(port, host); // TCP socket.
    } else {
        httpServer.listen(host); // Unix socket.
    }

    httpServer.on("error", (error) => {
        let message = error.stack || "An unexpected error has occurred.";

        // handle specific listen errors with friendly messages
        if ("code" in error) {
            switch (error.code) {
                case "EACCES":
                    message = `Port ${port} requires elevated privileges. It's recommended to use port above 1024.`;
                    break;
                case "EADDRINUSE":
                    message = `Port ${port} is already in use. Most likely, another Trilium process is already running. You might try to find it, kill it, and try again.`;
                    break;
                case "EADDRNOTAVAIL":
                    message = `Unable to start the server on host '${host}'. Make sure the host (defined in 'config.ini' or via the 'TRILIUM_HOST' environment variable) is an IP address that can be listened on.`;
                    break;
            }
        }

        if (utils.isElectron) {
            import("electron").then(({ app, dialog }) => {
                // Not all situations require showing an error dialog. When Trilium is already open,
                // clicking the shortcut, the software icon, or the taskbar icon, or when creating a new window,
                // should simply focus on the existing window or open a new one, without displaying an error message.
                if ("code" in error && error.code === "EADDRINUSE" && (process.argv.includes("--new-window") || !app.requestSingleInstanceLock())) {
                    console.error(message);
                } else {
                    dialog.showErrorBox("Error while initializing the server", message);
                }
                process.exit(1);
            });
        } else {
            console.error(message);
            process.exit(1);
        }
    });

    httpServer.on("listening", () => {
        if (listenOnTcp) {
            log.info(`Listening on port ${port}`);
        } else {
            log.info(`Listening on unix socket ${host}`);
        }
    });

    return httpServer;
}
