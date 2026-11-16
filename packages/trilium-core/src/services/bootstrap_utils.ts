import { BootstrapDefinition, buildFontCss, type OptionMap } from "@triliumnext/commons";
import { getSql } from "./sql";
import protected_session from "./protected_session";
import {
    generateIconPackFontCss, generateIconPackGlyphCss, generateIconRegistry, getIconPacks, MIME_TO_EXTENSION_MAPPINGS,
    type ProcessedIconPack
} from "./icon_packs";
import { generateTaskStateCss } from "./task_states";
import optionService from "./options";
import { getCurrentLocale } from "./i18n";
import attributes from "./attributes";
import BNote from "../becca/entities/bnote";
import { getPlatform } from "./platform";
import { isSetupAuthRequired, isSetupSecondFactorRequired } from "./setup_auth";
import { getSetupTargetScreen, hasExistingData, isSetupRequested } from "./setup_mode";
import sqlInit from "./sql_init";
import { md5 } from "./utils/index";

export default function getSharedBootstrapItems(assetPath: string, dbInitialized: boolean) {
    const sql = getSql();
    const currentLocale = getCurrentLocale();

    const commonItems = {
        assetPath,
        dbInitialized,
        currentLocale,
        isRtl: !!currentLocale.rtl,
        isProtectedSessionAvailable: false,
        layoutOrientation: "vertical" as const,
        headingStyle: "plain" as const,
        componentId: "",
        // Schema present but not yet initialized means a sync was started and interrupted, so the
        // setup screen resumes it instead of starting over. A fully initialized DB is never mid-sync.
        // Kept in the common items so both payload shapes carry the flag uniformly. An instance that
        // was asked into setup has a finished database behind it, so its schema says nothing here.
        syncInProgress: !dbInitialized && !isSetupRequested() && sqlInit.schemaExists(),
        // Where the wizard should open, whether it still has anything to lose, and whether it has to
        // be unlocked before it will act on it. Only a marker says otherwise; a first run leaves all
        // three at their first-run answers.
        hasExistingData: hasExistingData(),
        setupAuthRequired: isSetupAuthRequired(),
        setupSecondFactorRequired: isSetupSecondFactorRequired(),
        setupTargetScreen: getSetupTargetScreen(),
        ...getIconConfig(assetPath)
    };

    // Setup not yet finished.
    if (!dbInitialized) {
        return {
            ...commonItems,
            theme: "next",
            themeCssUrl: false as const,
            themeUseNextAsBase: "next" as const,
            appCssNoteIds: [],
            preloadFonts: getPreloadFonts(assetPath, "next", undefined, null),
        };
    }

    // Database initialized.
    const options = optionService.getOptionMap();
    const theme = options.theme;
    const themeNote = attributes.getNoteWithLabel("appTheme", theme);
    const themeUseNextAsBase = themeNote?.getAttributeValue("label", "appThemeBase") ?? undefined;

    return {
        ...commonItems,
        headingStyle: options.headingStyle as "plain" | "underline" | "markdown",
        layoutOrientation: options.layoutOrientation as "vertical" | "horizontal",
        maxEntityChangeIdAtLoad: sql.getValue<number>("SELECT COALESCE(MAX(id), 0) FROM entity_changes"),
        maxEntityChangeSyncIdAtLoad: sql.getValue<number>("SELECT COALESCE(MAX(id), 0) FROM entity_changes WHERE isSynced = 1"),
        isProtectedSessionAvailable: protected_session.isProtectedSessionAvailable(),
        theme,
        themeBase: themeUseNextAsBase as "next" | "next-light" | "next-dark" | undefined,
        customThemeCssUrl: getCustomThemeCssUrl(theme, themeNote),
        themeCssUrl: getThemeCssUrl(theme, commonItems.assetPath, themeNote) as string | false,
        themeUseNextAsBase: themeNote?.getAttributeValue("label", "appThemeBase") as "next" | "next-light" | "next-dark",
        appCssNoteIds: getAppCssNoteIds(),
        preloadFonts: getPreloadFonts(assetPath, theme, themeUseNextAsBase, options),
        fontCss: buildFontCss(options),
    }
}

export function getIconConfig(assetPath: string): Pick<BootstrapDefinition, "iconPacks" | "iconPackCss" | "iconPackGlyphCssUrl"> {
    const iconPacks = getIconPacks();

    return {
        iconPacks: generateIconRegistry(iconPacks).sources.map(({ prefix, name, icon }) => ({ prefix, name, icon })),
        iconPackCss: [
            ...iconPacks.map(p => generateIconPackFontCss(p, getIconPackFontUrl(p, assetPath))),
            generateTaskStateCss(iconPacks)
        ]
            .filter(Boolean)
            .join("\n\n"),
        // Named after its content, so the browser keeps it until an icon pack changes.
        iconPackGlyphCssUrl: `api/icon-packs.css?v=${md5(getIconPackGlyphCss(iconPacks))}`
    };
}

/** The glyph of every icon of the icon packs, which `GET /api/icon-packs.css` serves. */
export function getIconPackGlyphCss(iconPacks = getIconPacks()) {
    return iconPacks.map((iconPack) => generateIconPackGlyphCss(iconPack)).filter(Boolean).join("\n");
}

function getIconPackFontUrl(iconPack: ProcessedIconPack, assetPath: string) {
    return iconPack.builtin
        ? `${assetPath}/fonts/${iconPack.fontAttachmentId}.${MIME_TO_EXTENSION_MAPPINGS[iconPack.fontMime]}`
        : `api/attachments/download/${iconPack.fontAttachmentId}`;
}

/**
 * The fonts the first render draws text with, so the client can request them before its
 * scripts lay out any text. Boxicons draws the interface icons under every theme. The Next
 * themes draw `--main-font-family` in Inter unless `/api/fonts` overrides it, and
 * `--tree-font-family` and `--detail-font-family` follow that variable.
 */
function getPreloadFonts(assetPath: string, theme: string, themeBase: string | undefined, options: OptionMap | null) {
    const fonts: string[] = [];

    const boxicons = getIconPacks().find((iconPack) => iconPack.builtin && iconPack.fontAttachmentId === "boxicons");
    /* v8 ignore else -- `getIconPacks()` always lists the built-in Boxicons pack */
    if (boxicons) {
        fonts.push(getIconPackFontUrl(boxicons, assetPath));
    }

    const isNextBased = isNextTheme(theme) || isNextTheme(themeBase);
    const mainFontOverridden = options?.overrideThemeFonts === "true" && options.mainFontFamily !== "theme";
    if (isNextBased && !mainFontOverridden) {
        fonts.push(`${assetPath}/fonts/Inter/Inter-VariableFont_opsz,wght.woff2`);
    }

    return fonts;
}

const NEXT_THEMES = [ "next", "next-light", "next-dark" ];

function isNextTheme(theme: string | undefined) {
    return !!theme && NEXT_THEMES.includes(theme);
}

/**
 * Whether the stylesheets of `theme` include the Next theme's, either because it is one of the Next
 * themes or because it is a custom theme whose `appThemeBase` names one.
 */
export function isNextBasedTheme(theme: string) {
    const themeNote = attributes.getNoteWithLabel("appTheme", theme);
    return isNextTheme(theme) || isNextTheme(themeNote?.getAttributeValue("label", "appThemeBase") ?? undefined);
}

function getAppCssNoteIds() {
    return attributes.getNotesWithLabel("appCss").map((note) => note.noteId);
}

function getThemeCssUrl(theme: string, assetPath: string, themeNote: BNote | null) {
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
    } else if (!getPlatform().getEnv("TRILIUM_SAFE_MODE") && themeNote) {
        return `api/notes/download/${themeNote.noteId}`;
    }
    // baseline light theme
    return false;
}

function getCustomThemeCssUrl(theme: string, themeNote: BNote | null) {
    if (["auto", "light", "dark", "next", "next-light", "next-dark"].includes(theme)) {
        return undefined;
    }

    if (!getPlatform().getEnv("TRILIUM_SAFE_MODE") && themeNote) {
        return `api/notes/download/${themeNote.noteId}`;
    }

    return undefined;
}
