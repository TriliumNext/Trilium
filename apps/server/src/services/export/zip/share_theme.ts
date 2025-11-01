import { join } from "path";
import NoteMeta, { NoteMetaFile } from "../../meta/note_meta";
import { ExportFormat, ZipExportProvider } from "./abstract_provider.js";
import { RESOURCE_DIR } from "../../resource_dir";
import { getResourceDir, isDev } from "../../utils";
import fs, { readdirSync } from "fs";
import { getDefaultTemplatePath, readTemplate, renderNoteForExport } from "../../../share/content_renderer";
import type BNote from "../../../becca/entities/bnote.js";
import type BBranch from "../../../becca/entities/bbranch.js";
import { getShareThemeAssetDir } from "../../../routes/assets";
import { convert as convertToText } from "html-to-text";
import becca from "../../../becca/becca";
import ejs from "ejs";
import { t } from "i18next";

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

        metaFile.files.push(this.indexMeta);
    }

    prepareContent(title: string, content: string | Buffer, noteMeta: NoteMeta, note: BNote | undefined, branch: BBranch): string | Buffer {
        if (!noteMeta?.notePath?.length) {
            throw new Error("Missing note path.");
        }
        const basePath = "../".repeat(noteMeta.notePath.length - 1);
        let searchContent = "";

        if (note) {
            // Prepare search index.
            searchContent = typeof content === "string" ? convertToText(content, {
                whitespaceCharacters: "\t\r\n\f\u200b\u00a0\u2002"
            }) : "";

            content = renderNoteForExport(note, branch, basePath, noteMeta.notePath.slice(0, -1));
            if (typeof content === "string") {
                content = content.replace(/href="[^"]*\.\/([a-zA-Z0-9_\/]{12})[^"]*"/g, (match, id) => {
                    if (match.includes("/assets/")) return match;
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

            let cssContent = getShareThemeAssets(assetMeta.dataFileName);
            this.archive.append(cssContent, { name: assetMeta.dataFileName });
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
