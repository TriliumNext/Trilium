/**
 * Notion-export identity helpers. Every page Notion exports carries a 32-character hex id appended to its
 * file name ("Page Title <id>.html"), and internal links reference those same names. These helpers
 * extract and strip those ids.
 *
 * Ported from Obsidian's importer (https://github.com/obsidianmd/obsidian-importer,
 * src/formats/notion/notion-utils.ts), MIT-licensed, © 2023 Obsidian.
 */

/** Strips the trailing Notion id (and its separating space/hyphen) from a name, keeping the extension. */
export function stripNotionId(id: string): string {
    return id.replace(/-/g, "").replace(/[ -]?[a-z0-9]{32}(\.|$)/, "$1");
}

/** Extracts the 32-hex Notion id embedded at the end of a filename or URL path, or undefined if absent. */
export function getNotionId(id: string): string | undefined {
    return id.replace(/-/g, "").match(/([a-z0-9]{32})(\?|\.|$)/)?.[1];
}
