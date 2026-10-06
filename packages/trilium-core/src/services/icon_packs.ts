import { iconFontFaceOverrides, type IconFontMetrics, IconRegistry } from "@triliumnext/commons";

import becca from "../becca/becca";
import type BAttachment from "../becca/entities/battachment";
import type BNote from "../becca/entities/bnote";
import boxiconsManifest from "./icon_pack_boxicons-v2.json" with { type: "json" };
import textEditorManifest from "./icon_pack_text_editor.json" with { type: "json" };
import { getLog } from "./log";
import search from "./search/services/search";
import {
    decodeCssEscapes, escapeCssString, isDev, safeExtractMessageAndStackFromError
} from "./utils/index";

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

/**
 * Character set a pack's prefix and each of its icon keys must match. Both are interpolated
 * into a CSS class selector, which takes letters, digits, `-`, `_` and any code point at or
 * above U+0080 unescaped. Anything else has to be rejected: a key holding `</style>` ends the
 * inline `<style>` element that `generateCss()` output is served in.
 */
const CSS_CLASS_NAME_PATTERN = /^[a-zA-Z0-9_\u0080-\uFFFF-]+$/;

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
    /**
     * Where the pack draws its glyphs, so that a browser centres them on the box they were drawn in
     * rather than on the one the font's platform metrics describe. Packs built before this was
     * measured carry none, and are left to the browser.
     */
    metrics?: IconFontMetrics;
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
    /**
     * Whether the pack exists for Trilium's own documentation. Its icons render everywhere, but
     * are offered for picking only in development, where the documentation is written.
     */
    internal?: boolean;
}

export function getIconPacks() {
    const builtinIconPacks: ProcessedIconPack[] = [
        {
            prefix: "bx",
            manifest: boxiconsManifest,
            manifestNoteId: "boxicons",
            fontMime: "font/woff2",
            fontAttachmentId: "boxicons",
            title: "Boxicons",
            icon: "bx bx-package",
            builtin: true
        },
        {
            // The icons of the text editor's toolbar, built by `apps/icon-pack-builder`.
            prefix: "cke",
            manifest: textEditorManifest,
            manifestNoteId: "text-editor-icons",
            fontMime: "font/woff2",
            fontAttachmentId: "text-editor-icons",
            title: "Text Editor Icons",
            icon: "cke cke-pilcrow",
            builtin: true,
            internal: true
        }
    ];

    // Custom packs are notes, which a search cannot find before becca is loaded (e.g. during setup).
    if (!becca.loaded) {
        return builtinIconPacks;
    }

    const usedPrefixes = new Set<string>(builtinIconPacks.map((iconPack) => iconPack.prefix));
    const customIconPacks = search.searchNotes("#iconPack")
        .filter(note => !note.isProtected)
        .map(iconPackNote => processIconPack(iconPackNote))
        .filter(iconPack => {
            if (!iconPack) return false;

            if (usedPrefixes.has(iconPack.prefix)) {
                getLog().info(`Skipping icon pack with duplicate prefix '${iconPack.prefix}': ${iconPack.title} (${iconPack.manifestNoteId})`);
                return false;
            }
            usedPrefixes.add(iconPack.prefix);
            return true;
        }) as ProcessedIconPack[];

    return [
        ...builtinIconPacks,
        ...customIconPacks
    ];
}

export function generateIconRegistry(iconPacks: ProcessedIconPack[]): IconRegistry {
    const sources: IconRegistry["sources"] = [];

    for (const { manifest, title, icon, prefix, internal } of iconPacks) {
        if (internal && !isDev()) continue;

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
        getLog().error(`Icon pack is missing JSON manifest (or has syntax errors): ${iconPackNote.title} (${iconPackNote.noteId})`);
        return;
    }

    const attachment = determineBestFontAttachment(iconPackNote);
    if (!attachment || !attachment.attachmentId) {
        getLog().error(`Icon pack is missing WOFF/WOFF2/TTF attachment: ${iconPackNote.title} (${iconPackNote.noteId})`);
        return;
    }

    const prefix = iconPackNote.getLabelValue("iconPack");
    if (!prefix) {
        getLog().error(`Icon pack is missing 'iconPack' label defining its prefix: ${iconPackNote.title} (${iconPackNote.noteId})`);
        return;
    }

    if (!CSS_CLASS_NAME_PATTERN.test(prefix)) {
        getLog().error(`Icon pack has invalid 'iconPack' prefix (only letters, digits, dashes, underscores and non-ASCII characters are allowed): ${iconPackNote.title} (${iconPackNote.noteId})`);
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

/**
 * The transforms an icon can carry in a note's content, written by the text editor's icon toolbar
 * as a class. Boxicons names them, but the rules are not scoped to a pack, so they apply to any
 * icon — the application's own `bx bx-sidebar bx-flip-horizontal` is one.
 */
const ICON_TRANSFORM_RULES: Record<string, string> = {
    "bx-rotate-90": "rotate(90deg)",
    "bx-rotate-180": "rotate(180deg)",
    "bx-rotate-270": "rotate(270deg)",
    "bx-flip-horizontal": "scaleX(-1)",
    "bx-flip-vertical": "scaleY(-1)"
};

/**
 * Generates the CSS for {@link ICON_TRANSFORM_RULES}. `boxicons-compat.css` carries these rules in
 * the application, which a shared or exported page does not load: there they come from here, beside
 * the icon packs' own CSS.
 */
export function generateIconTransformCss(): string {
    return Object.entries(ICON_TRANSFORM_RULES)
        .map(([ className, transform ]) => `.${className} { transform: ${transform}; }`)
        .join("\n");
}

export function generateCss({ manifest, fontMime, builtin, fontAttachmentId, prefix }: ProcessedIconPack, fontUrl: string) {
    try {
        const iconDeclarations: string[] = [];
        for (const [ key, mapping ] of Object.entries(manifest.icons)) {
            if (!CSS_CLASS_NAME_PATTERN.test(key)) {
                getLog().error(`Skipping icon '${key}' of icon pack '${prefix}': keys allow only letters, digits, dashes, underscores and non-ASCII characters.`);
                continue;
            }

            const glyph = escapeCssString(decodeCssEscapes(String(mapping.glyph ?? "")));
            iconDeclarations.push(`.${prefix}.${key}::before { content: "${glyph}"; }`);
        }

        const fontFamily = builtin ? fontAttachmentId : `trilium-icon-pack-${prefix}`;
        const fontFace = [
            `font-family: '${fontFamily}';`,
            "font-weight: normal;",
            "font-style: normal;",
            `src: url('${fontUrl}') format('${MIME_TO_CSS_FORMAT_MAPPINGS[fontMime]}');`,
            ...iconFontFaceOverrides(manifest.metrics)
        ].join("\n                ");

        return `\
            @font-face {
                ${fontFace}
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
        getLog().error(safeExtractMessageAndStackFromError(e));
        return null;
    }
}
