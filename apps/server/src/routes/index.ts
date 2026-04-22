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
import { isDev, isElectron, isMac, isWindows11 } from "../services/utils.js";
import { generateCsrfToken } from "./csrf_protection.js";

type View = "desktop" | "mobile" | "print";

export function bootstrap(req: Request, res: Response) {
    const options = optionService.getOptionMap();

    // csrf-csrf v4 binds CSRF tokens to the session ID via HMAC. With saveUninitialized: false,
    // a brand-new session is never persisted unless explicitly modified, so its cookie is never
    // sent to the browser — meaning every request gets a different ephemeral session ID, and
    // CSRF validation fails. Setting this flag marks the session as modified, which causes
    // express-session to persist it and send the session cookie in this response.
    if (!req.session.csrfInitialized) {
        req.session.csrfInitialized = true;
    }

    const csrfToken = generateCsrfToken(req, res, {
        overwrite: false,
        validateOnReuse: false      // if validation fails, generate a new token instead of throwing an error
    });
    log.info(`CSRF token generation: ${csrfToken ? "Successful" : "Failed"}`);

    const view = getView(req);
    const theme = options.theme;
    const themeNote = attributeService.getNoteWithLabel("appTheme", theme);
    const themeUseNextAsBase = themeNote?.getAttributeValue("label", "appThemeBase") ?? undefined;
    const nativeTitleBarVisible = options.nativeTitleBarVisible === "true";
    const iconPacks = getIconPacks();
    const currentLocale = getCurrentLocale();

    res.send({
        device: view,
        csrfToken,
        theme,
        themeBase: themeUseNextAsBase,
        customThemeCssUrl: getCustomThemeCssUrl(theme, themeNote),
        headingStyle: options.headingStyle,
        layoutOrientation: options.layoutOrientation,
        platform: process.platform,
        isElectron,
        hasNativeTitleBar: isElectron && nativeTitleBarVisible,
        hasBackgroundEffects: options.backgroundEffects === "true"
            && isElectron
            && (isWindows11 || isMac)
            && !nativeTitleBarVisible,
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

function getCustomThemeCssUrl(theme: string, themeNote: BNote | null) {
    if (["auto", "light", "dark", "next", "next-light", "next-dark"].includes(theme)) {
        return undefined;
    }

    if (!process.env.TRILIUM_SAFE_MODE && themeNote) {
        return `api/notes/download/${themeNote.noteId}`;
    }

    return undefined;
}

function getAppCssNoteIds() {
    return attributeService.getNotesWithLabel("appCss").map((note) => note.noteId);
}
