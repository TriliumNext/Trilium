"use strict";

import sql from "../services/sql.js";
import attributeService from "../services/attributes.js";
import config from "../services/config.js";
import optionService from "../services/options.js";
import log from "../services/log.js";
import { isDev, isElectron } from "../services/utils.js";
import protectedSessionService from "../services/protected_session.js";
import packageJson from "../../package.json" with { type: "json" };
import assetPath from "../services/asset_path.js";
import appPath from "../services/app_path.js";
import { generateCsrfToken } from "./csrf_protection.js";

import type { Request, Response } from "express";
import type BNote from "../becca/entities/bnote.js";

function index(req: Request, res: Response) {
    const options = optionService.getOptionMap();
    const view = getView(req);

    const csrfToken = generateCsrfToken(req, res, {
        overwrite: false,
        validateOnReuse: false      // if validation fails, generate a new token instead of throwing an error
    });
    log.info(`CSRF token generation: ${csrfToken ? "Successful" : "Failed"}`);

    // We force the page to not be cached since on mobile the CSRF token can be
    // broken when closing the browser and coming back in to the page.
    // The page is restored from cache, but the API call fail.
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");

    const theme = options.theme;
    const themeNote = attributeService.getNoteWithLabel("appTheme", theme);

    res.render(view, {
        device: view,
        csrfToken: csrfToken,
        themeCssUrl: getThemeCssUrl(theme, themeNote),
        themeUseNextAsBase: themeNote?.getAttributeValue("label", "appThemeBase"),
        headingStyle: options.headingStyle,
        layoutOrientation: options.layoutOrientation,
        platform: process.platform,
        isElectron,
        hasNativeTitleBar: isElectron && options.nativeTitleBarVisible === "true",
        hasBackgroundEffects: isElectron && options.backgroundEffects === "true",
        mainFontSize: parseInt(options.mainFontSize),
        treeFontSize: parseInt(options.treeFontSize),
        detailFontSize: parseInt(options.detailFontSize),
        maxEntityChangeIdAtLoad: sql.getValue("SELECT COALESCE(MAX(id), 0) FROM entity_changes"),
        maxEntityChangeSyncIdAtLoad: sql.getValue("SELECT COALESCE(MAX(id), 0) FROM entity_changes WHERE isSynced = 1"),
        instanceName: config.General ? config.General.instanceName : null,
        appCssNoteIds: getAppCssNoteIds(),
        isDev,
        isMainWindow: view === "mobile" ? true : !req.query.extraWindow,
        isProtectedSessionAvailable: protectedSessionService.isProtectedSessionAvailable(),
        maxContentWidth: Math.max(640, parseInt(options.maxContentWidth)),
        triliumVersion: packageJson.version,
        assetPath: assetPath,
        appPath: appPath
    });
}

function getView(req: Request): "desktop" | "mobile" {
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

function getThemeCssUrl(theme: string, themeNote: BNote | null) {
    if (theme === "auto") {
        return `${assetPath}/stylesheets/theme.css`;
    } else if (theme === "light") {
        // light theme is always loaded as baseline
        return false;
    } else if (theme === "dark") {
        return `${assetPath}/stylesheets/theme-dark.css`;
    } else if (theme === "next") {
        return `${assetPath}/stylesheets/theme-next.css`;
    } else if (theme === "next-light") {
        return `${assetPath}/stylesheets/theme-next-light.css`;
    } else if (theme === "next-dark") {
        return `${assetPath}/stylesheets/theme-next-dark.css`;
    } else if (!process.env.TRILIUM_SAFE_MODE && themeNote) {
        return `api/notes/download/${themeNote.noteId}`;
    } else {
        // baseline light theme
        return false;
    }
}

function getAppCssNoteIds() {
    return attributeService.getNotesWithLabel("appCss").map((note) => note.noteId);
}

export default {
    index
};
