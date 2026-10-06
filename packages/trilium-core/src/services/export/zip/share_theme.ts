import type { ShareMermaidManifest } from "@triliumnext/commons";
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
import { basename } from "../../utils/path.js";
import { ZipExportProvider, type ZipExportProviderData } from "./abstract_provider.js";

/** The static files a share-theme export copies into the archive, read by each platform its own way. */
export interface ShareThemeExportAssets {
    /**
     * The share theme's files, keyed by their path in the archive: `icon-color.svg`,
     * `assets/<file>`, and the client's mermaid under `assets/client/` when
     * {@link hasMermaidDiagrams} finds a diagram.
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
            content = renderNoteForExport(note, branch, basePath, noteMeta.notePath.slice(0, -1), this.iconPacks);
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

        // Search index
        for (const item of this.searchIndex.values()) {
            if (!item.id) continue;
            item.id = this.getNoteTargetUrl(item.id, rootMeta);
        }

        this.archive.append(JSON.stringify(Array.from(this.searchIndex.values()), null, 4), { name: "search-index.json" });
    }

    mapExtension(type: string | null, mime: string, existingExtension: string, format: ExportFormat): string | null {
        if (mime.startsWith("image/")) {
            return null;
        }

        if (mime.startsWith("application/javascript")) {
            return "js";
        }

        // Don't add .html if the file already has .zip extension (for attachments).
        if (existingExtension === ".zip") {
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

    #save404() {
        const content = ejs.render(readShareTemplate("404"), { t });
        this.archive.append(content, { name: "404.html" });
    }

}

/** Where the exported pages find the client's mermaid: `client/` next to `assets/scripts.js`. */
const MERMAID_ARCHIVE_DIR = "assets/client";

/**
 * Whether `note` or a note below it has a mermaid code block the shared page renders: a text note's
 * `language-mermaid` block or a Markdown note's fenced one. Only then does the export carry the
 * client's mermaid, several megabytes the pages load on demand.
 */
export function hasMermaidDiagrams(note: BNote) {
    return note.getSubtree().notes.some((subtreeNote) => {
        if (!subtreeNote.isContentAvailable()) {
            return false;
        }

        if (subtreeNote.type === "text") {
            return String(subtreeNote.getContent()).includes("language-mermaid");
        }

        return subtreeNote.type === "code" && subtreeNote.mime === "text/x-markdown"
            && MARKDOWN_MERMAID_FENCE.test(String(subtreeNote.getContent()));
    });
}

const MARKDOWN_MERMAID_FENCE = /^ {0,3}(`{3,}|~{3,})\s*mermaid\b/m;

/**
 * Maps the files `manifest` lists to their place in the archive, flattened into `assets/client/`,
 * and returns the manifest the exported pages read there. Returns `undefined` when the manifest
 * does not list its own entry: a development server's points at a source module and lists no files.
 */
export function mapMermaidExportFiles(manifest: ShareMermaidManifest) {
    if (!manifest.files.includes(manifest.entry)) {
        return undefined;
    }

    return {
        manifest: {
            path: `${MERMAID_ARCHIVE_DIR}/share_mermaid.json`,
            content: JSON.stringify({
                entry: basename(manifest.entry),
                files: manifest.files.map(basename)
            })
        },
        files: manifest.files.map((source) => ({
            source,
            target: `${MERMAID_ARCHIVE_DIR}/${basename(source)}`
        }))
    };
}
