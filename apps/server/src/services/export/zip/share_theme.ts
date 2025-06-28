import { join } from "path";
import NoteMeta, { NoteMetaFile } from "../../meta/note_meta";
import { ExportFormat, ZipExportProvider } from "./abstract_provider.js";
import { RESOURCE_DIR } from "../../resource_dir";
import { getResourceDir, isDev } from "../../utils";
import fs from "fs";
import { renderNoteForExport } from "../../../share/content_renderer";
import type BNote from "../../../becca/entities/bnote.js";
import type BBranch from "../../../becca/entities/bbranch.js";

export default class ShareThemeExportProvider extends ZipExportProvider {

    private assetsMeta: NoteMeta[] = [];
    private indexMeta: NoteMeta | null = null;

    prepareMeta(metaFile: NoteMetaFile): void {
        const assets = [
            "style.css",
            "script.js",
            "boxicons.css",
            "boxicons.eot",
            "boxicons.woff2",
            "boxicons.woff",
            "boxicons.ttf",
            "boxicons.svg",
            "icon-color.svg"
        ];

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

        if (note) {
            content = renderNoteForExport(note, branch, basePath, noteMeta.notePath.slice(0, -1));
            if (typeof content === "string") {
                content = content.replace(/href="[^"]*\.\/([a-zA-Z0-9_\/]{12})[^"]*"/g, "href=\"#root/$1\"");
                content = this.rewriteFn(content, noteMeta);
            }
        }

        return content;
    }

    afterDone(rootMeta: NoteMeta): void {
        this.#saveAssets(rootMeta, this.assetsMeta);
        this.#saveIndex(rootMeta);
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

}

function getShareThemeAssets(nameWithExtension: string) {
    // Rename share.css to style.css.
    if (nameWithExtension === "style.css") {
        nameWithExtension = "share.css";
    } else if (nameWithExtension === "script.js") {
        nameWithExtension = "share.js";
    }

    let path: string | undefined;
    if (nameWithExtension === "icon-color.svg") {
        path = join(RESOURCE_DIR, "images", nameWithExtension);
    } else if (isDev) {
        path = join(getResourceDir(), "..", "..", "client", "dist", "src", nameWithExtension);
    } else {
        path = join(getResourceDir(), "public", "src", nameWithExtension);
    }

    return fs.readFileSync(path);
}
