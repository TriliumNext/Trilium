/**
 * Resolves Obsidian wikilinks in a rendered note's HTML to Trilium internal links.
 *
 * The Markdown renderer's wikilink extension has already turned `[[Target]]`, `[[Target|alias]]` and
 * `[[Target#heading]]` into `<a class="reference-link" href="/<inner>">…</a>` (the raw target lives in the
 * href). This pass walks those anchors with an HTML parser — never scanning text for `[[…]]` — and splits any
 * `|alias` / `#heading` off with string ops. The target is resolved by name against the imported notes,
 * mirroring Obsidian's shortest-path rule: an exact vault path first, then a unique base name. A name shared
 * by 2+ notes is ambiguous and left unresolved (never guessed), as is a target with no matching note.
 *
 * A resolved link becomes `#root/<noteId>` — a reference link (the live-title chip) when there's no alias, or
 * a plain link carrying the alias text otherwise. An unresolved link is unwrapped to plain text, since
 * Trilium has no dangling-link concept. Attachment links already rewritten by the attachments pass carry a
 * `#root/…` href (not `/…`), so they're skipped. Returns the rewritten HTML and the resolved target note ids
 * for recording `internalLink` relations (backlinks).
 */

import { HTMLElement, parse } from "node-html-parser";

import { escapeHtml } from "../../utils/index.js";
import { basename } from "../../utils/path.js";

export interface NoteIndex {
    /** Lower-cased vault path without `.md` -> noteId (for path-qualified links like `[[Folder/Note]]`). */
    byPath: Map<string, string>;
    /** Lower-cased base name -> noteId, or null when the name is shared by 2+ notes (ambiguous). */
    byName: Map<string, string | null>;
}

export function buildNoteIndex(notes: { note: { noteId: string }; path: string }[]): NoteIndex {
    const byPath = new Map<string, string>();
    const byName = new Map<string, string | null>();
    for (const { note, path } of notes) {
        const key = stripMd(path.toLowerCase());
        byPath.set(key, note.noteId);
        const base = basename(key);
        byName.set(base, byName.has(base) ? null : note.noteId);
    }
    return { byPath, byName };
}

export function resolveLinks(html: string, index: NoteIndex): { html: string; internalLinks: string[]; includeLinks: string[] } {
    // Wikilinks render as a vault-relative `href="/…"` and note embeds as `src="/…"`; nothing to do without one.
    if (!html.includes(`href="/`) && !html.includes(`src="/`)) {
        return { html, internalLinks: [], includeLinks: [] };
    }
    const root = parse(html);
    const internalLinks = new Set<string>();
    const includeLinks = new Set<string>();
    let changed = false;

    for (const anchor of root.querySelectorAll("a")) {
        const href = anchor.getAttribute("href");
        // Only the extension's wikilink placeholders: class `reference-link` + a vault-relative `/…` href.
        // Attachment links (already `#root/…`) and plain Markdown links (no class) are left alone.
        if (!href || !href.startsWith("/") || !(anchor.getAttribute("class") ?? "").includes("reference-link")) {
            continue;
        }
        const { target, alias } = splitWikilink(safeDecode(href.slice(1)));
        const noteId = resolveNote(index, target);
        if (noteId) {
            anchor.setAttribute("href", `#root/${noteId}`);
            if (alias) {
                // A plain link keeps the alias text; a bare link stays a reference link (the live-title chip).
                anchor.removeAttribute("class");
                anchor.set_content(escapeHtml(alias));
            }
            internalLinks.add(noteId);
        } else {
            anchor.insertAdjacentHTML("beforebegin", escapeHtml(alias ?? target));
            anchor.remove();
        }
        changed = true;
    }

    // Note embeds `![[Note]]` arrive as `<img src="/Note">` (the transclusion). One that resolves to a note
    // becomes a Trilium include-note; an attachment image (already `api/attachments/…`) or an unresolved/.base
    // embed is left untouched (the latter for a later pass).
    for (const img of root.querySelectorAll("img")) {
        const src = img.getAttribute("src");
        if (!src || !src.startsWith("/")) {
            continue;
        }
        const { target } = splitWikilink(safeDecode(src.slice(1)));
        const noteId = resolveNote(index, target);
        if (!noteId) {
            // An embed of a database (.base) or whiteboard (.canvas) has no Trilium representation yet, so
            // drop the placeholder rather than leave a broken image; other unresolved embeds are left alone.
            if (isUnsupportedEmbed(target)) {
                removeEmbed(img);
                changed = true;
            }
            continue;
        }
        img.insertAdjacentHTML("beforebegin", `<section class="include-note" data-note-id="${noteId}" data-box-size="medium">&nbsp;</section>`);
        img.remove();
        includeLinks.add(noteId);
        changed = true;
    }

    return { html: changed ? root.toString() : html, internalLinks: [...internalLinks], includeLinks: [...includeLinks] };
}

/** Whether an embed targets a database (`.base`) or whiteboard (`.canvas`) — both unsupported for now. */
function isUnsupportedEmbed(target: string): boolean {
    const lower = target.toLowerCase();
    return lower.endsWith(".base") || lower.endsWith(".canvas");
}

/** Removes an embed element, also dropping its wrapping paragraph if that leaves it empty. */
function removeEmbed(img: HTMLElement): void {
    const parent = img.parentNode;
    img.remove();
    if (parent instanceof HTMLElement && parent.tagName?.toLowerCase() === "p" && (parent.textContent ?? "").trim() === "" && parent.querySelectorAll("img").length === 0) {
        parent.remove();
    }
}

/** Resolves a wikilink target to a noteId: an exact vault path first, then a unique base-name match. */
function resolveNote(index: NoteIndex, target: string): string | null {
    if (!target) {
        return null;
    }
    const key = stripMd(target.toLowerCase());
    return index.byPath.get(key) ?? index.byName.get(basename(key)) ?? null;
}

/** Splits a wikilink's inner text into its target and optional display alias, dropping any `#heading`. */
function splitWikilink(inner: string): { target: string; alias?: string } {
    let target = inner;
    let alias: string | undefined;
    const pipe = target.indexOf("|");
    if (pipe !== -1) {
        alias = target.slice(pipe + 1).trim();
        target = target.slice(0, pipe);
    }
    const hash = target.indexOf("#");
    if (hash !== -1) {
        target = target.slice(0, hash);
    }
    return { target: target.trim(), alias };
}

function stripMd(path: string): string {
    return path.endsWith(".md") ? path.slice(0, -3) : path;
}

function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}
