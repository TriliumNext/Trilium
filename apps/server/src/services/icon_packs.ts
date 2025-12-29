import { IconRegistry } from "@triliumnext/commons";

import type BAttachment from "../becca/entities/battachment";
import type BNote from "../becca/entities/bnote";
import boxiconsManifest from "./icon_pack_boxicons-v2.json" with { type: "json" };
import log from "./log";
import search from "./search/services/search";
import { safeExtractMessageAndStackFromError } from "./utils";

const PREFERRED_MIME_TYPE = [
    "font/woff2",
    "font/woff",
    "font/ttf"
] as const;

const MIME_TO_CSS_FORMAT_MAPPINGS: Record<typeof PREFERRED_MIME_TYPE[number], string> = {
    "font/ttf": "truetype",
    "font/woff": "woff",
    "font/woff2": "woff2"
};

export const MIME_TO_EXTENSION_MAPPINGS: Record<string, string> = {
    "font/ttf": "ttf",
    "font/woff": "woff",
    "font/woff2": "woff2"
};

export interface IconPackManifest {
    icons: Record<string, {
        glyph: string,
        terms: string[];
    }>;
}

export interface ProcessedIconPack {
    prefix: string;
    manifest: IconPackManifest;
    manifestNoteId: string;
    fontMime: string;
    fontAttachmentId: string;
    title: string;
    icon: string;
    /** Indicates whether this icon pack is built-in (shipped with Trilium) or user-defined. */
    builtin: boolean;
}

export function getIconPacks() {
    const defaultIconPack: ProcessedIconPack = {
        prefix: "bx",
        manifest: boxiconsManifest,
        manifestNoteId: "boxicons",
        fontMime: "font/woff2",
        fontAttachmentId: "boxicons",
        title: "Boxicons",
        icon: "bx bx-package",
        builtin: true
    };

    const usedPrefixes = new Set<string>([defaultIconPack.prefix]);
    const customIconPacks = search.searchNotes("#iconPack")
        .filter(note => !note.isProtected)
        .map(iconPackNote => processIconPack(iconPackNote))
        .filter(iconPack => {
            if (!iconPack) return false;

            if (iconPack.prefix === "bx" || usedPrefixes.has(iconPack.prefix)) {
                log.info(`Skipping icon pack with duplicate prefix '${iconPack.prefix}': ${iconPack.title} (${iconPack.manifestNoteId})`);
                return false;
            }
            usedPrefixes.add(iconPack.prefix);
            return true;
        }) as ProcessedIconPack[];

    return [
        defaultIconPack,
        ...customIconPacks
    ];
}

export function generateIconRegistry(iconPacks: ProcessedIconPack[]): IconRegistry {
    const sources: IconRegistry["sources"] = [];

    for (const { manifest, title, icon, prefix } of iconPacks) {
        const icons: IconRegistry["sources"][number]["icons"] = Object.entries(manifest.icons)
            .map(( [id, { terms }] ) => {
                if (!id || !terms) return null;
                return { id: `${prefix} ${id}`, terms };
            })
            .filter(Boolean) as IconRegistry["sources"][number]["icons"];
        if (!icons.length) continue;

        sources.push({
            prefix,
            name: title,
            icon,
            icons
        });
    }

    return { sources };
}

export function processIconPack(iconPackNote: BNote): ProcessedIconPack | undefined {
    const manifest = iconPackNote.getJsonContentSafely() as IconPackManifest;
    if (!manifest) {
        log.error(`Icon pack is missing JSON manifest (or has syntax errors): ${iconPackNote.title} (${iconPackNote.noteId})`);
        return;
    }

    const attachment = determineBestFontAttachment(iconPackNote);
    if (!attachment || !attachment.attachmentId) {
        log.error(`Icon pack is missing WOFF/WOFF2/TTF attachment: ${iconPackNote.title} (${iconPackNote.noteId})`);
        return;
    }

    const prefix = iconPackNote.getLabelValue("iconPack");
    if (!prefix) {
        log.error(`Icon pack is missing 'iconPack' label defining its prefix: ${iconPackNote.title} (${iconPackNote.noteId})`);
        return;
    }

    // Ensure prefix is alphanumeric only, dashes and underscores.
    if (!/^[a-zA-Z0-9-_]+$/.test(prefix)) {
        log.error(`Icon pack has invalid 'iconPack' prefix (only alphanumeric characters, dashes and underscores are allowed): ${iconPackNote.title} (${iconPackNote.noteId})`);
        return;
    }

    return {
        prefix,
        manifest,
        fontMime: attachment.mime,
        fontAttachmentId: attachment.attachmentId,
        title: iconPackNote.title,
        manifestNoteId: iconPackNote.noteId,
        icon: iconPackNote.getIcon(),
        builtin: false
    };
}

export function determineBestFontAttachment(iconPackNote: BNote) {
    // Map all the attachments by their MIME.
    const mappings = new Map<string, BAttachment>();
    for (const attachment of iconPackNote.getAttachmentsByRole("file")) {
        mappings.set(attachment.mime, attachment);
    }

    // Return the icon formats in order of preference.
    for (const preferredMimeType of PREFERRED_MIME_TYPE) {
        const correspondingAttachment = mappings.get(preferredMimeType);
        if (correspondingAttachment) return correspondingAttachment;
    }

    return null;
}

export function generateCss({ manifest, fontMime, builtin, fontAttachmentId, prefix }: ProcessedIconPack, fontUrl: string) {
    try {
        const iconDeclarations: string[] = [];
        for (const [ key, mapping ] of Object.entries(manifest.icons)) {
            iconDeclarations.push(`.${prefix}.${key}::before { content: "${mapping.glyph}"; }`);
        }

        const fontFamily = builtin ? fontAttachmentId : `trilium-icon-pack-${prefix}`;
        return `\
            @font-face {
                font-family: '${fontFamily}';
                font-weight: normal;
                font-style: normal;
                src: url('${fontUrl}') format('${MIME_TO_CSS_FORMAT_MAPPINGS[fontMime]}');
            }

            .${prefix} {
                font-family: '${fontFamily}' !important;
                font-weight: normal;
                font-style: normal;
                font-variant: normal;
                line-height: 1;
                text-rendering: auto;
                display: inline-block;
                text-transform: none;
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
            }

            ${iconDeclarations.join("\n")}
        `;
    } catch (e) {
        log.error(safeExtractMessageAndStackFromError(e));
        return null;
    }
}
