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
            query: z.string().describe("One or more keywords describing the desired icon, e.g. 'rocket' or 'check circle'"),
            limit: z.number().optional().describe("Maximum number of icons to return. Defaults to 20.")
        }),
        execute: ({ query, limit = DEFAULT_LIMIT }) => {
            const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
            if (!keywords.length) {
                return { error: "Query must not be empty" };
            }

            const matches: { iconClass: string; terms: string[]; score: number }[] = [];
            for (const pack of icon_packs.getIconPacks()) {
                for (const [name, icon] of Object.entries(pack.manifest.icons)) {
                    if (!name || !icon?.terms) {
                        continue;
                    }
                    const score = scoreIcon(name, icon.terms, keywords);
                    if (score > 0) {
                        matches.push({ iconClass: `${pack.prefix} ${name}`, terms: icon.terms, score });
                    }
                }
            }
            matches.sort((a, b) => b.score - a.score);

            return {
                totalResults: matches.length,
                results: matches.slice(0, limit).map(({ iconClass, terms }) => ({ iconClass, terms }))
            };
        }
    }
});

/**
 * Score an icon against the search keywords. Every keyword must match the icon
 * name or one of its terms, otherwise the icon is rejected (score 0). Exact
 * matches on a term or on a hyphen-separated segment of a term ("circle" in
 * "check-circle") rank above plain substring matches.
 */
export function scoreIcon(name: string, terms: string[], keywords: string[]): number {
    let score = 0;
    for (const keyword of keywords) {
        if (terms.some((term) => term === keyword || term.split("-").includes(keyword))) {
            score += 2;
        } else if (terms.some((term) => term.includes(keyword)) || name.includes(keyword)) {
            score += 1;
        } else {
            return 0;
        }
    }
    return score;
}
