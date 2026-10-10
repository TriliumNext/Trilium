import {
    getAttachmentEmbedHref, getEmbedKey, getNestedEmbedOptions, getNoteEmbedHref, isHttpUrl,
    isImageAttachmentRole, MIME_TYPE_AUTO, normalizeMimeTypeForCKEditor, readLinkPreviewData,
    renderLinkEmbedHtml, renderLinkMentionHtml, resolveContentEmbed, resolveEnabledMimeTypes,
    shouldSyntaxHighlight, sliceToBlockReference
} from "@triliumnext/commons";
import { renderToHtml as renderMarkdownToHtml } from "@triliumnext/commons/src/lib/markdown_renderer.js";
import { renderSpreadsheetToHtml } from "@triliumnext/commons/src/lib/spreadsheet/render_to_html.js";
import { getLanguage, highlight, highlightAuto, syncMimeTypes } from "@triliumnext/highlightjs";
import {
    getChildLinks, getChildLinksLayout, getContentClasses, getHtmlSnippets, getLastUpdated, getNavigationTree, getPageHead, getPageLanguages,
    getPrevNextLinks, getShareLink, getSiteAncestorIds, getSiteLogo, getTableOfContents, hasActiveItem,
    type NavigationItem, type PageHeading, type ShareNote
} from "@triliumnext/share-theme/model/page";
import ejs from "ejs";
import escapeHtml from "escape-html";
import { t } from "i18next";
import { HTMLElement, type Node as ParsedNode, Options, parse, TextNode } from "node-html-parser";

import becca from "../becca/becca.js";
import type BAttachment from "../becca/entities/battachment.js";
import type BBranch from "../becca/entities/bbranch.js";
import BNote from "../becca/entities/bnote.js";
import appInfo from "../services/app_info.js";
import * as iconPackService from "../services/icon_packs.js";
import { getLog } from "../services/log.js";
import options from "../services/options.js";
import * as sanitize from "../services/sanitizer.js";
import * as task_states from "../services/task_states.js";
import * as utils from "../services/utils/index.js";
import { buildFrocaPayload } from "./froca_payload.js";
import { getShareProvider } from "./share_provider.js";
import SAttachment from "./shaca/entities/sattachment.js";
import SBranch from "./shaca/entities/sbranch.js";
import type SNote from "./shaca/entities/snote.js";
import shaca from "./shaca/shaca.js";
import shareRoot from "./share_root.js";

/**
 * The URL prefix the share theme resolves built-in assets against, such as `assets/v1.2.3`.
 */
export const assetUrlFragment = `assets/v${appInfo.appVersion}`;

const PLAIN_TEXT_LANGUAGE = normalizeMimeTypeForCKEditor("text/plain");

/**
 * The base a web view's rooted source is resolved against, to tell a path that stays on this site
 * from one that only looks rooted at it. `.invalid` is reserved and resolves nowhere, so a source
 * that reaches this origin can only have done so by staying relative. See {@link isFramableSource}.
 */
const SAME_SITE_BASE = "https://web-view.invalid/";
const SAME_SITE_ORIGIN = new URL(SAME_SITE_BASE).origin;

/**
 * Represents the output of the content renderer.
 */
export interface Result {
    header: string;
    content: string | Uint8Array | undefined;
    /** Set to `true` if the provided content should be rendered as empty. */
    isEmpty?: boolean;
    /**
     * Set to `true` if the content takes the page's full height, such as a PDF, a web view or an
     * app view, below a title row like the app's and without the subpages, the date and the links
     * to the neighboring pages.
     */
    isFullHeight?: boolean;
    /**
     * Set to `true` if the content is shown with the app's own view, such as a map or the viewer of
     * an image. An app view also takes the page's full height.
     */
    isAppView?: boolean;
}

interface Subroot {
    note: SNote | BNote;
    branch?: SBranch | BBranch
}

type GetNoteFunction = (id: string) => SNote | BNote | null;

function getSharedSubTreeRoot(note: SNote): Subroot {
    if (note.noteId === shareRoot.SHARE_ROOT_NOTE_ID) {
        // The share root is the site of its own page, the share index.
        return { note };
    }

    // every path leads to share root, but which one to choose?
    // for the sake of simplicity, URLs are not note paths
    const parentBranch = note.getParentBranches()[0];

    if (parentBranch.parentNoteId === shareRoot.SHARE_ROOT_NOTE_ID) {
        return {
            note,
            branch: parentBranch
        };
    }

    return getSharedSubTreeRoot(parentBranch.getParentNote());
}

export function renderNoteForExport(note: BNote, parentBranch: BBranch, basePath: string, ancestors: string[], iconPacks: iconPackService.ProcessedIconPack[]) {
    // An exported JavaScript note stays a script.
    if (note.mime.startsWith("application/javascript")) {
        return note.isProtected ? `console.log("Protected note cannot be exported.");` : note.getContent();
    }

    const subRoot: Subroot = {
        branch: parentBranch,
        note: parentBranch.getNote()
    };

    // Determine JS to load.
    const jsToLoad: string[] = [
        `${basePath}assets/tree.js`,
        `${basePath}assets/scripts.js`
    ];
    for (const jsRelation of note.getRelations("shareJs")) {
        jsToLoad.push(`api/notes/${jsRelation.value}/download`);
    }

    return renderNoteContentInternal(note, {
        subRoot,
        rootNoteId: parentBranch.noteId,
        cssToLoad: [ `${basePath}assets/scripts.css` ],
        jsToLoad,
        logoUrl: `${basePath}icon-color.svg`,
        faviconUrl: `${basePath}favicon.ico`,
        ancestors,
        isStatic: true,
        ...getIconPackArgs(iconPacks, (p) => `${basePath}assets/icon-pack-${p.prefix.toLowerCase()}.${iconPackService.MIME_TO_EXTENSION_MAPPINGS[p.fontMime]}`)
    });
}

export function renderNoteContent(note: SNote, canAccessEmbed?: CanAccessEmbed) {
    const subRoot = getSharedSubTreeRoot(note);

    const ancestors = getSiteAncestorIds(note, subRoot.note);

    // Determine CSS to load.
    const cssToLoad: string[] = [];
    if (!note.isLabelTruthy("shareOmitDefaultCss")) {
        cssToLoad.push(`assets/scripts.css`);
    }
    for (const cssRelation of note.getRelations("shareCss")) {
        cssToLoad.push(`api/notes/${cssRelation.value}/download`);
    }

    // Determine JS to load.
    // `page.ejs` makes the first one, which restores the tree, block the page's first paint.
    const jsToLoad: string[] = [
        "assets/tree.js",
        "assets/scripts.js"
    ];
    for (const jsRelation of note.getRelations("shareJs")) {
        jsToLoad.push(`api/notes/${jsRelation.value}/download`);
    }

    const customLogoId = note.getRelation("shareLogo")?.value;
    const logoImageUrl = customLogoId ? `api/images/${customLogoId}/image.png` : null;
    const logoUrl = logoImageUrl ?? `../${assetUrlFragment}/images/icon-color.svg`;
    const iconPacks = iconPackService.getIconPacks().filter(p => p.builtin || !!shaca.notes[p.manifestNoteId]);

    return renderNoteContentInternal(note, {
        subRoot,
        rootNoteId: "_share",
        cssToLoad,
        jsToLoad,
        logoUrl,
        logoImageUrl,
        ancestors,
        isStatic: false,
        canAccessEmbed,
        faviconUrl: note.hasRelation("shareFavicon") ? `api/notes/${note.getRelationValue("shareFavicon")}/download` : `../favicon.ico`,
        ...getIconPackArgs(iconPacks, (p) => p.builtin
            ? `assets/fonts/${p.fontAttachmentId}.${iconPackService.MIME_TO_EXTENSION_MAPPINGS[p.fontMime]}`
            : `api/attachments/${p.fontAttachmentId}/download`)
    });
}

/**
 * Returns the render arguments of the icon packs `iconPacks`, whose fonts `getFontUrl` locates: their
 * CSS, their prefixes and their fonts.
 */
function getIconPackArgs(
    iconPacks: iconPackService.ProcessedIconPack[],
    getFontUrl: (iconPack: iconPackService.ProcessedIconPack) => string
) {
    const fonts = iconPacks.map((iconPack) => ({ iconPack, url: getFontUrl(iconPack) }));
    return {
        iconPackCss: [
            ...fonts.map(({ iconPack, url }) => iconPackService.generateCss(iconPack, url)),
            iconPackService.generateIconTransformCss(),
            task_states.generateTaskStateCss()
        ]
            .filter(Boolean)
            .join("\n\n"),
        iconPackSupportedPrefixes: iconPacks.map((iconPack) => iconPack.prefix),
        iconPackFonts: fonts.map(({ iconPack, url }) => ({
            prefix: iconPack.prefix,
            href: url,
            type: iconPack.fontMime
        }))
    };
}

/**
 * Returns the fonts of `fonts` to preload: Boxicons, which the theme's own controls use, and every
 * pack one of `iconClasses` (the icons of the page's logo, tree and subpages) belongs to. A pack
 * only the content uses loads when the content is laid out, as without a preload, since Chrome
 * warns about a preload the page does not use.
 */
function getFontPreloads(fonts: IconPackFont[], iconClasses: string[]) {
    const usedPrefixes = new Set([ "bx", ...iconClasses.flatMap((classes) => classes.split(/\s+/)) ]);
    return fonts
        .filter((font) => usedPrefixes.has(font.prefix))
        .map(({ href, type }) => ({ href, type }));
}

function getNavigationIcons(items: NavigationItem[]): string[] {
    return items.flatMap((item) => [ item.icon, ...getNavigationIcons(item.children) ]);
}

interface RenderArgs {
    subRoot: Subroot;
    rootNoteId: string;
    cssToLoad: string[];
    jsToLoad: string[];
    logoUrl: string;
    /** The `~shareLogo` image; without it, the default template shows the site's note icon. */
    logoImageUrl?: string | null;
    ancestors: string[];
    isStatic: boolean;
    canAccessEmbed?: CanAccessEmbed;
    faviconUrl: string;
    iconPackCss: string;
    iconPackSupportedPrefixes: string[];
    /** The font of each icon pack, which the page preloads when its own icons use the pack. */
    iconPackFonts: IconPackFont[];
}

interface IconPackFont {
    prefix: string;
    href: string;
    /** The font's media type. */
    type: string;
}

function renderNoteContentInternal(note: SNote | BNote, renderArgs: RenderArgs) {
    // Static export preserves full embed nesting; the live share view renders only the first level.
    const { header, content, isEmpty, isAppView, isFullHeight } = getContent(note, {
        expandNestedEmbeds: renderArgs.isStatic,
        canAccessEmbed: renderArgs.canAccessEmbed
    });
    const showLoginInShareTheme = options.getOptionBool("showLoginInShareTheme");
    const siteRoot = renderArgs.subRoot.note;
    const displayLanguage = options.getOptionOrNull("locale") || "en";
    const logo = getSiteLogo(siteRoot, {
        sanitizeUrl: sanitize.sanitizeUrl,
        image: renderArgs.logoImageUrl ?? null,
        iconPackPrefixes: renderArgs.iconPackSupportedPrefixes
    });
    const navigation = getNavigationTree(siteRoot, note, renderArgs.ancestors, {
        sanitizeUrl: sanitize.sanitizeUrl,
        iconPackPrefixes: renderArgs.iconPackSupportedPrefixes,
        isSubtreeHidden
    });
    const childLinks = isFullHeight ? [] : getChildLinks(note, {
        sanitizeUrl: sanitize.sanitizeUrl,
        iconPackPrefixes: renderArgs.iconPackSupportedPrefixes,
        getText: (child) => getExcerptSource(child as SNote | BNote),
        // `canAccessEmbed` is only given with a shaca note, whose children are shaca notes too.
        canAccess: (child) => renderArgs.canAccessEmbed?.(child as SNote) !== false
    });
    const titleIcon = isFullHeight ? note.getIcon(renderArgs.iconPackSupportedPrefixes) : null;
    const opts = {
        note,
        header,
        content,
        isEmpty,
        assetPath: getShareAssetPath(),
        assetUrlFragment,
        showLoginInShareTheme,
        t,
        isDev: utils.isDev(),
        utils,
        sanitizeUrl: sanitize.sanitizeUrl,
        head: getPageHead(note, siteRoot),
        snippets: getHtmlSnippets(note),
        logo,
        prevNext: isFullHeight ? { previous: null, next: null } : getPrevNextLinks(note, siteRoot, isSubtreeHidden),
        navigation,
        childLinks,
        childLinksLayout: getChildLinksLayout(note),
        contentClasses: getContentClasses(note, isEmpty, { isAppView, isFullHeight }),
        language: getPageLanguages(note, {
            displayLanguage,
            defaultContentLanguage: options.getOptionOrNull("defaultContentLanguage")
        }),
        lastUpdated: isFullHeight ? null : getLastUpdated(note, displayLanguage),
        showTitle: true,
        titleIcon,
        fontPreloads: getFontPreloads(renderArgs.iconPackFonts, [
            logo.icon,
            ...(titleIcon ? [ titleIcon ] : []),
            ...getNavigationIcons(navigation),
            ...childLinks.flatMap((child) => [ child.icon, ...child.children.map((grandchild) => grandchild.icon) ])
        ]),
        ...renderArgs,
    };

    // Check if the user has their own template.
    // Skip user-provided EJS templates when backend scripting is disabled since EJS can execute arbitrary JS.
    if (note.hasRelation("shareTemplate") && getShareProvider().isScriptingEnabled()) {
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
                const [errMessage, errStack] = utils.safeExtractMessageAndStackFromError(e);
                getLog().error(`Rendering user provided share template (${templateId}) threw exception ${errMessage} with stacktrace: ${errStack}`);
            }
        }
    }

    // Render with the default view otherwise. Custom templates get `content` without the heading
    // anchors and image attributes, which templates derived from an earlier `page.ejs` add
    // themselves.
    const { content: pageContent, headings } = typeof content === "string"
        ? preparePageContent(content, {
            imageAlt: t("share_theme.image_alt"),
            headingLinkLabel: t("share_theme.heading-link")
        })
        : { content, headings: [] };
    const pageOpts = {
        ...opts,
        content: pageContent,
        headings,
        toc: getTableOfContents(headings),
        isPageInNavigation: hasActiveItem(navigation)
    };
    return ejs.render(readShareTemplate("page"), pageOpts, {
        includer: (path) => ({ template: readShareTemplate(path) })
    });
}

/**
 * Prepares the content of a share page for the default template. A heading without an ID gets one
 * made from its text that is unique on the page. Every heading gets a link to its ID labeled
 * `headingLinkLabel`; the headings are returned in document order. An image without `alt` gets
 * `imageAlt`, and one without `loading` loads lazily. HTML without headings or images comes back as
 * it is.
 */
export function preparePageContent(
    html: string,
    options: { imageAlt: string; headingLinkLabel: string }
) {
    if (!/<(h[1-6]|img)[\s>]/i.test(html)) {
        return { content: html, headings: [] as PageHeading[] };
    }

    const document = parse(html, { comment: true });
    for (const image of document.querySelectorAll("img")) {
        if (!image.hasAttribute("alt")) {
            image.setAttribute("alt", options.imageAlt);
        }
        if (!image.hasAttribute("loading")) {
            image.setAttribute("loading", "lazy");
        }
    }

    const elements = document.querySelectorAll("h1, h2, h3, h4, h5, h6");
    const unnamed = elements.filter((element) => !element.id);
    const slugs = utils.slugifyHeadings(unnamed.map((element) => element.innerHTML),
        document.querySelectorAll("[id]").map((element) => element.id));
    let slugIndex = 0;
    const headings = elements.map((element) => {
        const slug = element.id || slugs[slugIndex++];
        const text = element.text.replace(/\s+/g, " ").trim();
        const href = `#${encodeURIComponent(slug)}`;
        const heading = { level: Number(element.tagName.slice(1)), text, slug, href };
        element.setAttribute("id", slug);
        element.insertAdjacentHTML("beforeend", `<a class="toc-anchor" href="${href}"`
            + ` aria-label="${escapeHtml(options.headingLinkLabel)}">`
            + `<span class="tn-icon bx bx-link" aria-hidden="true"></span></a>`);
        return heading;
    });
    return { content: document.toString(), headings };
}

/**
 * Returns the share theme's EJS template of that name, such as `page` or `404`. The platform
 * decides where it comes from: the server reads it from disk, the browser build from its bundle.
 */
export function readShareTemplate(name: string) {
    return getShareProvider().readTemplate(name);
}

/**
 * Returns the prefix the share theme resolves built-in assets against. The share pages live one
 * path segment deeper than the app, so outside dev the prefix climbs back out of `/share/`.
 */
function getShareAssetPath() {
    return utils.isDev() ? `${assetUrlFragment}/src` : `../${assetUrlFragment}`;
}

/**
 * Returns the text of the paragraphs of a text note, separated by blank lines, which the excerpt
 * of its entry in its parent's list of subpages starts from, or `null` for a note of another type
 * or a protected one. Only the start of the note is parsed, enough for any excerpt.
 */
function getExcerptSource(note: SNote | BNote) {
    if (note.type !== "text" || note.isProtected) {
        return null;
    }

    const content = note.getContent();
    if (typeof content !== "string") {
        return null;
    }

    return parse(content.slice(0, EXCERPT_SOURCE_LENGTH)).querySelectorAll("p")
        .map((paragraph) => paragraph.text)
        .join("\n\n");
}

/** How much of a text note's HTML {@link getExcerptSource} parses. */
const EXCERPT_SOURCE_LENGTH = 10_000;

/**
 * Decides whether the caller is allowed to read a note that an embed pulls in. The share routes
 * pass their `shareCredentials` check here so that an embed cannot hand out a note the same
 * caller would be refused on a direct request. Omitted by the static export, whose caller is the
 * already-authenticated instance owner.
 */
export type CanAccessEmbed = (note: SNote) => boolean;

export interface ShareRenderOptions {
    /**
     * Keep expanding embeds recursively at every depth. Used for static export, which
     * preserves full nesting. When false (the default for the on-screen share view), only the first
     * level of embedding is rendered and deeper embeds are replaced with a reference
     * link.
     */
    expandNestedEmbeds?: boolean;
    /** Internal: render this note's own embeds as reference links instead of expanding. */
    embedsAsReferenceLinks?: boolean;
    /** Internal: note IDs already rendered on the current embed path, used as a recursion cycle guard. */
    seenNoteIds?: Set<string>;
    /** See {@link CanAccessEmbed}. When omitted, every embedded note is expanded. */
    canAccessEmbed?: CanAccessEmbed;
    /**
     * The blocks of a text note to render, a `block` link parameter. The rest of the note is left
     * out, and a missing block renders as a broken reference.
     */
    block?: string;
}

export function getContent(note: SNote | BNote, options: ShareRenderOptions = {}) {
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
        renderText(result, note, options);
    } else if (note.type === "code" && note.mime === "text/x-markdown") {
        renderMarkdown(result, note);
    } else if (note.type === "code") {
        renderCode(result, note.mime);
    } else if (note.type === "mermaid") {
        renderMermaid(result, note);
        hostNoteView(result, note);
    } else if ([ "image", "canvas", "mindMap" ].includes(note.type)) {
        renderImage(result, note);
        hostNoteView(result, note);
    } else if (note.type === "file") {
        renderFile(note, result);
    } else if (note.type === "book" && !(note instanceof BNote)
        && HOSTED_VIEW_TYPES.has(getViewType(note) ?? "")) {
        renderCollectionView(result, note);
    } else if (note.type === "book") {
        result.isEmpty = true;
    } else if (note.type === "webView") {
        renderWebView(note, result);
    } else if ([ "noteMap", "relationMap", "render" ].includes(note.type)) {
        result.content = "";
        hostNoteView(result, note);
    } else if (note.type === "spreadsheet") {
        renderSpreadsheet(result);
        hostNoteView(result, note);
    } else {
        result.content = `<p>${t("content_renderer.note-cannot-be-displayed")}</p>`;
    }

    return result;
}

function renderIndex(result: Result) {
    result.content += '<ul id="index">';

    const rootNote = shaca.getNote(shareRoot.SHARE_ROOT_NOTE_ID);

    for (const childNote of rootNote.getChildNotes()) {
        const link = getShareLink(childNote, sanitize.sanitizeUrl);
        const target = link.isExternal ? ` target="_blank" rel="noopener noreferrer"` : "";
        result.content += `<li><a class="${childNote.type}" href="${escapeHtml(link.href)}"${target}>`
            + `${childNote.escapedTitle}</a></li>`;
    }

    result.content += "</ul>";
}

function renderText(result: Result, note: SNote | BNote, options: ShareRenderOptions = {}) {
    if (typeof result.content !== "string") return;
    const parseOpts: Partial<Options> = {
        blockTextElements: {}
    };
    const document = parse(result.content || "", parseOpts);
    if (options.block !== undefined && !sliceToBlockReference(document, options.block)) {
        const message = escapeHtml(t("content_renderer.broken-block-reference"));
        result.content = `<p class="block-reference-broken">${message}</p>`;
        return;
    }

    // Link previews keep their metadata in `data-*` attributes and are drawn as the app draws
    // them. The share theme adds the click-to-play behavior of a video.
    const previewOptions = { playVideoLabel: t("content_renderer.play-video") };
    for (const mentionEl of document.querySelectorAll("span.link-mention")) {
        const data = readLinkPreviewData((name) => mentionEl.getAttribute(name));
        if (data) {
            mentionEl.innerHTML = renderLinkMentionHtml(data, previewOptions);
        }
    }

    for (const embedEl of document.querySelectorAll("section.link-embed")) {
        const data = readLinkPreviewData((name) => embedEl.getAttribute(name));
        if (data) {
            embedEl.innerHTML = renderLinkEmbedHtml(data, previewOptions);
        }
    }

    // Process embeds. The share view renders only the first level of embedding; static export
    // (expandNestedEmbeds) keeps expanding recursively. seenNoteIds tracks the current ancestor
    // path (cloned per descent below) so the recursive path can break cycles without treating a note
    // embedded in two sibling sub-trees as circular.
    const getNote: GetNoteFunction = note instanceof BNote
        ? (noteId: string) => becca.getNote(noteId)
        : (noteId: string) => shaca.getNote(noteId);
    const getAttachment = note instanceof BNote
        ? (attachmentId: string) => becca.getAttachment(attachmentId)
        : (attachmentId: string) => shaca.getAttachment(attachmentId);

    const embedContext = {
        seenNoteIds: new Set(options.seenNoteIds).add(getEmbedKey(note.noteId, options.block)),
        embedsAsReferenceLinks: options.embedsAsReferenceLinks,
        expandNestedEmbeds: options.expandNestedEmbeds
    };
    for (const embedEl of document.querySelectorAll(".include-note")) {
        const embed = resolveContentEmbed((name) => embedEl.getAttribute(name), embedContext);
        if (!embed) continue;

        if (embed.kind === "attachment") {
            const attachment = getAttachment(embed.attachmentId);
            if (!attachment) {
                embedEl.remove();
            } else if (embed.asLink) {
                const link = renderAttachmentLink(embed.attachmentId, attachment);
                embedEl.replaceWith(...parse(link, parseOpts).childNodes);
            } else {
                const html = renderAttachmentEmbed(embed.attachmentId, attachment);
                replaceEmbedContent(embedEl, parse(html, parseOpts).childNodes);
            }
            continue;
        }

        const embeddedNote = shaca.getNote(embed.noteId);
        if (!embeddedNote) continue;

        // An embed must not disclose what a direct request for the same note would refuse: a note
        // carrying `shareCredentials` the caller has not presented becomes a placeholder, and its
        // title is withheld too, since an embedded note need not appear in the visible share tree.
        if (options.canAccessEmbed && !options.canAccessEmbed(embeddedNote)) {
            embedEl.replaceWith(...parse(`<p class="include-note-forbidden">${escapeHtml(t("content_renderer.included-note-requires-credentials"))}</p>`, parseOpts).childNodes);
            continue;
        }

        // The link-processing passes below resolve the reference link to the shared note.
        if (embed.asLink) {
            const href = escapeHtml(getNoteEmbedHref(embed.noteId, embed.block));
            const title = escapeHtml(embeddedNote.title);
            const link = `<a class="reference-link" href="${href}">${title}</a>`;
            embedEl.replaceWith(...parse(link, parseOpts).childNodes);
            continue;
        }

        const embeddedResult = getContent(embeddedNote, {
            ...getNestedEmbedOptions(embedContext, embed.block),
            canAccessEmbed: options.canAccessEmbed
        });
        if (typeof embeddedResult.content !== "string") continue;

        replaceEmbedContent(embedEl, parse(embeddedResult.content, parseOpts).childNodes);
    }

    result.isEmpty = document.textContent?.trim().length === 0 && document.querySelectorAll("img").length === 0;

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
                cleanUpReferenceLinks(linkEl, href ?? "", getNote);
            }
        }

        // Apply syntax highlight.
        for (const codeEl of document.querySelectorAll("pre code")) {
            if (codeEl.classList.contains("language-mermaid")) {
                // Mermaid is handled on client-side, we don't want to break it by adding syntax highlighting.
                continue;
            }

            highlightCodeBlock(codeEl);
        }

        result.content = document.innerHTML;

        if (note.hasLabel("shareIndex")) {
            renderIndex(result);
        }
    }
}

/** Puts `content` in an embed, followed by the embed's caption, as the app does. */
function replaceEmbedContent(embedEl: HTMLElement, content: ParsedNode[]) {
    const caption = embedEl.childNodes.find((child) =>
        child instanceof HTMLElement && child.tagName === "FIGCAPTION");
    embedEl.set_content(caption ? [ ...content, caption ] : content);
}

/**
 * What an embedded attachment shows: a picture as an image, anything else as the attachment link
 * that `handleAttachmentLink` then resolves.
 */
function renderAttachmentEmbed(attachmentId: string, attachment: BAttachment | SAttachment) {
    if (!isImageAttachmentRole(attachment.role)) {
        return renderAttachmentLink(attachmentId, attachment);
    }

    const src = `api/attachments/${attachmentId}/image/${encodeURIComponent(attachment.title)}`;
    return `<img src="${src}" alt="${escapeHtml(attachment.title)}">`;
}

/** The reference link to an attachment, which `handleAttachmentLink` then resolves. */
function renderAttachmentLink(attachmentId: string, attachment: BAttachment | SAttachment) {
    const href = escapeHtml(getAttachmentEmbedHref(attachment.ownerId, attachmentId));
    return `<a class="reference-link" href="${href}">${escapeHtml(attachment.title)}</a>`;
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
            getLog().error(`Broken attachment link detected in shared note: unable to find attachment with ID ${attachmentId}`);
        }
    } else {
        const noteId = getNoteIdFromLink(href);
        const linkedNote = getNote(noteId);
        if (linkedNote) {
            const link = getShareLink(linkedNote, sanitize.sanitizeUrl);
            linkEl.setAttribute("href", link.href);
            if (link.isExternal) {
                linkEl.setAttribute("target", "_blank");
                linkEl.setAttribute("rel", "noopener noreferrer");
            }
            linkEl.classList.add(`type-${linkedNote.type}`);
        } else {
            getLog().error(`Broken link detected in shared note: unable to find note with ID ${noteId}`);
            linkEl.removeAttribute("href");
        }
    }
}

/**
 * Processes reference links to ensure that they are up to date. More specifically, reference links contain in their HTML source code the note title at the time of the linking. It can be changed in the mean-time or the note can become protected, which leaks information.
 *
 * @param linkEl the <a> element to process.
 * @param href the `href` stored in the note; `handleAttachmentLink()` rewrites the attribute.
 */
function cleanUpReferenceLinks(linkEl: HTMLElement, href: string, getNote: GetNoteFunction) {
    // Note: this method is basically a reimplementation of getReferenceLinkTitleSync from the link service of the client.

    // Handle attachment reference links
    if (linkEl.classList.contains("attachment-link")) {
        const title = linkEl.innerText;
        linkEl.innerHTML = `<span><span class="tn-icon bx bx-download"></span>${utils.escapeHtml(title)}</span>`;
        return;
    }

    // `handleAttachmentLink()` removes the `href` of a link whose target is missing.
    let noteId = "";
    if (linkEl.hasAttribute("href")) {
        noteId = href.startsWith("#") ? getNoteIdFromLink(href) : href.slice(href.lastIndexOf("/") + 1);
    }
    const note = noteId ? getNote(noteId) : undefined;
    if (!note) {
        // If a note is not found, simply replace it with a text.
        linkEl.replaceWith(new TextNode(linkEl.innerText));
    } else if (note.isProtected) {
        linkEl.innerHTML = "[protected]";
    } else {
        linkEl.innerHTML = `<span><span class="${escapeHtml(note.getIcon())}"></span>${utils.escapeHtml(note.title)}</span>`;
    }
}

/** Returns the ID of the note a link such as `#root/abc/def?viewMode=source` points to. */
function getNoteIdFromLink(href: string) {
    const [notePath] = href.split("?");
    const notePathSegments = notePath.split("/");
    return notePathSegments[notePathSegments.length - 1];
}

/**
 * Renders a markdown code note by converting the markdown source to HTML
 * using the shared {@link renderMarkdownToHtml} pipeline.
 */
function renderMarkdown(result: Result, note: SNote | BNote) {
    if (typeof result.content !== "string" || !result.content?.trim()) {
        result.isEmpty = true;
        return;
    }

    const html = renderMarkdownToHtml(result.content, note.title, {
        sanitize: sanitize.sanitizeHtml,
        wikiLink: { formatHref: (id) => `./${id}` }
    });

    // Apply syntax highlighting to code blocks, same as renderText.
    const parseOpts: Partial<Options> = { blockTextElements: {} };
    const document = parse(html, parseOpts);
    for (const codeEl of document.querySelectorAll("pre code")) {
        if (codeEl.classList.contains("language-mermaid")
            || codeEl.classList.contains(`language-${MIME_TYPE_AUTO}`)) {
            continue;
        }

        highlightCodeBlock(codeEl);
    }

    result.content = document.innerHTML;
}

/**
 * Highlights a `<pre><code>` block in place, in the language its `language-*` class names. A block
 * without one, or set to auto-detect, goes through `highlightAuto`. Plain text and a language that
 * {@link ensureShareHighlighting} did not register stay unhighlighted.
 */
function highlightCodeBlock(codeEl: HTMLElement) {
    const language = [ ...codeEl.classList.values() ]
        .find((className) => className.startsWith("language-"))
        ?.slice("language-".length) ?? MIME_TYPE_AUTO;
    const isAuto = language === MIME_TYPE_AUTO;
    if (language === PLAIN_TEXT_LANGUAGE || (!isAuto && !getLanguage(language))) {
        return;
    }

    // codeEl.text recursively traverses the node's subtree, so read it once.
    const codeText = codeEl.text;
    if (!shouldSyntaxHighlight(codeText)) {
        return;
    }

    const highlightResult = isAuto ? highlightAuto(codeText) : highlight(codeText, { language });
    if (highlightResult) {
        codeEl.innerHTML = highlightResult.value;
        codeEl.classList.add("hljs");
    }
}

let registeredMimeTypesOption: string | null = null;
let pendingRegistration: Promise<void> | null = null;

/**
 * Registers the highlight.js languages enabled in the `codeNotesMimeTypes` option and unregisters
 * the disabled ones, so `highlightAuto` considers only the enabled ones. The renderer is
 * synchronous, so callers await this before rendering a share page or a share-theme export.
 */
export function ensureShareHighlighting(): Promise<void> {
    const optionValue = options.getOptionOrNull("codeNotesMimeTypes");
    if (pendingRegistration && optionValue === registeredMimeTypesOption) {
        return pendingRegistration;
    }

    registeredMimeTypesOption = optionValue;
    pendingRegistration = Promise.resolve()
        .then(() => {
            const enabledMimes = optionValue ? JSON.parse(optionValue) : null;
            return syncMimeTypes(resolveEnabledMimeTypes(enabledMimes));
        })
        .catch((e: unknown) => {
            getLog().error(`Unable to register the languages for syntax highlighting: ${e}`);
            pendingRegistration = null;
        });
    return pendingRegistration;
}

/**
 * Renders a code note.
 */
export function renderCode(result: Result, mime?: string) {
    if (typeof result.content !== "string" || !result.content?.trim()) {
        result.isEmpty = true;
    } else {
        // Escape the raw code so that any `<`/`>` it contains are not later re-parsed as HTML.
        // When such a code note is embedded into a shared text note, renderText re-parses the
        // resulting HTML; with unescaped angle brackets (e.g. generics, comparisons, JSX) a large
        // code note would explode into a pathological node-html-parser tree and hang the event
        // loop (#9717). The <code> wrapper and its `language-*` class additionally let renderText
        // apply syntax highlighting, bounded by shouldSyntaxHighlight().
        const languageClass = mime
            ? ` class="language-${escapeHtml(normalizeMimeTypeForCKEditor(mime))}"`
            : "";
        result.content = `<pre><code${languageClass}>${escapeHtml(result.content)}</code></pre>`;
    }
}

/**
 * Renders a Mermaid note as the image the app saved, which the share theme's script replaces with
 * a diagram drawn from `.mermaid-note-source` in the page's light or dark theme, inside a viewer
 * that pans and zooms it. The `data-*` attributes label that viewer.
 */
function renderMermaid(result: Result, note: SNote | BNote) {
    if (typeof result.content !== "string") {
        return;
    }

    const labels = Object.entries(MERMAID_VIEWER_LABELS)
        .map(([ name, key ]) => ` data-${name}="${escapeHtml(t(key))}"`)
        .join("");
    result.content = `
<div class="mermaid-note"${labels}>
<img class="mermaid-note-image" src="api/images/${note.noteId}/${note.encodedTitle}?${note.utcDateModified}">
<hr>
<details>
    <summary>Chart source</summary>
    <pre class="mermaid-note-source">${escapeHtml(result.content)}</pre>
</details>
</div>`;
}

/**
 * The view type of a collection: its own `#viewType`, else the one of a built-in template such as
 * `_template_calendar`, which lives in the hidden subtree and so is never in shaca.
 */
function getViewType(note: SNote) {
    return note.getLabelValue("viewType") || note.getBuiltInTemplateLabelValue("viewType");
}

/**
 * Returns whether the note keeps its children out of the tree with `#subtreeHidden`, which a board
 * has from its built-in template. Shaca holds only shared notes, so becca answers for the template.
 */
function isSubtreeHidden(note: ShareNote) {
    const shared = note as SNote | BNote;
    if (shared instanceof BNote || shared.hasLabel("subtreeHidden")) {
        return shared.isLabelTruthy("subtreeHidden");
    }

    const value = shared.getBuiltInTemplateLabelValue("subtreeHidden");
    return value !== null && value !== "false";
}

/**
 * Renders a collection the share theme shows with the app's own view, through its note list: an
 * element to mount it into, beside the notes and the display options it starts from.
 */
function renderCollectionView(result: Result, note: SNote) {
    result.content = "";
    hostInAppView(result, note, "share-collection");
}

/**
 * Has the share theme show a shared note with the app's own widget for its type, keeping the content
 * rendered here for a visitor without scripts. The static export, binary content and an empty note
 * keep the content alone.
 */
function hostNoteView(result: Result, note: SNote | BNote) {
    if (!(note instanceof BNote) && typeof result.content === "string" && !result.isEmpty) {
        hostInAppView(result, note, "share-note-view");
    }
}

/**
 * Wraps the content in a `container` the share theme's script mounts an app view into, beside the
 * notes and the display options the view starts from. The content stays for a visitor without
 * scripts until the view replaces it.
 */
function hostInAppView(result: Result, note: SNote, container: string) {
    const payload = {
        ...buildFrocaPayload(note),
        options: Object.fromEntries(SHARED_OPTIONS.map((name) => [ name, options.getOptionOrNull(name) ])),
        // The app's assets, such as its translations, from a page directly below `/share/`.
        assetPath: `../${utils.isDev() ? `${assetUrlFragment}/src` : assetUrlFragment}`,
        // The note the app would show the note below, such as the root of a note map note's map.
        parentNoteId: note.getParentBranches()[0]?.parentNoteId ?? null
    };
    const json = JSON.stringify(payload).replace(/</g, "\\u003c");
    result.isAppView = true;
    result.isFullHeight = true;
    const content = String(result.content ?? "");
    result.content = `<div class="${container}" data-note-id="${note.noteId}">${content}</div>`
        + `<script type="application/json" class="share-froca">${json}</script>`;
}

/** The view types of the collections the share theme shows with the app's own view. */
const HOSTED_VIEW_TYPES = new Set([ "calendar", "geoMap" ]);

/**
 * The options the app's views read to draw a note as the app does, which a shared page receives. Only
 * display options: the rest of the options can hold secrets, such as API keys.
 */
const SHARED_OPTIONS = [
    "locale", "formattingLocale", "firstDayOfWeek",
    "codeNoteTheme", "codeNoteThemeLight", "codeNoteThemeDark", "codeNoteThemeMatchesApp",
    "codeLineWrapEnabled", "codeNoteTabWidth", "codeNoteIndentWithTabs",
    "splitEditorOrientation"
] as const;

/** The `data-*` attributes of a Mermaid note that label its viewer, and their translations. */
const MERMAID_VIEWER_LABELS = {
    "label": "share_theme.diagram",
    "zoom-in": "share_theme.zoom-in",
    "zoom-out": "share_theme.zoom-out",
    "zoom-reset": "share_theme.zoom-reset"
};

function renderImage(result: Result, note: SNote | BNote) {
    result.content = `<img src="api/images/${note.noteId}/${note.encodedTitle}?${note.utcDateModified}">`;
}

function renderFile(note: SNote | BNote, result: Result) {
    if (note.mime === "application/pdf") {
        result.content = `<iframe class="pdf-view" src="api/notes/${note.noteId}/view"></iframe>`;
        result.isFullHeight = true;
    } else {
        result.content = `<button type="button" onclick="location.href='api/notes/${note.noteId}/download'">Download file</button>`;
    }
}

function renderSpreadsheet(result: Result) {
    if (typeof result.content !== "string" || !result.content?.trim()) {
        result.isEmpty = true;
    } else {
        result.content = renderSpreadsheetToHtml(result.content);
    }
}

/**
 * Renders a web view note as the frame that embeds its source.
 *
 * The frame is built as an element rather than assembled as a string: `setAttribute()` escapes the
 * value it is handed, so the source is placed as a value and can only ever be read back as one.
 */
function renderWebView(note: SNote | BNote, result: Result) {
    const url = note.getLabelValue("webViewSrc");
    if (!url) return;

    if (!isFramableSource(url)) {
        getLog().error(`Web view of shared note '${note.noteId}' not rendered: '${url}' is neither an absolute http(s) URL nor a path on this site.`);
        return;
    }

    const frame = new HTMLElement("iframe", { class: "webview" });
    frame.setAttribute("src", sanitize.sanitizeUrl(url));
    // The embedded page keeps its own origin, may run scripts and may open windows. Keeping the
    // origin is what lets the pages a web view is normally pointed at use their cookies and
    // storage, but it also means a page served from this very origin is not isolated from the page
    // embedding it; only dropping allow-same-origin would isolate it.
    frame.setAttribute("sandbox", "allow-same-origin allow-scripts allow-popups");
    result.content = frame.toString();
    result.isFullHeight = true;
}

/**
 * True when a web view's source is one the share page may frame: an absolute http(s) URL, or a path
 * rooted at the site serving the page.
 *
 * Those two are what a web view is documented to take — the setup form writes the first, and the
 * user guide's API reference pages carry the second to reach the Redoc and TypeDoc output the docs
 * build writes beside them. Any other value reaches the label by another route — a hand-edited
 * attribute, an import, ETAPI, a sync — and is either not framable at all or leaves the site while
 * looking rooted at it.
 *
 * A rooted path is resolved against a base no source can name, so anything that reaches a different
 * origin is rejected however it spelled the authority: `sanitizeUrl()` passes `//example.com` and
 * `/\example.com` through untouched, and the URL parser folds a backslash, and strips a tab, into
 * the second slash that starts one.
 */
function isFramableSource(url: string): boolean {
    if (isHttpUrl(url)) {
        return true;
    }

    if (!url.startsWith("/")) {
        return false;
    }

    try {
        return new URL(url, SAME_SITE_BASE).origin === SAME_SITE_ORIGIN;
    } catch {
        return false;
    }
}


export default {
    getContent
};
