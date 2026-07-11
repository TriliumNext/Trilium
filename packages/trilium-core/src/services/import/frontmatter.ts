/**
 * Generic YAML front matter parsing for Markdown imports.
 *
 * A Markdown file may begin with a `---\n…\n---` YAML block — the de-facto convention shared by Obsidian,
 * Jekyll, Hugo, Foam and others. This module splits that block off the body and turns each property into a
 * Trilium label: the name is sanitized to a camelCase attribute name with the same {@link toAttributeName}
 * helper the structured importers (Notion, Anytype) use, and the value is stringified (a list yields one
 * label per item). It is deliberately format-agnostic and infers no semantic types — date/number/checkbox
 * typing and special keys (tags, aliases) layer on top of this in the format-specific importer.
 */

import { load } from "js-yaml";

import { toAttributeName } from "./collection_utils.js";

export interface FrontmatterAttribute {
    name: string;
    value: string;
}

export interface ParsedFrontmatter {
    /** The Markdown with the leading front matter block removed. */
    body: string;
    /** One label per scalar property, or per item of a list property. */
    attributes: FrontmatterAttribute[];
}

/**
 * Splits the leading front matter block off the body and returns the raw parsed YAML mapping (the un-mapped
 * `key → value`, for callers that apply their own typing/semantics, e.g. the Obsidian importer). Returns an
 * empty mapping when there's no block, when the YAML is malformed (the block is then left in the body), or
 * when the block isn't a key/value mapping (a scalar/list block is stripped but yields no data).
 */
export function parseFrontmatter(markdown: string): { body: string; data: Record<string, unknown> } {
    const block = matchFrontmatter(markdown);
    if (!block) {
        return { body: markdown, data: {} };
    }

    let data: unknown;
    try {
        data = load(block.yaml);
    } catch {
        // Malformed YAML isn't something we can trust, so leave the note untouched — body and block alike.
        return { body: markdown, data: {} };
    }
    // A structurally-valid (possibly empty) block is stripped either way; only a key/value mapping carries data.
    return { body: block.body, data: isRecord(data) ? data : {} };
}

export function extractFrontmatter(markdown: string): ParsedFrontmatter {
    const { body, data } = parseFrontmatter(markdown);

    const attributes: FrontmatterAttribute[] = [];
    for (const [key, value] of Object.entries(data)) {
        const name = toAttributeName(key);
        for (const scalar of toValues(value)) {
            attributes.push({ name, value: scalar });
        }
    }
    return { body, attributes };
}

/** Splits a leading `---\n…\n---` block (front matter must start at the very first line) from the body. */
function matchFrontmatter(markdown: string): { yaml: string; body: string } | null {
    const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown);
    if (!match) {
        return null;
    }
    return { yaml: match[1], body: markdown.slice(match[0].length) };
}

/** Flattens a YAML value into the string label values it maps to (a list yields one per item). */
function toValues(value: unknown): string[] {
    if (value === null || value === undefined) {
        return [""];
    }
    if (Array.isArray(value)) {
        return value.flatMap(toValues);
    }
    if (typeof value === "boolean") {
        return [value ? "true" : "false"];
    }
    if (typeof value === "number") {
        return [String(value)];
    }
    if (typeof value === "string") {
        return [value];
    }
    /* v8 ignore next 3 -- defensive: js-yaml's `load` schema resolves timestamps to strings, never Date objects */
    if (value instanceof Date) {
        return [value.toISOString()];
    }
    // A nested mapping has no flat label representation, so it's skipped.
    return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
