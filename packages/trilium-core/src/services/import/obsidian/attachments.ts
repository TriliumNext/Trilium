/**
 * Resolves Obsidian attachment references in a rendered note's HTML and saves the backing files as Trilium
 * attachments.
 *
 * Obsidian embeds (`![[file]]`) and standard Markdown images (`![](file)`) arrive here as `<img>` (the
 * Markdown renderer's transclusion), and links (`[[file]]` / `[text](file)`) as `<a>`; both reference a vault
 * file by name. An `<img>` resolving to an image becomes an inline image attachment (its `src` rewritten); an
 * `<img>` resolving to a non-image file (an embedded PDF/RTF/…) becomes a file reference link, as does an
 * `<a>` resolving to any attachment file. References that don't resolve to a bundled attachment are left
 * untouched — a note embed/link, a `.base`/`.canvas`, an external URL or an in-note anchor is never altered
 * here; those belong to later passes.
 */

import { type HTMLElement, parse } from "node-html-parser";

import type BNote from "../../../becca/entities/bnote.js";
import imageService from "../../image.js";
import { escapeHtml } from "../../utils/index.js";
import { basename } from "../../utils/path.js";
import mimeService from "../mime.js";

export interface AttachmentIndex {
    /** Vault-root-relative POSIX path -> file bytes. */
    byPath: Map<string, Uint8Array>;
    /** Lower-cased base name -> the paths carrying it, for Obsidian's shortest-path (by-name) resolution. */
    byBasename: Map<string, string[]>;
}

export function buildAttachmentIndex(attachments: Map<string, Uint8Array>): AttachmentIndex {
    const byBasename = new Map<string, string[]>();
    for (const path of attachments.keys()) {
        const base = basename(path).toLowerCase();
        const paths = byBasename.get(base) ?? [];
        paths.push(path);
        byBasename.set(base, paths);
    }
    return { byPath: attachments, byBasename };
}

/**
 * @param consumed collects the vault paths that were materialized as attachments, so the caller can tell
 *   which bundled files are still orphaned (unreferenced) and need a standalone note instead.
 */
export function applyAttachments(note: BNote, html: string, index: AttachmentIndex, shrinkImages: boolean, consumed?: Set<string>): string {
    if (index.byPath.size === 0 || (!html.includes("<img") && !html.includes("<a"))) {
        return html;
    }
    const root = parse(html);
    let changed = false;

    for (const img of root.querySelectorAll("img")) {
        const ref = attachmentRef(img.getAttribute("src"));
        const resolved = ref && resolveAttachment(index, ref.name);
        if (!ref || !resolved) {
            continue;
        }
        consumed?.add(resolved.path);
        if (isImageMime(resolved.mime)) {
            try {
                const { attachmentId, title } = imageService.saveImageToAttachment(note.noteId, resolved.bytes, basename(resolved.path), shrinkImages);
                img.setAttribute("src", `api/attachments/${attachmentId}/image/${encodeURIComponent(title)}`);
                if (ref.width) {
                    img.setAttribute("width", ref.width);
                }
            } catch {
                replaceWithFileLink(img, note, resolved);
            }
        } else {
            replaceWithFileLink(img, note, resolved);
        }
        changed = true;
    }

    // The file-reference links inserted above carry a `#root/…` href, so they're skipped by this pass.
    for (const anchor of root.querySelectorAll("a")) {
        const ref = attachmentRef(anchor.getAttribute("href"));
        const resolved = ref && resolveAttachment(index, ref.name);
        if (!ref || !resolved) {
            continue;
        }
        consumed?.add(resolved.path);
        const attachment = note.saveAttachment({ role: "file", mime: resolved.mime, title: basename(resolved.path), content: resolved.bytes });
        anchor.setAttribute("href", attachmentHref(note.noteId, attachment.attachmentId));
        anchor.setAttribute("class", "reference-link");
        changed = true;
    }

    return changed ? root.toString() : html;
}

/** Saves `resolved` as a file attachment on `note` and replaces `element` with a reference link to it. */
function replaceWithFileLink(element: HTMLElement, note: BNote, resolved: ResolvedAttachment): void {
    const title = basename(resolved.path);
    const attachment = note.saveAttachment({ role: "file", mime: resolved.mime, title, content: resolved.bytes });
    element.insertAdjacentHTML("beforebegin", `<a class="reference-link" href="${attachmentHref(note.noteId, attachment.attachmentId)}">${escapeHtml(title)}</a>`);
    element.remove();
}

export interface ResolvedAttachment {
    path: string;
    bytes: Uint8Array;
    mime: string;
}

/** Resolves a reference name to a bundled attachment: an exact path first, then a unique base-name match. */
export function resolveAttachment(index: AttachmentIndex, name: string): ResolvedAttachment | null {
    let path = name;
    let bytes = index.byPath.get(path);
    if (!bytes) {
        const matches = index.byBasename.get(basename(name).toLowerCase());
        if (matches && matches.length === 1) {
            path = matches[0];
            bytes = index.byPath.get(path);
        }
    }
    if (!bytes) {
        return null;
    }
    return { path, bytes, mime: mimeService.getMime(basename(path)) || "application/octet-stream" };
}

/**
 * Extracts the vault file a `src`/`href` points at, or null for an external URL, an in-note anchor, or an
 * empty value. Strips the leading `/` the Markdown renderer adds, URL-decodes, and peels off Obsidian's
 * `#heading` and `|size` suffixes (the numeric size becomes the image width).
 */
function attachmentRef(value: string | undefined | null): { name: string; width?: string } | null {
    if (!value || /^(https?:|data:|mailto:|tel:|#)/i.test(value)) {
        return null;
    }
    let ref = safeDecode(value.replace(/^\//, ""));
    let width: string | undefined;
    const pipe = ref.indexOf("|");
    if (pipe !== -1) {
        const size = /^(\d+)(?:x\d+)?$/.exec(ref.slice(pipe + 1).trim());
        if (size) {
            width = size[1];
        }
        ref = ref.slice(0, pipe);
    }
    const hash = ref.indexOf("#");
    if (hash !== -1) {
        ref = ref.slice(0, hash);
    }
    ref = ref.replace(/\\/g, "/").trim();
    return ref ? { name: ref, width } : null;
}

function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

export function isImageMime(mime: string): boolean {
    return mime.startsWith("image/");
}

function attachmentHref(noteId: string, attachmentId: string): string {
    return `#root/${noteId}?viewMode=attachments&attachmentId=${attachmentId}`;
}
