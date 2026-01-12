import type { Request, Response } from "express";

import packageJson from "../../package.json" with { type: "json" };
import type BNote from "../becca/entities/bnote.js";
import appPath from "../services/app_path.js";
import assetPath from "../services/asset_path.js";
import attributeService from "../services/attributes.js";
import config from "../services/config.js";
import { getCurrentLocale } from "../services/i18n.js";
import { generateCss, generateIconRegistry, getIconPacks, MIME_TO_EXTENSION_MAPPINGS } from "../services/icon_packs.js";
import log from "../services/log.js";
import optionService from "../services/options.js";
import protectedSessionService from "../services/protected_session.js";
import sql from "../services/sql.js";
import { isDev, isElectron, isWindows11 } from "../services/utils.js";
import { generateToken as generateCsrfToken } from "./csrf_protection.js";


type View = "desktop" | "mobile" | "print";

export function bootstrap(req: Request, res: Response) {
    const options = optionService.getOptionMap();

    //'overwrite' set to false (default) => the existing token will be re-used and validated
    //'validateOnReuse' set to false => if validation fails, generate a new token instead of throwing an error
    const csrfToken = generateCsrfToken(req, res, false, false);
    log.info(`CSRF token generation: ${csrfToken ? "Successful" : "Failed"}`);

    const view = getView(req);
    const theme = options.theme;
    const themeNote = attributeService.getNoteWithLabel("appTheme", theme);
    const nativeTitleBarVisible = options.nativeTitleBarVisible === "true";
    const iconPacks = getIconPacks();
    const currentLocale = getCurrentLocale();

    res.send({
        device: view,
        csrfToken,
        themeCssUrl: getThemeCssUrl(theme, themeNote),
        themeUseNextAsBase: themeNote?.getAttributeValue("label", "appThemeBase"),
        headingStyle: options.headingStyle,
        layoutOrientation: options.layoutOrientation,
        platform: process.platform,
        isElectron,
        hasNativeTitleBar: isElectron && nativeTitleBarVisible,
        hasBackgroundEffects: isElectron && isWindows11 && !nativeTitleBarVisible && options.backgroundEffects === "true",
        maxEntityChangeIdAtLoad: sql.getValue("SELECT COALESCE(MAX(id), 0) FROM entity_changes"),
        maxEntityChangeSyncIdAtLoad: sql.getValue("SELECT COALESCE(MAX(id), 0) FROM entity_changes WHERE isSynced = 1"),
        instanceName: config.General ? config.General.instanceName : null,
        appCssNoteIds: getAppCssNoteIds(),
        isDev,
        isMainWindow: view === "mobile" ? true : !req.query.extraWindow,
        isProtectedSessionAvailable: protectedSessionService.isProtectedSessionAvailable(),
        triliumVersion: packageJson.version,
        assetPath,
        appPath,
        baseApiUrl: 'api/',
        currentLocale,
        isRtl: !!currentLocale.rtl,
        iconPackCss: iconPacks
            .map(p => generateCss(p, p.builtin
                ? `${assetPath}/fonts/${p.fontAttachmentId}.${MIME_TO_EXTENSION_MAPPINGS[p.fontMime]}`
                : `api/attachments/download/${p.fontAttachmentId}`))
            .filter(Boolean)
            .join("\n\n"),
        iconRegistry: generateIconRegistry(iconPacks),
        TRILIUM_SAFE_MODE: !!process.env.TRILIUM_SAFE_MODE
    });
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
    }
    // baseline light theme
    return false;
}

function getAppCssNoteIds() {
    return attributeService.getNotesWithLabel("appCss").map((note) => note.noteId);
}
