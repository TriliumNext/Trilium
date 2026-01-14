import { BootstrapDefinition } from "@triliumnext/commons";
import { getSql } from "./sql";
import protected_session from "./protected_session";
import { generateCss, generateIconRegistry, getIconPacks, MIME_TO_EXTENSION_MAPPINGS } from "./icon_packs";
import options from "./options";
import { getCurrentLocale } from "./i18n";

export default function getSharedBootstrapItems(assetPath: string): Pick<BootstrapDefinition, "assetPath" | "headingStyle" | "layoutOrientation" | "maxEntityChangeIdAtLoad" | "maxEntityChangeSyncIdAtLoad" | "isProtectedSessionAvailable" | "iconRegistry" | "iconPackCss" | "currentLocale" | "isRtl"> {
    const sql = getSql();
    const iconPacks = getIconPacks();
    const currentLocale = getCurrentLocale();

    return {
        assetPath,
        headingStyle: options.getOption("headingStyle") as "plain" | "underline" | "markdown",
        layoutOrientation: options.getOption("layoutOrientation") as "vertical" | "horizontal",
        maxEntityChangeIdAtLoad: sql.getValue("SELECT COALESCE(MAX(id), 0) FROM entity_changes"),
        maxEntityChangeSyncIdAtLoad: sql.getValue("SELECT COALESCE(MAX(id), 0) FROM entity_changes WHERE isSynced = 1"),
        isProtectedSessionAvailable: protected_session.isProtectedSessionAvailable(),
        currentLocale,
        isRtl: !!currentLocale.rtl,
        iconRegistry: generateIconRegistry(iconPacks),
        iconPackCss: iconPacks
            .map(p => generateCss(p, p.builtin
                ? `${assetPath}/fonts/${p.fontAttachmentId}.${MIME_TO_EXTENSION_MAPPINGS[p.fontMime]}`
                : `api/attachments/download/${p.fontAttachmentId}`))
            .filter(Boolean)
            .join("\n\n"),
    }
}
