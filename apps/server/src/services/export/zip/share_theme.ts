import ejs from "ejs";
import fs, { readdirSync, readFileSync } from "fs";
import { convert as convertToText } from "html-to-text";
import { t } from "i18next";
import { join } from "path";

import becca from "../../../becca/becca";
import type BBranch from "../../../becca/entities/bbranch.js";
import type BNote from "../../../becca/entities/bnote.js";
import { getClientDir, getShareThemeAssetDir } from "../../../routes/assets";
import { getDefaultTemplatePath, readTemplate, renderNoteForExport } from "../../../share/content_renderer";
import { getIconPacks, MIME_TO_EXTENSION_MAPPINGS, ProcessedIconPack } from "../../icon_packs";
import log from "../../log";
import NoteMeta, { NoteMetaFile } from "../../meta/note_meta";
import { RESOURCE_DIR } from "../../resource_dir";
import { getResourceDir, isDev } from "../../utils";
import { ExportFormat, ZipExportProvider } from "./abstract_provider.js";

const shareThemeAssetDir = getShareThemeAssetDir();

interface SearchIndexEntry {
    id: string | null;
    title: string;
    content: string;
    path: string;
}

export default class ShareThemeExportProvider extends ZipExportProvider {

    private assetsMeta: NoteMeta[] = [];
    private indexMeta: NoteMeta | null = null;
    private searchIndex: Map<string, SearchIndexEntry> = new Map();
    private rootMeta: NoteMeta | null = null;
    private iconPacks: ProcessedIconPack[] = [];

    prepareMeta(metaFile: NoteMetaFile): void {
        const assets = [
            "icon-color.svg"
        ];

        for (const file of readdirSync(shareThemeAssetDir)) {
            assets.push(`assets/${file}`);
        }

        for (const asset of assets) {
            const assetMeta = {
                noImport: true,
                dataFileName: asset
            };
            this.assetsMeta.push(assetMeta);
            metaFile.files.push(assetMeta);
        }

        this.indexMeta = {
            noImport: true,
            dataFileName: "index.html"
        };
        this.rootMeta = metaFile.files[0];
        this.iconPacks = getIconPacks();

        metaFile.files.push(this.indexMeta);
    }

    prepareContent(title: string, content: string | Buffer, noteMeta: NoteMeta, note: BNote | undefined, branch: BBranch): string | Buffer {
        if (!noteMeta?.notePath?.length) {
            throw new Error("Missing note path.");
        }
        const basePath = "../".repeat(Math.max(0, noteMeta.notePath.length - 2));
        let searchContent = "";

        if (note) {
            // Prepare search index.
            searchContent = typeof content === "string" ? convertToText(content, {
                whitespaceCharacters: "\t\r\n\f\u200b\u00a0\u2002"
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
        this.#saveAssets(rootMeta, this.assetsMeta);
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
        const fullHtml = this.prepareContent(rootMeta.title ?? "", note.getContent(), rootMeta, note, this.branch);
        this.archive.append(fullHtml, { name: this.indexMeta.dataFileName });
    }

    #saveAssets(rootMeta: NoteMeta, assetsMeta: NoteMeta[]) {
        for (const assetMeta of assetsMeta) {
            if (!assetMeta.dataFileName) {
                continue;
            }

            const cssContent = getShareThemeAssets(assetMeta.dataFileName);
            this.archive.append(cssContent, { name: assetMeta.dataFileName });
        }

        // Inject the custom fonts.
        for (const iconPack of this.iconPacks) {
            const extension = MIME_TO_EXTENSION_MAPPINGS[iconPack.fontMime];
            let fontData: Buffer | undefined;
            if (iconPack.builtin) {
                fontData = readFileSync(join(getClientDir(), "fonts", `${iconPack.fontAttachmentId}.${extension}`));
            } else {
                fontData = becca.getAttachment(iconPack.fontAttachmentId)?.getContent();
            }

            if (!fontData) {
                log.error(`Failed to find font data for icon pack ${iconPack.prefix} with attachment ID ${iconPack.fontAttachmentId}`);
                continue;
            };
            const fontFileName = `assets/icon-pack-${iconPack.prefix.toLowerCase()}.${extension}`;
            this.archive.append(fontData, { name: fontFileName });
        }
    }

    #save404() {
        const templatePath = getDefaultTemplatePath("404");
        const content = ejs.render(readTemplate(templatePath), { t });
        this.archive.append(content, { name: "404.html" });
    }

}

function getShareThemeAssets(nameWithExtension: string) {
    let path: string | undefined;
    if (nameWithExtension === "icon-color.svg") {
        path = join(RESOURCE_DIR, "images", nameWithExtension);
    } else if (nameWithExtension.startsWith("assets")) {
        path = join(shareThemeAssetDir, nameWithExtension.replace(/^assets\//, ""));
    } else if (isDev) {
        path = join(getResourceDir(), "..", "..", "client", "dist", "src", nameWithExtension);
    } else {
        path = join(getResourceDir(), "public", "src", nameWithExtension);
    }

    return fs.readFileSync(path);
}
