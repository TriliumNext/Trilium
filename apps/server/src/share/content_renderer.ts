import { sanitizeUrl } from "@braintree/sanitize-url";
import { highlightAuto } from "@triliumnext/highlightjs";
import ejs from "ejs";
import escapeHtml from "escape-html";
import { readFileSync } from "fs";
import { t } from "i18next";
import { HTMLElement, Options,parse, TextNode } from "node-html-parser";
import { join } from "path";

import becca from "../becca/becca.js";
import BAttachment from '../becca/entities/battachment.js';
import type BBranch from "../becca/entities/bbranch.js";
import BNote from "../becca/entities/bnote.js";
import assetPath, { assetUrlFragment } from "../services/asset_path.js";
import { generateCss, getIconPacks, MIME_TO_EXTENSION_MAPPINGS, ProcessedIconPack } from "../services/icon_packs.js";
import log from "../services/log.js";
import options from "../services/options.js";
import utils, { getResourceDir, isDev, safeExtractMessageAndStackFromError } from "../services/utils.js";
import SAttachment from "./shaca/entities/sattachment.js";
import SBranch from "./shaca/entities/sbranch.js";
import type SNote from "./shaca/entities/snote.js";
import shaca from "./shaca/shaca.js";
import shareRoot from "./share_root.js";

const shareAdjustedAssetPath = isDev ? assetPath : `../${assetPath}`;
const templateCache: Map<string, string> = new Map();

/**
 * Represents the output of the content renderer.
 */
export interface Result {
    header: string;
    content: string | Buffer | undefined;
    /** Set to `true` if the provided content should be rendered as empty. */
    isEmpty?: boolean;
}

interface Subroot {
    note?: SNote | BNote;
    branch?: SBranch | BBranch
}

type GetNoteFunction = (id: string) => SNote | BNote | null;

function getSharedSubTreeRoot(note: SNote | BNote | undefined): Subroot {
    if (!note || note.noteId === shareRoot.SHARE_ROOT_NOTE_ID) {
        // share root itself is not shared
        return {};
    }

    // every path leads to share root, but which one to choose?
    // for the sake of simplicity, URLs are not note paths
    const parentBranch = note.getParentBranches()[0];

    if (note instanceof BNote) {
        return {
            note,
            branch: parentBranch
        };
    }

    if (parentBranch.parentNoteId === shareRoot.SHARE_ROOT_NOTE_ID) {
        return {
            note,
            branch: parentBranch
        };
    }

    return getSharedSubTreeRoot(parentBranch.getParentNote());
}

export function renderNoteForExport(note: BNote, parentBranch: BBranch, basePath: string, ancestors: string[], iconPacks: ProcessedIconPack[]) {
    const subRoot: Subroot = {
        branch: parentBranch,
        note: parentBranch.getNote()
    };

    return renderNoteContentInternal(note, {
        subRoot,
        rootNoteId: parentBranch.noteId,
        cssToLoad: [
            `${basePath}assets/styles.css`,
            `${basePath}assets/scripts.css`,
        ],
        jsToLoad: [
            `${basePath}assets/scripts.js`
        ],
        logoUrl: `${basePath}icon-color.svg`,
        faviconUrl: `${basePath}favicon.ico`,
        ancestors,
        isStatic: true,
        iconPackCss: iconPacks.map(p => generateCss(p, `${basePath}assets/icon-pack-${p.prefix.toLowerCase()}.${MIME_TO_EXTENSION_MAPPINGS[p.fontMime]}`))
            .filter(Boolean)
            .join("\n\n"),
        iconPackSupportedPrefixes: iconPacks.map(p => p.prefix)
    });
}

export function renderNoteContent(note: SNote) {
    const subRoot = getSharedSubTreeRoot(note);

    const ancestors: string[] = [];
    let notePointer = note;
    while (notePointer.parents[0]?.noteId !== subRoot.note?.noteId) {
        const pointerParent = notePointer.parents[0];
        if (!pointerParent) {
            break;
        }
        ancestors.push(pointerParent.noteId);
        notePointer = pointerParent;
    }

    // Determine CSS to load.
    const cssToLoad: string[] = [];
    if (!note.isLabelTruthy("shareOmitDefaultCss")) {
        cssToLoad.push(`assets/styles.css`);
        cssToLoad.push(`assets/scripts.css`);
    }
    for (const cssRelation of note.getRelations("shareCss")) {
        cssToLoad.push(`api/notes/${cssRelation.value}/download`);
    }

    // Determine JS to load.
    const jsToLoad: string[] = [
        "assets/scripts.js"
    ];
    for (const jsRelation of note.getRelations("shareJs")) {
        jsToLoad.push(`api/notes/${jsRelation.value}/download`);
    }

    const customLogoId = note.getRelation("shareLogo")?.value;
    const logoUrl = customLogoId ? `api/images/${customLogoId}/image.png` : `../${assetUrlFragment}/images/icon-color.svg`;
    const iconPacks = getIconPacks().filter(p => p.builtin || !!shaca.notes[p.manifestNoteId]);

    return renderNoteContentInternal(note, {
        subRoot,
        rootNoteId: "_share",
        cssToLoad,
        jsToLoad,
        logoUrl,
        ancestors,
        isStatic: false,
        faviconUrl: note.hasRelation("shareFavicon") ? `api/notes/${note.getRelationValue("shareFavicon")}/download` : `../favicon.ico`,
        iconPackCss: iconPacks.map(p => generateCss(p, p.builtin
            ? `/share/assets/fonts/${p.fontAttachmentId}.${MIME_TO_EXTENSION_MAPPINGS[p.fontMime]}`
            : `/share/api/attachments/${p.fontAttachmentId}/download`
        ))
            .filter(Boolean)
            .join("\n\n"),
        iconPackSupportedPrefixes: iconPacks.map(p => p.prefix)
    });
}

interface RenderArgs {
    subRoot: Subroot;
    rootNoteId: string;
    cssToLoad: string[];
    jsToLoad: string[];
    logoUrl: string;
    ancestors: string[];
    isStatic: boolean;
    faviconUrl: string;
    iconPackCss: string;
    iconPackSupportedPrefixes: string[];
}

function renderNoteContentInternal(note: SNote | BNote, renderArgs: RenderArgs) {
    // When rendering static share, non-protected JavaScript notes should be rendered as-is.
    if (renderArgs.isStatic && note.mime.startsWith("application/javascript")) {
        if (note.isProtected) {
            return `console.log("Protected note cannot be exported.");`;
        }

        return note.getContent() ?? "";
    }

    const { header, content, isEmpty } = getContent(note);
    const showLoginInShareTheme = options.getOption("showLoginInShareTheme");
    const opts = {
        note,
        header,
        content,
        isEmpty,
        assetPath: shareAdjustedAssetPath,
        assetUrlFragment,
        showLoginInShareTheme,
        t,
        isDev,
        utils,
        ...renderArgs,
    };

    // Check if the user has their own template.
    if (note.hasRelation("shareTemplate")) {
        // Get the template note and content
        const templateId = note.getRelation("shareTemplate")?.value;
        const templateNote = templateId && shaca.getNote(templateId);

        // Make sure the note type is correct
        if (templateNote && templateNote.type === "code" && templateNote.mime === "application/x-ejs") {
            // EJS caches the result of this so we don't need to pre-cache
            const includer = (path: string) => {
                const childNote = templateNote.children.find((n) => path === n.title);
                if (!childNote) throw new Error(`Unable to find child note: ${path}.`);
                if (childNote.type !== "code" || childNote.mime !== "application/x-ejs") throw new Error("Incorrect child note type.");

                const template = childNote.getContent();
                if (typeof template !== "string") throw new Error("Invalid template content type.");

                return { template };
            };

            // Try to render user's template, w/ fallback to default view
            try {
                const content = templateNote.getContent();
                if (typeof content === "string") {
                    return ejs.render(content, opts, { includer });
                }
            } catch (e: unknown) {
                const [errMessage, errStack] = safeExtractMessageAndStackFromError(e);
                log.error(`Rendering user provided share template (${templateId}) threw exception ${errMessage} with stacktrace: ${errStack}`);
            }
        }
    }

    // Render with the default view otherwise.
    const templatePath = getDefaultTemplatePath("page");
    return ejs.render(readTemplate(templatePath), opts, {
        includer: (path) => {
            // Path is relative to apps/server/dist/assets/views
            return { template: readTemplate(getDefaultTemplatePath(path)) };
        }
    });
}

export function getDefaultTemplatePath(template: string) {
    // Path is relative to apps/server/dist/assets/views
    return process.env.NODE_ENV === "development"
        ? join(__dirname, `../../../../packages/share-theme/src/templates/${template}.ejs`)
        : join(getResourceDir(), `share-theme/templates/${template}.ejs`);
}

export function readTemplate(path: string) {
    const cachedTemplate = templateCache.get(path);
    if (cachedTemplate) {
        return cachedTemplate;
    }

    const templateString = readFileSync(path, "utf-8");
    templateCache.set(path, templateString);
    return templateString;
}

export function getContent(note: SNote | BNote) {
    if (note.isProtected) {
        return {
            header: "",
            content: "<p>Protected note cannot be displayed</p>",
            isEmpty: false
        };
    }

    const result: Result = {
        content: note.getContent(),
        header: "",
        isEmpty: false
    };

    if (note.type === "text") {
        renderText(result, note);
    } else if (note.type === "code") {
        renderCode(result);
    } else if (note.type === "mermaid") {
        renderMermaid(result, note);
    } else if (["image", "canvas", "mindMap"].includes(note.type)) {
        renderImage(result, note);
    } else if (note.type === "file") {
        renderFile(note, result);
    } else if (note.type === "book") {
        result.isEmpty = true;
    } else if (note.type === "webView") {
        renderWebView(note, result);
    } else {
        result.content = `<p>${t("content_renderer.note-cannot-be-displayed")}</p>`;
    }

    return result;
}

function renderIndex(result: Result) {
    result.content += '<ul id="index">';

    const rootNote = shaca.getNote(shareRoot.SHARE_ROOT_NOTE_ID);

    for (const childNote of rootNote.getChildNotes()) {
        const isExternalLink = childNote.hasLabel("shareExternalLink");
        const href = isExternalLink ? childNote.getLabelValue("shareExternalLink") : `./${childNote.shareId}`;
        const target = isExternalLink ? `target="_blank" rel="noopener noreferrer"` : "";
        result.content += `<li><a class="${childNote.type}" href="${href}" ${target}>${childNote.escapedTitle}</a></li>`;
    }

    result.content += "</ul>";
}

function renderText(result: Result, note: SNote | BNote) {
    if (typeof result.content !== "string") return;
    const parseOpts: Partial<Options> = {
        blockTextElements: {}
    };
    const document = parse(result.content || "", parseOpts);

    // Process include notes.
    for (const includeNoteEl of document.querySelectorAll("section.include-note")) {
        const noteId = includeNoteEl.getAttribute("data-note-id");
        if (!noteId) continue;

        const note = shaca.getNote(noteId);
        if (!note) continue;

        const includedResult = getContent(note);
        if (typeof includedResult.content !== "string") continue;

        const includedDocument = parse(includedResult.content, parseOpts).childNodes;
        if (includedDocument) {
            includeNoteEl.replaceWith(...includedDocument);
        }
    }

    result.isEmpty = document.textContent?.trim().length === 0 && document.querySelectorAll("img").length === 0;

    const getNote: GetNoteFunction = note instanceof BNote
        ? (noteId: string) => becca.getNote(noteId)
        : (noteId: string) => shaca.getNote(noteId);
    const getAttachment = note instanceof BNote
        ? (attachmentId: string) => becca.getAttachment(attachmentId)
        : (attachmentId: string) => shaca.getAttachment(attachmentId);

    if (!result.isEmpty) {
        // Process attachment links.
        for (const linkEl of document.querySelectorAll("a")) {
            const href = linkEl.getAttribute("href");

            // Preserve footnotes.
            if (href?.startsWith("#fn")) {
                continue;
            }

            if (href?.startsWith("#")) {
                handleAttachmentLink(linkEl, href, getNote, getAttachment);
            }

            if (linkEl.classList.contains("reference-link")) {
                cleanUpReferenceLinks(linkEl, getNote);
            }
        }

        // Apply syntax highlight.
        for (const codeEl of document.querySelectorAll("pre code")) {
            if (codeEl.classList.contains("language-mermaid") && note.type === "text") {
                // Mermaid is handled on client-side, we don't want to break it by adding syntax highlighting.
                continue;
            }

            const highlightResult = highlightAuto(codeEl.text);
            codeEl.innerHTML = highlightResult.value;
            codeEl.classList.add("hljs");
        }

        result.content = document.innerHTML ?? "";

        if (note.hasLabel("shareIndex")) {
            renderIndex(result);
        }
    }
}

function handleAttachmentLink(linkEl: HTMLElement, href: string, getNote: GetNoteFunction, getAttachment: (id: string) => BAttachment | SAttachment | null) {
    const linkRegExp = /attachmentId=([a-zA-Z0-9_]+)/g;
    let attachmentMatch;
    if ((attachmentMatch = linkRegExp.exec(href))) {
        const attachmentId = attachmentMatch[1];
        const attachment = getAttachment(attachmentId);

        if (attachment) {
            linkEl.setAttribute("href", `api/attachments/${attachmentId}/download`);
            linkEl.classList.add(`attachment-link`);
            linkEl.classList.add(`role-${attachment.role}`);
            linkEl.childNodes.length = 0;
            linkEl.appendChild(new TextNode(attachment.title));
        } else {
            linkEl.removeAttribute("href");
            log.error(`Broken attachment link detected in shared note: unable to find attachment with ID ${attachmentId}`);
        }
    } else {
        const [notePath] = href.split("?");
        const notePathSegments = notePath.split("/");
        const noteId = notePathSegments[notePathSegments.length - 1];
        const linkedNote = getNote(noteId);
        if (linkedNote) {
            const isExternalLink = linkedNote.hasLabel("shareExternalLink");
            const href = isExternalLink ? linkedNote.getLabelValue("shareExternalLink") : `./${linkedNote.shareId}`;
            if (href) {
                linkEl.setAttribute("href", href);
            }
            if (isExternalLink) {
                linkEl.setAttribute("target", "_blank");
                linkEl.setAttribute("rel", "noopener noreferrer");
            }
            linkEl.classList.add(`type-${linkedNote.type}`);
        } else {
            log.error(`Broken link detected in shared note: unable to find note with ID ${noteId}`);
            linkEl.removeAttribute("href");
        }
    }
}

/**
 * Processes reference links to ensure that they are up to date. More specifically, reference links contain in their HTML source code the note title at the time of the linking. It can be changed in the mean-time or the note can become protected, which leaks information.
 *
 * @param linkEl the <a> element to process.
 */
function cleanUpReferenceLinks(linkEl: HTMLElement, getNote: GetNoteFunction) {
    // Note: this method is basically a reimplementation of getReferenceLinkTitleSync from the link service of the client.
    const href = linkEl.getAttribute("href") ?? "";

    // Handle attachment reference links
    if (linkEl.classList.contains("attachment-link")) {
        const title = linkEl.innerText;
        linkEl.innerHTML = `<span><span class="tn-icon bx bx-download"></span>${utils.escapeHtml(title)}</span>`;
        return;
    }

    const noteId = href.split("/").at(-1);
    const note = noteId ? getNote(noteId) : undefined;
    if (!note) {
        // If a note is not found, simply replace it with a text.
        linkEl.replaceWith(new TextNode(linkEl.innerText));
    } else if (note.isProtected) {
        linkEl.innerHTML = "[protected]";
    } else {
        linkEl.innerHTML = `<span><span class="${note.getIcon()}"></span>${utils.escapeHtml(note.title)}</span>`;
    }
}

/**
 * Renders a code note.
 */
export function renderCode(result: Result) {
    if (typeof result.content !== "string" || !result.content?.trim()) {
        result.isEmpty = true;
    } else {
        const preEl = new HTMLElement("pre", {});
        preEl.appendChild(new TextNode(result.content));
        result.content = preEl.outerHTML;
    }
}

function renderMermaid(result: Result, note: SNote | BNote) {
    if (typeof result.content !== "string") {
        return;
    }

    result.content = `
<img src="api/images/${note.noteId}/${note.encodedTitle}?${note.utcDateModified}">
<hr>
<details>
    <summary>Chart source</summary>
    <pre>${escapeHtml(result.content)}</pre>
</details>`;
}

function renderImage(result: Result, note: SNote | BNote) {
    result.content = `<img src="api/images/${note.noteId}/${note.encodedTitle}?${note.utcDateModified}">`;
}

function renderFile(note: SNote | BNote, result: Result) {
    if (note.mime === "application/pdf") {
        result.content = `<iframe class="pdf-view" src="api/notes/${note.noteId}/view"></iframe>`;
    } else {
        result.content = `<button type="button" onclick="location.href='api/notes/${note.noteId}/download'">Download file</button>`;
    }
}

function renderWebView(note: SNote | BNote, result: Result) {
    const url = note.getLabelValue("webViewSrc");
    if (!url) return;

    result.content = `<iframe class="webview" src="${sanitizeUrl(url)}" sandbox="allow-same-origin allow-scripts allow-popups"></iframe>`;
}

export default {
    getContent
};
