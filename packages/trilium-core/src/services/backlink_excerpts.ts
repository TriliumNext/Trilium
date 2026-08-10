/**
 * Extracts backlink content previews: quotes what surrounds each link pointing at the
 * referenced note, as `ck-content backlink-excerpt` fragments the backlinks UI renders.
 *
 * {@link findExcerpts} works on any HTML that marks its note links as `href="…#root…/<noteId>"`
 * anchors — a text note's content directly. {@link findLlmChatExcerpts} brings `llmChat` notes
 * to that same shape first: their assistant prose is markdown, rendered to HTML through the
 * shared pipeline the chat UI uses, with wiki-link anchors retitled from note ID to note title.
 * {@link findMindMapExcerpts} has no prose to quote at all, a map's links belonging to its nodes,
 * and writes its own fragments instead.
 */

import { parseMindMapNoteLink } from "@triliumnext/commons";
import { renderToHtml } from "@triliumnext/commons/src/lib/markdown_renderer.js";
import { HTMLElement, parse, TextNode } from "node-html-parser";

import becca from "../becca/becca";
import { sanitizeHtml } from "./sanitizer.js";
import { escapeHtml } from "./utils/index";

/** Character budget of one excerpt. */
export const EXCERPT_CHAR_LIMIT = 200;

type ElementOrText = HTMLElement | TextNode;

export function findExcerpts(html: string, referencedNoteId: string): string[] {
    const document = parse(html);

    const excerpts: string[] = [];

    removeImages(document);

    for (const linkEl of document.querySelectorAll("a")) {
        const href = linkEl.getAttribute("href");

        if (!href || !href.endsWith(referencedNoteId)) {
            continue;
        }

        linkEl.classList.add("backlink-link");

        let centerEl: HTMLElement = linkEl;

        while (centerEl.tagName !== "BODY" && centerEl.parentNode && (centerEl.parentNode?.textContent?.length || 0) <= EXCERPT_CHAR_LIMIT) {
            centerEl = centerEl.parentNode;
        }

        const excerptEls: ElementOrText[] = [centerEl];
        let excerptLength = centerEl.textContent?.length || 0;
        let left: ElementOrText = centerEl;
        let right: ElementOrText = centerEl;

        while (excerptLength < EXCERPT_CHAR_LIMIT) {
            let added = false;

            const prev: HTMLElement | null = left.previousElementSibling;

            if (prev) {
                const prevText = prev.textContent || "";

                if (prevText.length + excerptLength > EXCERPT_CHAR_LIMIT) {
                    const prefix = prevText.substr(prevText.length - (EXCERPT_CHAR_LIMIT - excerptLength));

                    const textNode = new TextNode(`…${prefix}`);
                    excerptEls.unshift(textNode);

                    break;
                }

                left = prev;
                excerptEls.unshift(left);
                excerptLength += prevText.length;
                added = true;
            }

            const next: HTMLElement | null = right.nextElementSibling;

            if (next) {
                const nextText = next.textContent;

                if (nextText && nextText.length + excerptLength > EXCERPT_CHAR_LIMIT) {
                    const suffix = nextText.substr(nextText.length - (EXCERPT_CHAR_LIMIT - excerptLength));

                    const textNode = new TextNode(`${suffix}…`);
                    excerptEls.push(textNode);

                    break;
                }

                right = next;
                excerptEls.push(right);
                excerptLength += nextText?.length || 0;
                added = true;
            }

            if (!added) {
                break;
            }
        }

        const excerptWrapper = new HTMLElement("div", {});
        excerptWrapper.classList.add("ck-content");
        excerptWrapper.classList.add("backlink-excerpt");

        for (const childEl of excerptEls) {
            excerptWrapper.appendChild(childEl);
        }

        excerpts.push(excerptWrapper.outerHTML);
    }
    return excerpts;
}

function removeImages(document: HTMLElement) {
    const images = document.getElementsByTagName("img");
    for (const image of images) {
        image.remove();
    }
}

/**
 * The `llmChat` entry point. A chat stores its whole conversation as one JSON blob
 * (`{ messages: [...] }`), and its internalLink relations come from `[[noteId]]` wiki-links in
 * assistant text blocks (see `findLlmChatLinks` in services/notes.ts) — so those blocks are
 * rendered to HTML and quoted by {@link findExcerpts} like any other content. A chat that
 * references the note purely through tool calls has nothing quotable and yields no excerpts.
 */
export function findLlmChatExcerpts(jsonContent: string, referencedNoteId: string): string[] {
    const markdown = collectAssistantProse(jsonContent);
    if (!markdown) {
        return [];
    }

    const html = renderToHtml(markdown, "", {
        sanitize: sanitizeHtml,
        // The same href shape the chat UI renders, and the one findExcerpts matches on.
        wikiLink: { formatHref: (noteId) => `#root/${noteId}` },
        // Chat prose is a conversation, not a document with a duplicated title heading.
        demoteH1: false
    });

    return findExcerpts(titleWikiLinks(html), referencedNoteId);
}

/** Joins the assistant text blocks — the only chat content that creates internalLink relations. */
function collectAssistantProse(jsonContent: string): string {
    let parsed: { messages?: unknown[] };
    try {
        parsed = JSON.parse(jsonContent);
    } catch {
        return "";
    }
    if (!Array.isArray(parsed.messages)) {
        return "";
    }

    const blocks: string[] = [];
    for (const message of parsed.messages) {
        if (typeof message !== "object" || message === null) continue;
        const { role, content } = message as Record<string, unknown>;
        if (role !== "assistant" || !Array.isArray(content)) continue;

        for (const block of content) {
            if (typeof block !== "object" || block === null) continue;
            const b = block as Record<string, unknown>;
            if (b.type === "text" && typeof b.content === "string") {
                blocks.push(b.content);
            }
        }
    }
    // A blank line between blocks keeps them separate markdown paragraphs.
    return blocks.join("\n\n");
}

/**
 * The `mindMap` entry point. A map has no prose to quote: the link belongs to a node, so what is
 * quoted is the node itself — its own text as the link, led by the nodes it hangs from, which is
 * what says where in the map the link was made.
 *
 * @param jsonContent the map, as it is stored.
 * @param referencedNoteId the note the backlinks are being gathered for.
 * @returns one excerpt per node linking to that note.
 */
export function findMindMapExcerpts(jsonContent: string, referencedNoteId: string): string[] {
    let rootNode: unknown;
    try {
        rootNode = (JSON.parse(jsonContent) as { nodeData?: unknown }).nodeData;
    } catch {
        return [];
    }

    const excerpts: string[] = [];
    collectNodeExcerpts(rootNode, [], referencedNoteId, excerpts);
    return excerpts;
}

function collectNodeExcerpts(node: unknown, ancestors: string[], referencedNoteId: string, excerpts: string[]) {
    if (!node || typeof node !== "object") {
        return;
    }

    const { topic, hyperLink, children } = node as Record<string, unknown>;
    const nodeText = (typeof topic === "string" ? topic : "");

    if (parseMindMapNoteLink(hyperLink)?.noteId === referencedNoteId) {
        excerpts.push(buildNodeExcerpt(ancestors, nodeText, referencedNoteId));
    }

    if (Array.isArray(children)) {
        const trail = [ ...ancestors, nodeText ];
        for (const child of children) {
            collectNodeExcerpts(child, trail, referencedNoteId, excerpts);
        }
    }
}

/**
 * Quotes one node: the nodes it hangs from, then the node itself as the link.
 *
 * The trail is taken from the node upwards for as long as there is room, so what is dropped is the
 * root end — the part every node in the map shares, and so the part that says the least about where
 * this one sits.
 */
function buildNodeExcerpt(ancestors: string[], nodeText: string, referencedNoteId: string): string {
    // A node left unnamed has nothing of its own to read; the note it points at names it instead,
    // rather than leaving a link with no text to click.
    const linkText = nodeText || becca.notes[referencedNoteId]?.getTitleOrProtected() || referencedNoteId;

    const trail: string[] = [];
    let length = linkText.length;
    for (const ancestor of [ ...ancestors ].reverse()) {
        if (!ancestor) continue;
        if (length + ancestor.length + MIND_MAP_TRAIL_SEPARATOR.length > EXCERPT_CHAR_LIMIT) {
            trail.unshift("…");
            break;
        }
        trail.unshift(ancestor);
        length += ancestor.length + MIND_MAP_TRAIL_SEPARATOR.length;
    }

    const crumbs = trail
        .map((ancestor) => `${escapeHtml(ancestor)}${MIND_MAP_TRAIL_SEPARATOR}`)
        .join("");

    return `<div class="ck-content backlink-excerpt">${crumbs}` +
        `<a class="backlink-link" href="#root/${referencedNoteId}">${escapeHtml(linkText)}</a></div>`;
}

/** What stands between a node and the one it hangs from. */
const MIND_MAP_TRAIL_SEPARATOR = " › ";

/**
 * Renames the wiki-link anchors from the note ID (all the markdown source carries) to the
 * note's title. In the chat UI this decoration happens client-side, but excerpts are rendered
 * as-is by the backlinks list, so the title has to be baked in.
 */
function titleWikiLinks(html: string): string {
    const document = parse(html);

    for (const linkEl of document.querySelectorAll(`a[href^="#root/"]`)) {
        const noteId = linkEl.getAttribute("href")?.slice("#root/".length);
        // A regular markdown link carries its own text; only a wiki-link names its target's ID.
        if (noteId && linkEl.textContent.trim() === noteId) {
            linkEl.set_content(escapeHtml(becca.notes[noteId]?.getTitleOrProtected() ?? noteId));
        }
    }

    return document.toString();
}
