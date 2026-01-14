import { becca_service } from "@triliumnext/core";

import becca from "../../becca/becca.js";
import {
    calculateOptimizedEditDistance,
    FUZZY_SEARCH_CONFIG,
    normalizeSearchText} from "./utils/text_utils.js";

// Scoring constants for better maintainability
const SCORE_WEIGHTS = {
    NOTE_ID_EXACT_MATCH: 1000,
    TITLE_EXACT_MATCH: 2000,
    TITLE_PREFIX_MATCH: 500,
    TITLE_WORD_MATCH: 300,
    TOKEN_EXACT_MATCH: 4,
    TOKEN_PREFIX_MATCH: 2,
    TOKEN_CONTAINS_MATCH: 1,
    TOKEN_FUZZY_MATCH: 0.5,
    TITLE_FACTOR: 2.0,
    PATH_FACTOR: 0.3,
    HIDDEN_NOTE_PENALTY: 3,
    // Score caps to prevent fuzzy matches from outranking exact matches
    MAX_FUZZY_SCORE_PER_TOKEN: 3, // Cap fuzzy token contributions to stay below exact matches
    MAX_FUZZY_TOKEN_LENGTH_MULTIPLIER: 3, // Limit token length impact for fuzzy matches
    MAX_TOTAL_FUZZY_SCORE: 200 // Total cap on fuzzy scoring per search
} as const;


class SearchResult {
    notePathArray: string[];
    score: number;
    notePathTitle: string;
    highlightedNotePathTitle?: string;
    contentSnippet?: string;
    highlightedContentSnippet?: string;
    attributeSnippet?: string;
    highlightedAttributeSnippet?: string;
    private fuzzyScore: number; // Track fuzzy score separately

    constructor(notePathArray: string[]) {
        this.notePathArray = notePathArray;
        this.notePathTitle = becca_service.getNoteTitleForPath(notePathArray);
        this.score = 0;
        this.fuzzyScore = 0;
    }

    get notePath() {
        return this.notePathArray.join("/");
    }

    get noteId() {
        return this.notePathArray[this.notePathArray.length - 1];
    }

    computeScore(fulltextQuery: string, tokens: string[], enableFuzzyMatching: boolean = true) {
        this.score = 0;
        this.fuzzyScore = 0; // Reset fuzzy score tracking

        const note = becca.notes[this.noteId];
        const normalizedQuery = normalizeSearchText(fulltextQuery.toLowerCase());
        const normalizedTitle = normalizeSearchText(note.title.toLowerCase());

        // Note ID exact match, much higher score
        if (note.noteId.toLowerCase() === fulltextQuery) {
            this.score += SCORE_WEIGHTS.NOTE_ID_EXACT_MATCH;
        }

        // Title matching scores with fuzzy matching support
        if (normalizedTitle === normalizedQuery) {
            this.score += SCORE_WEIGHTS.TITLE_EXACT_MATCH;
        } else if (normalizedTitle.startsWith(normalizedQuery)) {
            this.score += SCORE_WEIGHTS.TITLE_PREFIX_MATCH;
        } else if (this.isWordMatch(normalizedTitle, normalizedQuery)) {
            this.score += SCORE_WEIGHTS.TITLE_WORD_MATCH;
        } else if (enableFuzzyMatching) {
            // Try fuzzy matching for typos only if enabled
            const fuzzyScore = this.calculateFuzzyTitleScore(normalizedTitle, normalizedQuery);
            this.score += fuzzyScore;
            this.fuzzyScore += fuzzyScore; // Track fuzzy score contributions
        }

        // Add scores for token matches
        this.addScoreForStrings(tokens, note.title, SCORE_WEIGHTS.TITLE_FACTOR, enableFuzzyMatching);
        this.addScoreForStrings(tokens, this.notePathTitle, SCORE_WEIGHTS.PATH_FACTOR, enableFuzzyMatching);

        if (note.isInHiddenSubtree()) {
            this.score = this.score / SCORE_WEIGHTS.HIDDEN_NOTE_PENALTY;
        }
    }

    addScoreForStrings(tokens: string[], str: string, factor: number, enableFuzzyMatching: boolean = true) {
        const normalizedStr = normalizeSearchText(str.toLowerCase());
        const chunks = normalizedStr.split(" ");

        let tokenScore = 0;
        for (const chunk of chunks) {
            for (const token of tokens) {
                const normalizedToken = normalizeSearchText(token.toLowerCase());

                if (chunk === normalizedToken) {
                    tokenScore += SCORE_WEIGHTS.TOKEN_EXACT_MATCH * token.length * factor;
                } else if (chunk.startsWith(normalizedToken)) {
                    tokenScore += SCORE_WEIGHTS.TOKEN_PREFIX_MATCH * token.length * factor;
                } else if (chunk.includes(normalizedToken)) {
                    tokenScore += SCORE_WEIGHTS.TOKEN_CONTAINS_MATCH * token.length * factor;
                } else {
                    // Try fuzzy matching for individual tokens with caps applied
                    const editDistance = calculateOptimizedEditDistance(chunk, normalizedToken, FUZZY_SEARCH_CONFIG.MAX_EDIT_DISTANCE);
                    if (editDistance <= FUZZY_SEARCH_CONFIG.MAX_EDIT_DISTANCE &&
                        normalizedToken.length >= FUZZY_SEARCH_CONFIG.MIN_FUZZY_TOKEN_LENGTH &&
                        this.fuzzyScore < SCORE_WEIGHTS.MAX_TOTAL_FUZZY_SCORE) {

                        const fuzzyWeight = SCORE_WEIGHTS.TOKEN_FUZZY_MATCH * (1 - editDistance / FUZZY_SEARCH_CONFIG.MAX_EDIT_DISTANCE);
                        // Apply caps: limit token length multiplier and per-token contribution
                        const cappedTokenLength = Math.min(token.length, SCORE_WEIGHTS.MAX_FUZZY_TOKEN_LENGTH_MULTIPLIER);
                        const fuzzyTokenScore = Math.min(
                            fuzzyWeight * cappedTokenLength * factor,
                            SCORE_WEIGHTS.MAX_FUZZY_SCORE_PER_TOKEN
                        );

                        tokenScore += fuzzyTokenScore;
                        this.fuzzyScore += fuzzyTokenScore;
                    }
                }
            }
        }
        this.score += tokenScore;
    }


    /**
     * Checks if the query matches as a complete word in the text
     */
    private isWordMatch(text: string, query: string): boolean {
        return text.includes(` ${query} `) ||
               text.startsWith(`${query} `) ||
               text.endsWith(` ${query}`);
    }

    /**
     * Calculates fuzzy matching score for title matches with caps applied
     */
    private calculateFuzzyTitleScore(title: string, query: string): number {
        // Check if we've already hit the fuzzy scoring cap
        if (this.fuzzyScore >= SCORE_WEIGHTS.MAX_TOTAL_FUZZY_SCORE) {
            return 0;
        }

        const editDistance = calculateOptimizedEditDistance(title, query, FUZZY_SEARCH_CONFIG.MAX_EDIT_DISTANCE);
        const maxLen = Math.max(title.length, query.length);

        // Only apply fuzzy matching if the query is reasonably long and edit distance is small
        if (query.length >= FUZZY_SEARCH_CONFIG.MIN_FUZZY_TOKEN_LENGTH &&
            editDistance <= FUZZY_SEARCH_CONFIG.MAX_EDIT_DISTANCE &&
            editDistance / maxLen <= 0.3) {
            const similarity = 1 - (editDistance / maxLen);
            const baseFuzzyScore = SCORE_WEIGHTS.TITLE_WORD_MATCH * similarity * 0.7; // Reduced weight for fuzzy matches

            // Apply cap to ensure fuzzy title matches don't exceed reasonable bounds
            return Math.min(baseFuzzyScore, SCORE_WEIGHTS.MAX_TOTAL_FUZZY_SCORE * 0.3);
        }

        return 0;
    }

}

export default SearchResult;
