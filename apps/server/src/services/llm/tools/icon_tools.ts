/**
 * LLM tools for finding note icons across the available icon packs.
 */

import { icon_packs } from "@triliumnext/core";
import { z } from "zod";

import { defineTools } from "./tool_registry.js";

const DEFAULT_LIMIT = 20;

export const iconTools = defineTools({
    search_icons: {
        description: [
            "Search the available icon packs (e.g. Boxicons) for a note icon by keyword.",
            "Returns icon classes such as 'bx bx-rocket', ordered by relevance.",
            "To give a note an icon, assign the icon class to the note's 'iconClass' label via set_attribute.",
            "ALWAYS use this instead of prepending an emoji to a note's title."
        ].join(" "),
        inputSchema: z.object({
            query: z.string().describe("One or more keywords describing the desired icon, e.g. 'rocket' or 'building landmark monument'. Keywords are matched individually, so listing several synonyms is safe: icons matching more of them rank first."),
            limit: z.number().optional().describe("Maximum number of icons to return. Defaults to 20.")
        }),
        execute: ({ query, limit = DEFAULT_LIMIT }) => {
            const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
            if (!keywords.length) {
                return { error: "Query must not be empty" };
            }

            const matches: { iconClass: string; terms: string[]; score: IconScore }[] = [];
            for (const pack of icon_packs.getIconPacks()) {
                for (const [name, icon] of Object.entries(pack.manifest.icons)) {
                    if (!name || !icon?.terms) {
                        continue;
                    }
                    const score = scoreIcon(name, icon.terms, keywords);
                    if (score.matched > 0) {
                        matches.push({ iconClass: `${pack.prefix} ${name}`, terms: icon.terms, score });
                    }
                }
            }
            matches.sort((a, b) => b.score.matched - a.score.matched || b.score.quality - a.score.quality);

            return {
                totalResults: matches.length,
                results: matches.slice(0, limit).map(({ iconClass, terms }) => ({ iconClass, terms }))
            };
        }
    }
});

export interface IconScore {
    /** How many of the keywords matched the icon at all. Primary ranking signal. */
    matched: number;
    /** How well those keywords matched: 2 per exact match, 1 per substring match. */
    quality: number;
}

/**
 * Score an icon against the search keywords. A keyword matches if it occurs in
 * the icon name or one of its terms; exact matches on a term or on a
 * hyphen-separated segment of a term ("circle" in "check-circle") rank above
 * plain substring matches.
 *
 * Keywords are scored independently rather than required all at once, because
 * callers (an LLM in particular) tend to describe an icon with several loosely
 * related words — "building landmark monument" — where no single icon carries
 * every one of them. Icons matching more keywords still sort first.
 */
export function scoreIcon(name: string, terms: string[], keywords: string[]): IconScore {
    const score: IconScore = { matched: 0, quality: 0 };
    for (const keyword of keywords) {
        if (terms.some((term) => term === keyword || term.split("-").includes(keyword))) {
            score.matched++;
            score.quality += 2;
        } else if (terms.some((term) => term.includes(keyword)) || name.includes(keyword)) {
            score.matched++;
            score.quality += 1;
        }
    }
    return score;
}
