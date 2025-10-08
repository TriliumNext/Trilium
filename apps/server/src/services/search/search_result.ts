"use strict";

import beccaService from "../../becca/becca_service.js";
import becca from "../../becca/becca.js";
import {
    normalizeSearchText,
    calculateOptimizedEditDistance,
    FUZZY_SEARCH_CONFIG
} from "./utils/text_utils.js";

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
        this.notePathTitle = beccaService.getNoteTitleForPath(notePathArray);
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

        // ----------------------------------------------------
        // CONSTANTS — tweaking
        // ----------------------------------------------------
        const TITLE_MATCH_FACTOR = 1.0;
        const LABEL_TITLE_WEIGHT_FACTOR = 0.95;
        const ATTR_TITLE_WEIGHT_FACTOR = 0.95;
        const ATTRIBUTE_BREADTH_FACTOR = 0.25; // <— bonus fraction for multiple relevant attributes

        // ----------------------------------------------------
        // NOTE ID + TITLE SCORING
        // ----------------------------------------------------
        if (note.noteId.toLowerCase() === fulltextQuery) {
            this.score += SCORE_WEIGHTS.NOTE_ID_EXACT_MATCH;
        }

        switch (true) {
            case normalizedTitle === normalizedQuery:
                this.score += SCORE_WEIGHTS.TITLE_EXACT_MATCH * TITLE_MATCH_FACTOR;
                break;

            case normalizedTitle.startsWith(normalizedQuery):
                this.score += SCORE_WEIGHTS.TITLE_PREFIX_MATCH * TITLE_MATCH_FACTOR;
                break;

            case this.isWordMatch(normalizedTitle, normalizedQuery):
                this.score += SCORE_WEIGHTS.TITLE_WORD_MATCH * TITLE_MATCH_FACTOR;
                break;

            case enableFuzzyMatching: {
                const fuzzyScore = this.calculateFuzzyTitleScore(normalizedTitle, normalizedQuery);
                this.score += fuzzyScore;
                this.fuzzyScore += fuzzyScore;
                break;
            }

            default:
                // no match
                break;
        }

        // Token-level scoring
        this.addScoreForStrings(tokens, note.title, SCORE_WEIGHTS.TITLE_FACTOR * TITLE_MATCH_FACTOR, enableFuzzyMatching);
        this.addScoreForStrings(tokens, this.notePathTitle, SCORE_WEIGHTS.PATH_FACTOR, enableFuzzyMatching);

        // ----------------------------------------------------
        // ATTRIBUTE / LABEL SCORING
        // ----------------------------------------------------
        //
        // WHY:
        // Each note can have many attributes (labels, metadata, etc.).
        // We take the *highest* attribute match as the main relevance driver,
        // but also give a small bonus for having multiple moderately relevant
        // attributes — this balances precision (best match) with breadth (coverage).
        //
        const attributes = note.getAttributes?.() || [];

        let maxAttrScore = 0; // best single attribute score
        let maxAttrFuzzy = 0; // best single fuzzy score
        let totalAttrScore = 0; // sum of all attribute scores
        let totalAttrFuzzy = 0; // sum of all fuzzy scores

        for (const attr of attributes) {
            const attrName = normalizeSearchText(attr.name?.toLowerCase() || "");
            const attrValue = normalizeSearchText(attr.value?.toLowerCase() || "");
            const attrType = attr.type || "";

            const attrWeightFactor =
                attrType === "label" ? LABEL_TITLE_WEIGHT_FACTOR : ATTR_TITLE_WEIGHT_FACTOR;

            // best score for this specific attribute (name/value pair)
            let bestCandidateScore = 0;
            let bestCandidateFuzzy = 0;

            for (const candidate of [attrName, attrValue]) {
                if (!candidate) continue;

                let candidateScore = 0;

                if (candidate === normalizedQuery) {
                    candidateScore = SCORE_WEIGHTS.TITLE_EXACT_MATCH * attrWeightFactor;
                } else if (candidate.startsWith(normalizedQuery)) {
                    candidateScore = SCORE_WEIGHTS.TITLE_PREFIX_MATCH * attrWeightFactor;
                } else if (this.isWordMatch(candidate, normalizedQuery)) {
                    candidateScore = SCORE_WEIGHTS.TITLE_WORD_MATCH * attrWeightFactor;
                } else if (enableFuzzyMatching) {
                    const fuzzyScore =
                        this.calculateFuzzyTitleScore(candidate, normalizedQuery) * attrWeightFactor;
                    candidateScore = fuzzyScore;
                    bestCandidateFuzzy = Math.max(bestCandidateFuzzy, fuzzyScore);
                }

                bestCandidateScore = Math.max(bestCandidateScore, candidateScore);

                this.addScoreForStrings(
                    tokens,
                    candidate,
                    SCORE_WEIGHTS.TITLE_FACTOR * attrWeightFactor,
                    enableFuzzyMatching
                );
            }

            maxAttrScore = Math.max(maxAttrScore, bestCandidateScore);
            maxAttrFuzzy = Math.max(maxAttrFuzzy, bestCandidateFuzzy);
            totalAttrScore += bestCandidateScore;
            totalAttrFuzzy += bestCandidateFuzzy;
        }

        // Combine precision (best) with breadth (extra small bonus for other matches)
        const hybridAttrScore = maxAttrScore + ATTRIBUTE_BREADTH_FACTOR * (totalAttrScore - maxAttrScore);
        const hybridAttrFuzzy = maxAttrFuzzy + ATTRIBUTE_BREADTH_FACTOR * (totalAttrFuzzy - maxAttrFuzzy);

        this.score += hybridAttrScore;
        this.fuzzyScore += hybridAttrFuzzy;

        // ----------------------------------------------------
        // VISIBILITY PENALTY
        // ----------------------------------------------------
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
