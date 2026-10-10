import {
    getContentRendererGroup, getNoteContentType, getShareThemeGroupFiles, type ShareThemeManifest
} from "@triliumnext/commons";
import ejs from "ejs";
import { convert as convertToText } from "html-to-text";
import { t } from "i18next";

import becca from "../../../becca/becca.js";
import type BBranch from "../../../becca/entities/bbranch.js";
import type BNote from "../../../becca/entities/bnote.js";
import type { ExportFormat, NoteMeta, NoteMetaFile } from "../../../meta.js";
import { readShareTemplate, renderNoteForExport } from "../../../share/index.js";
import * as iconPackService from "../../icon_packs.js";
import { getLog } from "../../log.js";
import options from "../../options.js";
import { ZipExportProvider, type ZipExportProviderData } from "./abstract_provider.js";
import { buildShareData, getViewTypeOf, isHostedNote } from "./share_data.js";

/** The static files a share-theme export copies into the archive, read by each platform its own way. */
export interface ShareThemeExportAssets {
    /**
     * The share theme's files, keyed by their path in the archive: `icon-color.svg`, and
     * `assets/<file>` for each of {@link getShareThemeExportFiles}.
     */
    files: Map<string, string | Uint8Array>;
    /** Returns the font of a built-in icon pack, such as `boxicons.woff2`. */
    readBuiltinFont(fileName: string): Uint8Array | undefined;
}

interface SearchIndexEntry {
    id: string | null;
    title: string;
    content: string;
    path: string;
}

export default class ShareThemeExportProvider extends ZipExportProvider {

    private indexMeta: NoteMeta | null = null;
    private searchIndex: Map<string, SearchIndexEntry> = new Map();
    private rootMeta: NoteMeta | null = null;
    private iconPacks: iconPackService.ProcessedIconPack[] = [];
    private assets: ShareThemeExportAssets;

    constructor(data: ZipExportProviderData, assets: ShareThemeExportAssets) {
        super(data);
        this.assets = assets;
    }

    prepareMeta(metaFile: NoteMetaFile): void {
        for (const asset of this.assets.files.keys()) {
            metaFile.files.push({
                noImport: true,
                dataFileName: asset
            });
        }

        this.indexMeta = {
            noImport: true,
            dataFileName: "index.html"
        };
        this.rootMeta = metaFile.files[0];
        this.iconPacks = iconPackService.getIconPacks();

        metaFile.files.push(this.indexMeta);
    }

    prepareContent(title: string, content: string | Uint8Array, noteMeta: NoteMeta, note: BNote | undefined, branch: BBranch): string | Uint8Array {
        if (!noteMeta?.notePath?.length) {
            throw new Error("Missing note path.");
        }
        const basePath = "../".repeat(Math.max(0, noteMeta.notePath.length - 2));
        let searchContent = "";

        if (note) {
            // Prepare search index.
            searchContent = typeof content === "string" ? convertToText(content, {
                whitespaceCharacters: "\t\r\n\f​  "
            }) : "";

            // TODO: This will probably never match, but should it be exclude from running on code/jsFrontend notes?
            const getLink = (noteId: string) => (noteId === this.rootMeta?.noteId
                ? basePath || "./"
                : this.getNoteTargetUrl(noteId, noteMeta));
            const ancestors = noteMeta.notePath.slice(0, -1);
            content = renderNoteForExport(note, branch, basePath, ancestors, this.iconPacks,
                getLink);
            if (typeof content === "string") {
                // Rewrite attachment download links
                content = content.replace(/href="api\/attachments\/([a-zA-Z0-9_]+)\/download"/g, (match, attachmentId) => {
                    const attachmentMeta = (noteMeta.attachments || []).find((attMeta) => attMeta.attachmentId === attachmentId);
                    if (attachmentMeta?.dataFileName) {
                        return `href="${attachmentMeta.dataFileName}"`;
                    }
                    return match;
                });

                // Rewrite note links
                content = content.replace(/href="[^"]*\.\/([a-zA-Z0-9_\/]{12})[^"]*"/g, (match, id) => {
                    if (match.includes("/assets/")) return match;
                    if (id === this.rootMeta?.noteId) {
                        return `href="${basePath}"`;
                    }
                    return `href="#root/${id}"`;
                });
                content = this.rewriteFn(content, noteMeta);
            }

            // Prepare search index.
            this.searchIndex.set(note.noteId, {
                id: note.noteId,
                title,
                content: searchContent,
                path: note.getBestNotePath()
                    .map(noteId => noteId !== "root" && becca.getNote(noteId)?.title)
                    .filter(noteId => noteId)
                    .join(" / ")
            });
        }

        return content;
    }

    afterDone(rootMeta: NoteMeta): void {
        this.#saveAssets();
        this.#saveIndex(rootMeta);
        this.#save404();
        this.#saveData(rootMeta);

        // Search index
        for (const item of this.searchIndex.values()) {
            if (!item.id) continue;
            item.id = this.getNoteTargetUrl(item.id, rootMeta);
        }

        this.archive.append(JSON.stringify(Array.from(this.searchIndex.values()), null, 4), { name: "search-index.json" });
    }

    mapExtension(type: string | null, mime: string, existingExtension: string, format: ExportFormat): string | null {
        if (mime.startsWith("application/javascript")) {
            return "js";
        }

        // An attachment keeps its file; an image or file note becomes a page, with its file
        // written beside it.
        if (type === null && (mime.startsWith("image/") || existingExtension === ".zip")) {
            return null;
        }

        return "html";
    }

    #saveIndex(rootMeta: NoteMeta) {
        if (!this.indexMeta?.dataFileName) {
            return;
        }

        const note = this.branch.getNote();
        const content = this.prepareContent(rootMeta.title ?? "", note.getContent(), rootMeta, note, this.branch);
        this.archive.append(content, { name: this.indexMeta.dataFileName });
    }

    #saveAssets() {
        for (const [ name, content ] of this.assets.files) {
            this.archive.append(content, { name });
        }

        // Inject the custom fonts.
        for (const iconPack of this.iconPacks) {
            const extension = iconPackService.MIME_TO_EXTENSION_MAPPINGS[iconPack.fontMime];
            const fontData = iconPack.builtin
                ? this.assets.readBuiltinFont(`${iconPack.fontAttachmentId}.${extension}`)
                : becca.getAttachment(iconPack.fontAttachmentId)?.getContent();

            if (!fontData) {
                getLog().error(`Failed to find font data for icon pack ${iconPack.prefix} with attachment ID ${iconPack.fontAttachmentId}`);
                continue;
            }
            this.archive.append(fontData, {
                name: `assets/icon-pack-${iconPack.prefix.toLowerCase()}.${extension}`
            });
        }
    }

    #saveData(rootMeta: NoteMeta) {
        const attachmentPaths = new Map<string, string>();
        const collect = (noteMeta: NoteMeta) => {
            const notePath = noteMeta.isClone || !noteMeta.noteId
                ? null : this.getNoteTargetUrl(noteMeta.noteId, rootMeta);
            const directory = notePath?.slice(0, notePath.lastIndexOf("/") + 1);
            for (const attachment of notePath === null ? [] : noteMeta.attachments ?? []) {
                if (attachment.attachmentId) {
                    attachmentPaths.set(attachment.attachmentId,
                        `${directory}${encodeURIComponent(attachment.dataFileName)}`);
                }
            }
            for (const child of noteMeta.children ?? []) {
                collect(child);
            }
        };
        collect(rootMeta);

        const data = buildShareData(this.branch.getNote(), {
            getNotePath: (noteId) => (noteId === rootMeta.noteId
                ? "" : this.getNoteTargetUrl(noteId, rootMeta)),
            getAttachmentPath: (attachmentId) => attachmentPaths.get(attachmentId) ?? null
        });
        for (const [ name, content ] of data) {
            this.archive.append(content, { name });
        }
    }

    #save404() {
        const content = ejs.render(readShareTemplate("404"), { t });
        this.archive.append(content, { name: "404.html" });
    }

}

/**
 * Returns the files of `manifest` the export of `note` copies into `assets/`: those every page can
 * load, those of the app views the pages host, by {@link getAppViewGroups}, and mermaid's only
 * when {@link hasMermaidDiagrams} finds a diagram.
 */
export function getShareThemeExportFiles(manifest: ShareThemeManifest, note: BNote) {
    const groups = [ ...getAppViewGroups(note) ];
    if (hasMermaidDiagrams(note)) {
        groups.push("mermaid");
    }
    return [ ...manifest.files, ...getShareThemeGroupFiles(manifest, groups) ];
}

/**
 * Returns the app's catalogues the app views of the export of `note` read, relative to the app's
 * `translations/`: those of the display language and of English, which they fall back to. The
 * export copies them into `assets/translations/`; a locale without one of them leaves it out.
 */
export function getShareThemeTranslationFiles(note: BNote) {
    if (!getAppViewGroups(note).size) {
        return [];
    }

    const locales = new Set([ "en", options.getOptionOrNull("locale") || "en" ]);
    return [ ...locales ].flatMap((locale) =>
        [ `${locale}/translation.json`, `${locale}/entry.json` ]);
}

/**
 * Returns the groups of the share theme's manifest the pages of the export of `note` load to host
 * app views: `view:<viewType>` for each collection and `type:<noteType>` for each note type with
 * one, `content:<group>` for the renderer of each note a dashboard or a presentation draws, as
 * `CONTENT_RENDERER_GROUPS` names it, and `view:` for a collection among them, `app` beside any
 * of them and `scripting` for a render note.
 */
export function getAppViewGroups(note: BNote) {
    const groups = new Set<string>();
    for (const subtreeNote of note.getSubtree().notes) {
        if (subtreeNote.isProtected) {
            continue;
        }

        if (!isHostedNote(subtreeNote)) {
            continue;
        }

        const viewType = getViewTypeOf(subtreeNote);
        if (viewType) {
            groups.add(`view:${viewType}`);
            if (CONTENT_VIEW_TYPES.includes(viewType)) {
                for (const drawn of getDrawnNotes(subtreeNote)) {
                    const contentGroup = getContentRendererGroup(getNoteContentType(drawn.type,
                        drawn.mime, drawn.hasLabel("iconPack") || drawn.hasLabel("disabled:iconPack")));
                    if (contentGroup) {
                        groups.add(`content:${contentGroup}`);
                    }
                    const drawnViewType = getViewTypeOf(drawn);
                    if (drawnViewType) {
                        groups.add(`view:${drawnViewType}`);
                    }
                }
            }
        } else {
            groups.add(`type:${subtreeNote.type}`);
        }
    }

    if (groups.size) {
        groups.add("app");
    }
    if (groups.has("type:render") || groups.has("content:render")) {
        groups.add("scripting");
    }
    return groups;
}

/** The view types of the collections that draw the content of their notes. */
const CONTENT_VIEW_TYPES = [ "dashboard", "presentation" ];

/** The notes a dashboard or a presentation draws: its children and, as vertical slides, theirs. */
function getDrawnNotes(collection: BNote) {
    return collection.getChildNotes().flatMap((child) => [ child, ...child.getChildNotes() ]);
}

/**
 * Whether `note` or a note below it has a diagram the shared page draws with mermaid: a Mermaid
 * note, a text note's `language-mermaid` block or a Markdown note's fenced one. Only then does the
 * export carry the files of mermaid and of the viewer a Mermaid note's diagram goes into, several
 * megabytes the pages load on demand.
 */
export function hasMermaidDiagrams(note: BNote) {
    return note.getSubtree().notes.some((subtreeNote) => {
        if (!subtreeNote.isContentAvailable()) {
            return false;
        }

        if (subtreeNote.type === "mermaid") {
            return true;
        }

        if (subtreeNote.type === "text") {
            return String(subtreeNote.getContent()).includes("language-mermaid");
        }

        return subtreeNote.type === "code" && subtreeNote.mime === "text/x-markdown"
            && MARKDOWN_MERMAID_FENCE.test(String(subtreeNote.getContent()));
    });
}

const MARKDOWN_MERMAID_FENCE = /^ {0,3}(`{3,}|~{3,})\s*mermaid\b/m;
