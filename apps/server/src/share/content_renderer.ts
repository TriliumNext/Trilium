import { JSDOM } from "jsdom";
import shaca from "./shaca/shaca.js";
import assetPath, { assetUrlFragment } from "../services/asset_path.js";
import shareRoot from "./share_root.js";
import escapeHtml from "escape-html";
import type SNote from "./shaca/entities/snote.js";
import BNote from "../becca/entities/bnote.js";
import type BBranch from "../becca/entities/bbranch.js";
import { t } from "i18next";
import SBranch from "./shaca/entities/sbranch.js";
import options from "../services/options.js";
import { getResourceDir, isDev, safeExtractMessageAndStackFromError } from "../services/utils.js";
import app_path from "../services/app_path.js";
import ejs from "ejs";
import log from "../services/log.js";
import { join } from "path";
import { readFileSync } from "fs";

const shareAdjustedAssetPath = isDev ? assetPath : `../${assetPath}`;
const shareAdjustedAppPath = isDev ? app_path : `../${app_path}`;
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
        }
    }

    if (parentBranch.parentNoteId === shareRoot.SHARE_ROOT_NOTE_ID) {
        return {
            note,
            branch: parentBranch
        };
    }

    return getSharedSubTreeRoot(parentBranch.getParentNote());
}

export function renderNoteForExport(note: BNote, parentBranch: BBranch, basePath: string, ancestors: string[]) {
    const subRoot: Subroot = {
        branch: parentBranch,
        note: parentBranch.getNote()
    };

    return renderNoteContentInternal(note, {
        subRoot,
        rootNoteId: parentBranch.noteId,
        cssToLoad: [
            `${basePath}style.css`,
            `${basePath}boxicons.css`
        ],
        jsToLoad: [
            `${basePath}script.js`
        ],
        logoUrl: `${basePath}icon-color.svg`,
        ancestors
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
    if (!isDev && !note.isLabelTruthy("shareOmitDefaultCss")) {
        cssToLoad.push(`${shareAdjustedAssetPath}/src/share.css`);
        cssToLoad.push(`${shareAdjustedAssetPath}/src/boxicons.css`);
    }
    for (const cssRelation of note.getRelations("shareCss")) {
        cssToLoad.push(`api/notes/${cssRelation.value}/download`);
    }

    // Determine JS to load.
    const jsToLoad: string[] = [
        `${shareAdjustedAppPath}/share.js`
    ];
    for (const jsRelation of note.getRelations("shareJs")) {
        jsToLoad.push(`api/notes/${jsRelation.value}/download`);
    }

    const customLogoId = note.getRelation("shareLogo")?.value;
    const logoUrl = customLogoId ? `api/images/${customLogoId}/image.png` : `../${assetUrlFragment}/images/icon-color.svg`;

    return renderNoteContentInternal(note, {
        subRoot,
        rootNoteId: "_share",
        cssToLoad,
        jsToLoad,
        logoUrl,
        ancestors
    });
}

interface RenderArgs {
    subRoot: Subroot;
    rootNoteId: string;
    cssToLoad: string[];
    jsToLoad: string[];
    logoUrl: string;
    ancestors: string[];
}

function renderNoteContentInternal(note: SNote | BNote, renderArgs: RenderArgs) {
    const { header, content, isEmpty } = getContent(note);
    const showLoginInShareTheme = options.getOption("showLoginInShareTheme");
    const opts = {
        note,
        header,
        content,
        isEmpty,
        assetPath: shareAdjustedAssetPath,
        assetUrlFragment,
        appPath: shareAdjustedAppPath,
        showLoginInShareTheme,
        t,
        isDev,
        ...renderArgs
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
    const templatePath = join(getResourceDir(), "share-theme", "templates", "page.ejs");
    return ejs.render(readTemplate(templatePath), opts, {
        includer: (path) => {
            const templatePath = join(getResourceDir(), "share-theme", "templates", `${path}.ejs`);
            return { template: readTemplate(templatePath) };
        }
    });
}

function readTemplate(path: string) {
    const cachedTemplate = templateCache.get(path);
    if (cachedTemplate) {
        return cachedTemplate;
    }

    const templateString = readFileSync(path, "utf-8");
    templateCache.set(path, templateString);
    return templateString;
}

function getContent(note: SNote | BNote) {
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
    const document = new JSDOM(result.content || "").window.document;

    result.isEmpty = document.body.textContent?.trim().length === 0 && document.querySelectorAll("img").length === 0;

    if (!result.isEmpty) {
        for (const linkEl of document.querySelectorAll("a")) {
            const href = linkEl.getAttribute("href");

            // Preserve footnotes.
            if (href?.startsWith("#fn")) {
                continue;
            }

            if (href?.startsWith("#")) {
                handleAttachmentLink(linkEl, href);
            }
        }

        result.content = document.body.innerHTML;

        if (result.content.includes(`<span class="math-tex">`)) {
            result.header += `
<script src="../${assetPath}/node_modules/katex/dist/katex.min.js"></script>
<link rel="stylesheet" href="../${assetPath}/node_modules/katex/dist/katex.min.css">
<script src="../${assetPath}/node_modules/katex/dist/contrib/auto-render.min.js"></script>
<script src="../${assetPath}/node_modules/katex/dist/contrib/mhchem.min.js"></script>
<script>
document.addEventListener("DOMContentLoaded", function() {
    renderMathInElement(document.getElementById('content'));
});
</script>`;
        }

        if (note.hasLabel("shareIndex")) {
            renderIndex(result);
        }
    }
}

function handleAttachmentLink(linkEl: HTMLAnchorElement, href: string) {
    const linkRegExp = /attachmentId=([a-zA-Z0-9_]+)/g;
    let attachmentMatch;
    if ((attachmentMatch = linkRegExp.exec(href))) {
        const attachmentId = attachmentMatch[1];
        const attachment = shaca.getAttachment(attachmentId);

        if (attachment) {
            linkEl.setAttribute("href", `api/attachments/${attachmentId}/download`);
            linkEl.classList.add(`attachment-link`);
            linkEl.classList.add(`role-${attachment.role}`);
            linkEl.innerText = attachment.title;
        } else {
            linkEl.removeAttribute("href");
        }
    } else {
        const [notePath] = href.split("?");
        const notePathSegments = notePath.split("/");
        const noteId = notePathSegments[notePathSegments.length - 1];
        const linkedNote = shaca.getNote(noteId);
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
            linkEl.removeAttribute("href");
        }
    }
}

/**
 * Renders a code note.
 */
export function renderCode(result: Result) {
    if (typeof result.content !== "string" || !result.content?.trim()) {
        result.isEmpty = true;
    } else {
        const document = new JSDOM().window.document;

        const preEl = document.createElement("pre");
        preEl.appendChild(document.createTextNode(result.content));

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

export default {
    getContent
};
