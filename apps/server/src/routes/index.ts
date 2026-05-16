import { BootstrapDefinition } from "@triliumnext/commons";
import { attributes, BNote, getSharedBootstrapItems, icon_packs as iconPackService, sql_init } from "@triliumnext/core";
import type { Request, Response } from "express";

import packageJson from "../../package.json" with { type: "json" };
import appPath from "../services/app_path.js";
import assetPath from "../services/asset_path.js";
import config from "../services/config.js";
import log from "../services/log.js";
import optionService from "../services/options.js";
import { isDev, isElectron, isMac, isWindows11 } from "../services/utils.js";
import { generateCsrfToken } from "./csrf_protection.js";

type View = "desktop" | "mobile" | "print";

export function bootstrap(req: Request, res: Response) {
    // csrf-csrf v4 binds CSRF tokens to the session ID via HMAC. With saveUninitialized: false,
    // a brand-new session is never persisted unless explicitly modified, so its cookie is never
    // sent to the browser — meaning every request gets a different ephemeral session ID, and
    // CSRF validation fails. Setting this flag marks the session as modified, which causes
    // express-session to persist it and send the session cookie in this response.
    if (!req.session.csrfInitialized) {
        req.session.csrfInitialized = true;
    }

    const view = getView(req);
    const isDbInitialized = sql_init.isDbInitialized();
    const commonItems = {
        ...getSharedBootstrapItems(assetPath, isDbInitialized),
        baseApiUrl: "api/",
        appPath,
        isStandalone: false,
        isElectron,
        isDev,
        triliumVersion: packageJson.version,
        device: view,
        TRILIUM_SAFE_MODE: !!process.env.TRILIUM_SAFE_MODE,
        instanceName: config.General ? config.General.instanceName : null
    };
    if (!isDbInitialized) {
        res.send({
            ...commonItems,
            hasNativeTitleBar: false,
            hasBackgroundEffects: isElectron && (isWindows11 || isMac),
            isMainWindow: true,
            appCssNoteIds: []
        } satisfies BootstrapDefinition);
        return;
    }


    const csrfToken = generateCsrfToken(req, res, {
        overwrite: false,
        validateOnReuse: false      // if validation fails, generate a new token instead of throwing an error
    });
    log.info(`CSRF token generation: ${csrfToken ? "Successful" : "Failed"}`);

    const options = optionService.getOptionMap();
    const nativeTitleBarVisible = options.nativeTitleBarVisible === "true";
    const iconPacks = iconPackService.getIconPacks();

    res.send({
        ...commonItems,
        dbInitialized: true,
        csrfToken,
        platform: process.platform,
        hasNativeTitleBar: isElectron && nativeTitleBarVisible,
        hasBackgroundEffects: options.backgroundEffects === "true"
            && isElectron
            && (isWindows11 || isMac)
            && !nativeTitleBarVisible,
        isMainWindow: view === "mobile" ? true : !req.query.extraWindow,
        iconPackCss: iconPacks
            .map((p: iconPackService.ProcessedIconPack) => iconPackService.generateCss(p, p.builtin
                ? `${assetPath}/fonts/${p.fontAttachmentId}.${iconPackService.MIME_TO_EXTENSION_MAPPINGS[p.fontMime]}`
                : `api/attachments/download/${p.fontAttachmentId}`))
            .filter(Boolean)
            .join("\n\n"),
    } satisfies BootstrapDefinition);
}

function getView(req: Request): View {
    // Special override for printing.
    if ("print" in req.query) {
        return "print";
    }

    // Electron always uses the desktop view.
    if (isElectron) {
        return "desktop";
    }

    // Respect user's manual override via URL.
    if ("desktop" in req.query) {
        return "desktop";
    } else if ("mobile" in req.query) {
        return "mobile";
    }

    // Respect user's manual override via cookie.
    const cookie = req.cookies?.["trilium-device"];
    if (cookie === "mobile" || cookie === "desktop") {
        return cookie;
    }

    // Try to detect based on user agent.
    const userAgent = req.headers["user-agent"];
    if (userAgent) {
        // TODO: Deduplicate regex with client-side login.ts.
        const mobileRegex = /\b(Android|iPhone|iPad|iPod|Windows Phone|BlackBerry|webOS|IEMobile)\b/i;
        if (mobileRegex.test(userAgent)) {
            return "mobile";
        }
    }

    return "desktop";
}
