import fs from "fs";
import html from "html";
import path from "path";

import type NoteMeta from "../../meta/note_meta.js";
import { escapeHtml, getResourceDir, isDev } from "../../utils";
import { ZipExportProvider } from "./abstract_provider.js";

export default class HtmlExportProvider extends ZipExportProvider {

    private navigationMeta: NoteMeta | null = null;
    private indexMeta: NoteMeta | null = null;
    private cssMeta: NoteMeta | null = null;

    prepareMeta(metaFile) {
        if (this.zipExportOptions?.skipExtraFiles) return;

        this.navigationMeta = {
            noImport: true,
            dataFileName: "navigation.html"
        };
        metaFile.files.push(this.navigationMeta);

        this.indexMeta = {
            noImport: true,
            dataFileName: "index.html"
        };
        metaFile.files.push(this.indexMeta);

        this.cssMeta = {
            noImport: true,
            dataFileName: "style.css"
        };
        metaFile.files.push(this.cssMeta);
    }

    prepareContent(title: string, content: string | Buffer, noteMeta: NoteMeta): string | Buffer {
        if (noteMeta.format === "html" && typeof content === "string") {
            if (!content.substr(0, 100).toLowerCase().includes("<html") && !this.zipExportOptions?.skipHtmlTemplate) {
                if (!noteMeta?.notePath?.length) {
                    throw new Error("Missing note path.");
                }

                const cssUrl = `${"../".repeat(noteMeta.notePath.length - 1)}style.css`;
                const htmlTitle = escapeHtml(title);

                // <base> element will make sure external links are openable - https://github.com/zadam/trilium/issues/1289#issuecomment-704066809
                content = `<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="${cssUrl}">
    <base target="_parent">
    <title data-trilium-title>${htmlTitle}</title>
</head>
<body>
    <div class="content">
    <h1 data-trilium-h1>${htmlTitle}</h1>

    <div class="ck-content">${content}</div>
    </div>
</body>
</html>`;
            }

            if (content.length < 100_000) {
                content = html.prettyPrint(content, { indent_size: 2 });
            }
            content = this.rewriteFn(content as string, noteMeta);
            return content;
        }
        return content;

    }

    afterDone(rootMeta: NoteMeta) {
        if (this.zipExportOptions?.skipExtraFiles) return;

        if (!this.navigationMeta || !this.indexMeta || !this.cssMeta) {
            throw new Error("Missing meta.");
        }

        this.#saveNavigation(rootMeta, this.navigationMeta);
        this.#saveIndex(rootMeta, this.indexMeta);
        this.#saveCss(rootMeta, this.cssMeta);
    }

    #saveNavigationInner(rootMeta: NoteMeta, meta: NoteMeta) {
        let html = "<li>";

        const escapedTitle = escapeHtml(`${meta.prefix ? `${meta.prefix} - ` : ""}${meta.title}`);

        if (meta.dataFileName && meta.noteId) {
            const targetUrl = this.getNoteTargetUrl(meta.noteId, rootMeta);

            html += `<a href="${targetUrl}" target="detail">${escapedTitle}</a>`;
        } else {
            html += escapedTitle;
        }

        if (meta.children && meta.children.length > 0) {
            html += "<ul>";

            for (const child of meta.children) {
                html += this.#saveNavigationInner(rootMeta, child);
            }

            html += "</ul>";
        }

        return `${html}</li>`;
    }

    #saveNavigation(rootMeta: NoteMeta, navigationMeta: NoteMeta) {
        if (!navigationMeta.dataFileName) {
            return;
        }

        const fullHtml = `<html>
    <head>
        <meta charset="utf-8">
        <link rel="stylesheet" href="style.css">
    </head>
    <body>
        <ul>${this.#saveNavigationInner(rootMeta, rootMeta)}</ul>
    </body>
    </html>`;
        const prettyHtml = fullHtml.length < 100_000 ? html.prettyPrint(fullHtml, { indent_size: 2 }) : fullHtml;

        this.archive.append(prettyHtml, { name: navigationMeta.dataFileName });
    }

    #saveIndex(rootMeta: NoteMeta, indexMeta: NoteMeta) {
        let firstNonEmptyNote;
        let curMeta = rootMeta;

        if (!indexMeta.dataFileName) {
            return;
        }

        while (!firstNonEmptyNote) {
            if (curMeta.dataFileName && curMeta.noteId) {
                firstNonEmptyNote = this.getNoteTargetUrl(curMeta.noteId, rootMeta);
            }

            if (curMeta.children && curMeta.children.length > 0) {
                curMeta = curMeta.children[0];
            } else {
                break;
            }
        }

        const fullHtml = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<frameset cols="25%,75%">
    <frame name="navigation" src="navigation.html">
    <frame name="detail" src="${firstNonEmptyNote}">
</frameset>
</html>`;

        this.archive.append(fullHtml, { name: indexMeta.dataFileName });
    }

    #saveCss(rootMeta: NoteMeta, cssMeta: NoteMeta) {
        if (!cssMeta.dataFileName) {
            return;
        }

        const cssFile = isDev
            ? path.join(__dirname, "../../../../../../node_modules/ckeditor5/dist/ckeditor5-content.css")
            : path.join(getResourceDir(), "ckeditor5-content.css");
        const cssContent = fs.readFileSync(cssFile, "utf-8");
        this.archive.append(cssContent, { name: cssMeta.dataFileName });
    }

}

