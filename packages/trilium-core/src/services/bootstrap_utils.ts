import { BootstrapDefinition } from "@triliumnext/commons";
import { getSql } from "./sql";
import protected_session from "./protected_session";
import { generateCss, generateIconRegistry, getIconPacks, MIME_TO_EXTENSION_MAPPINGS } from "./icon_packs";
import optionService from "./options";
import { getCurrentLocale } from "./i18n";
import attributes from "./attributes";
import BNote from "../becca/entities/bnote";
import { getPlatform } from "./platform";

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
    }
}

export function getIconConfig(assetPath: string): Pick<BootstrapDefinition, "iconRegistry" | "iconPackCss"> {
    const iconPacks = getIconPacks();

    return {
        iconRegistry: generateIconRegistry(iconPacks),
        iconPackCss: iconPacks
            .map(p => generateCss(p, p.builtin
                ? `${assetPath}/fonts/${p.fontAttachmentId}.${MIME_TO_EXTENSION_MAPPINGS[p.fontMime]}`
                : `api/attachments/download/${p.fontAttachmentId}`))
            .filter(Boolean)
            .join("\n\n"),
    };
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

    if (!process.env.TRILIUM_SAFE_MODE && themeNote) {
        return `api/notes/download/${themeNote.noteId}`;
    }

    return undefined;
}
