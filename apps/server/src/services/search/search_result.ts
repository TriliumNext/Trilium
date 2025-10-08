"use strict";

import beccaService from "../../becca/becca_service.js";
import becca from "../../becca/becca.js";
import {
    normalizeSearchText,
    calculateOptimizedEditDistance,
    FUZZY_SEARCH_CONFIG
} from "./utils/text_utils.js";

// ----------------------------------------------------
// SCORE WEIGHTS — all fixed absolute point values
// ----------------------------------------------------
const SCORE_WEIGHTS = {
    // NOTE ID (highest importance)
    NOTE_ID_EXACT_MATCH: 1000,

    // TITLE relevance
    TITLE_EXACT_MATCH: 900,
    LABEL_VALUE_EXACT_MATCH: 880,
    TITLE_PREFIX_MATCH: 850,
    LABEL_VALUE_PREFIX_MATCH: 840,
    TITLE_WORD_MATCH: 800,
    LABEL_VALUE_WORD_MATCH: 790,

    LABEL_KEY_EXACT_MATCH: 600,
    LABEL_KEY_PREFIX_MATCH: 580,
    LABEL_KEY_WORD_MATCH: 560,

    TITLE_FUZZY_MATCH: 750,
    LABEL_VALUE_FUZZY_MATCH: 560,
    LABEL_KEY_FUZZY_MATCH: 540,

    // TOKEN-level relevance
    TOKEN_EXACT_MATCH: 120,
    TOKEN_PREFIX_MATCH: 110,
    TOKEN_CONTAINS_MATCH: 105,
    TOKEN_FUZZY_MATCH: 100,

    // Penalties / limits
    HIDDEN_NOTE_PENALTY: 3,               // divisor for hidden notes
    MAX_TOTAL_FUZZY_SCORE: 100,           // total cap on fuzzy scoring per search
    MAX_FUZZY_SCORE_PER_TOKEN: 3,         // fuzzy token contribution cap
    MAX_FUZZY_TOKEN_LENGTH_MULTIPLIER: 3  // token length multiplier cap
} as const;

// ----------------------------------------------------
// SEARCH RESULT CLASS
// ----------------------------------------------------
class SearchResult {
    notePathArray: string[];
    score: number;
    notePathTitle: string;
    highlightedNotePathTitle?: string;
    contentSnippet?: string;
    highlightedContentSnippet?: string;
    attributeSnippet?: string;
    highlightedAttributeSnippet?: string;
    private fuzzyScore: number;

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

    private getBestTokenScore(tokens: string[], str: string, enableFuzzyMatching: boolean = true): number {
        const normalizedStr = normalizeSearchText(str.toLowerCase());
        const chunks = normalizedStr.split(" ");
        let bestTokenScore = 0;

        for (const chunk of chunks) {
            for (const token of tokens) {
                const normalizedToken = normalizeSearchText(token.toLowerCase());
                let currentScore = 0;

                switch (true) {
                    case (chunk === normalizedToken): {
                        currentScore = SCORE_WEIGHTS.TOKEN_EXACT_MATCH;
                        break;
                    }
                    case (chunk.startsWith(normalizedToken)): {
                        currentScore = SCORE_WEIGHTS.TOKEN_PREFIX_MATCH;
                        break;
                    }
                    case (chunk.includes(normalizedToken)): {
                        currentScore = SCORE_WEIGHTS.TOKEN_CONTAINS_MATCH;
                        break;
                    }
                    case (enableFuzzyMatching): {
                        const editDistance = calculateOptimizedEditDistance(chunk, normalizedToken, FUZZY_SEARCH_CONFIG.MAX_EDIT_DISTANCE);
                        if (
                            editDistance <= FUZZY_SEARCH_CONFIG.MAX_EDIT_DISTANCE &&
                                normalizedToken.length >= FUZZY_SEARCH_CONFIG.MIN_FUZZY_TOKEN_LENGTH &&
                                this.fuzzyScore < SCORE_WEIGHTS.MAX_TOTAL_FUZZY_SCORE
                        ) {
                            const fuzzyWeight = SCORE_WEIGHTS.TOKEN_FUZZY_MATCH * (1 - editDistance / FUZZY_SEARCH_CONFIG.MAX_EDIT_DISTANCE);
                            const cappedLen = Math.min(token.length, SCORE_WEIGHTS.MAX_FUZZY_TOKEN_LENGTH_MULTIPLIER);
                            const fuzzyTokenScore = Math.min(
                                fuzzyWeight * cappedLen,
                                SCORE_WEIGHTS.MAX_FUZZY_SCORE_PER_TOKEN
                            );
                            currentScore = fuzzyTokenScore;
                            this.fuzzyScore += fuzzyTokenScore;
                        }
                        break;
                    }
                    default: {
                        break;
                    }
                }

                bestTokenScore = Math.max(bestTokenScore, currentScore);
            }
        }

        return bestTokenScore;
    }

    computeScore(fulltextQuery: string, tokens: string[], enableFuzzyMatching: boolean = true) {
        const note = becca.notes[this.noteId];
        const normalizedQuery = normalizeSearchText(fulltextQuery.toLowerCase());
        const normalizedTitle = normalizeSearchText(note.title.toLowerCase());

        this.score = 0;
        this.fuzzyScore = 0;

        // ----------------------------------------------------
        // NOTE ID MATCH — immediate return if perfect
        // ----------------------------------------------------
        if (note.noteId.toLowerCase() === fulltextQuery) {
            this.score = SCORE_WEIGHTS.NOTE_ID_EXACT_MATCH;
            return this.score;
        }

        // ----------------------------------------------------
        // TITLE MATCHING
        // ----------------------------------------------------
        let titleScore = 0;

        switch (true) {
            case (normalizedTitle === normalizedQuery): {
                titleScore = SCORE_WEIGHTS.TITLE_EXACT_MATCH;
                break;
            }
            case (normalizedTitle.startsWith(normalizedQuery)): {
                titleScore = SCORE_WEIGHTS.TITLE_PREFIX_MATCH;
                break;
            }
            case (this.isWordMatch(normalizedTitle, normalizedQuery)): {
                titleScore = SCORE_WEIGHTS.TITLE_WORD_MATCH;
                break;
            }
            case (enableFuzzyMatching): {
                const fuzzyScore = this.calculateFuzzyTitleScore(normalizedTitle, normalizedQuery);
                if (fuzzyScore > 0) {
                    titleScore = SCORE_WEIGHTS.TITLE_FUZZY_MATCH;
                    this.fuzzyScore += fuzzyScore;
                }
                break;
            }
            default: {
                break;
            }
        }

        // ----------------------------------------------------
        // LABEL SCORING — best key + best value
        // ----------------------------------------------------
        const labels = note.getLabels?.() || [];
        let bestLabelKeyScore = 0;
        let bestLabelValueScore = 0;

        for (const label of labels) {
            const key = normalizeSearchText(label.name?.toLowerCase() || "");
            const value = normalizeSearchText(label.value?.toLowerCase() || "");

            // ---- Key scoring ----
            if (key) {
                let keyScore = 0;

                switch (true) {
                    case (key === normalizedQuery): {
                        keyScore = SCORE_WEIGHTS.LABEL_KEY_EXACT_MATCH;
                        break;
                    }
                    case (key.startsWith(normalizedQuery)): {
                        keyScore = SCORE_WEIGHTS.LABEL_KEY_PREFIX_MATCH;
                        break;
                    }
                    case (this.isWordMatch(key, normalizedQuery)): {
                        keyScore = SCORE_WEIGHTS.LABEL_KEY_WORD_MATCH;
                        break;
                    }
                    case (enableFuzzyMatching): {
                        const fuzzyScore = this.calculateFuzzyTitleScore(key, normalizedQuery);
                        if (fuzzyScore > 0) {
                            keyScore = SCORE_WEIGHTS.LABEL_KEY_FUZZY_MATCH;
                            this.fuzzyScore += fuzzyScore;
                        }
                        break;
                    }
                    default: {
                        break;
                    }
                }

                bestLabelKeyScore = Math.max(bestLabelKeyScore, keyScore);
            }

            // ---- Value scoring ----
            if (value) {
                let valueScore = 0;

                switch (true) {
                    case (value === normalizedQuery): {
                        valueScore = SCORE_WEIGHTS.LABEL_VALUE_EXACT_MATCH;
                        break;
                    }
                    case (value.startsWith(normalizedQuery)): {
                        valueScore = SCORE_WEIGHTS.LABEL_VALUE_PREFIX_MATCH;
                        break;
                    }
                    case (this.isWordMatch(value, normalizedQuery)): {
                        valueScore = SCORE_WEIGHTS.LABEL_VALUE_WORD_MATCH;
                        break;
                    }
                    case (enableFuzzyMatching): {
                        const fuzzyScore = this.calculateFuzzyTitleScore(value, normalizedQuery);
                        if (fuzzyScore > 0) {
                            valueScore = SCORE_WEIGHTS.LABEL_VALUE_FUZZY_MATCH;
                            this.fuzzyScore += fuzzyScore;
                        }
                        break;
                    }
                    default: {
                        break;
                    }
                }

                bestLabelValueScore = Math.max(bestLabelValueScore, valueScore);
            }
        }

        // ----------------------------------------------------
        // TOKEN MATCHING — take best single token match
        // ----------------------------------------------------
        let tokenScore = 0;
        tokenScore = Math.max(
            this.getBestTokenScore(tokens, note.title, enableFuzzyMatching),
            this.getBestTokenScore(tokens, this.notePathTitle, enableFuzzyMatching)
        );

        // ----------------------------------------------------
        // FINAL SCORE — take the strongest category
        // ----------------------------------------------------
        this.score = Math.max(
            titleScore,
            bestLabelKeyScore,
            bestLabelValueScore,
            tokenScore
        );

        // ----------------------------------------------------
        // VISIBILITY PENALTY
        // ----------------------------------------------------
        if (note.isInHiddenSubtree()) {
            this.score = this.score / SCORE_WEIGHTS.HIDDEN_NOTE_PENALTY;
        }
    }

    // TOKEN MATCHING
    addScoreForStrings(tokens: string[], str: string, enableFuzzyMatching: boolean = true) {
        const normalizedStr = normalizeSearchText(str.toLowerCase());
        const chunks = normalizedStr.split(" ");
        let tokenScore = 0;

        for (const chunk of chunks) {
            for (const token of tokens) {
                const normalizedToken = normalizeSearchText(token.toLowerCase());

                if (chunk === normalizedToken) {
                    tokenScore += SCORE_WEIGHTS.TOKEN_EXACT_MATCH;
                } else if (chunk.startsWith(normalizedToken)) {
                    tokenScore += SCORE_WEIGHTS.TOKEN_PREFIX_MATCH;
                } else if (chunk.includes(normalizedToken)) {
                    tokenScore += SCORE_WEIGHTS.TOKEN_CONTAINS_MATCH;
                } else if (enableFuzzyMatching) {
                    const editDistance = calculateOptimizedEditDistance(chunk, normalizedToken, FUZZY_SEARCH_CONFIG.MAX_EDIT_DISTANCE);
                    if (
                        editDistance <= FUZZY_SEARCH_CONFIG.MAX_EDIT_DISTANCE &&
                        normalizedToken.length >= FUZZY_SEARCH_CONFIG.MIN_FUZZY_TOKEN_LENGTH &&
                        this.fuzzyScore < SCORE_WEIGHTS.MAX_TOTAL_FUZZY_SCORE
                    ) {
                        const fuzzyWeight = SCORE_WEIGHTS.TOKEN_FUZZY_MATCH * (1 - editDistance / FUZZY_SEARCH_CONFIG.MAX_EDIT_DISTANCE);
                        const cappedLen = Math.min(token.length, SCORE_WEIGHTS.MAX_FUZZY_TOKEN_LENGTH_MULTIPLIER);
                        const fuzzyTokenScore = Math.min(
                            fuzzyWeight * cappedLen,
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

    // HELPERS
    private isWordMatch(text: string, query: string): boolean {
        return text.includes(` ${query} `) ||
            text.startsWith(`${query} `) ||
            text.endsWith(` ${query}`);
    }

    private calculateFuzzyTitleScore(title: string, query: string): number {
        if (this.fuzzyScore >= SCORE_WEIGHTS.MAX_TOTAL_FUZZY_SCORE) {
            return 0;
        }

        const editDistance = calculateOptimizedEditDistance(title, query, FUZZY_SEARCH_CONFIG.MAX_EDIT_DISTANCE);
        const maxLen = Math.max(title.length, query.length);

        if (
            query.length >= FUZZY_SEARCH_CONFIG.MIN_FUZZY_TOKEN_LENGTH &&
            editDistance <= FUZZY_SEARCH_CONFIG.MAX_EDIT_DISTANCE &&
            editDistance / maxLen <= 0.3
        ) {
            const similarity = 1 - (editDistance / maxLen);
            const baseScore = SCORE_WEIGHTS.TITLE_FUZZY_MATCH * similarity;
            return Math.min(baseScore, SCORE_WEIGHTS.MAX_TOTAL_FUZZY_SCORE * 0.3);
        }

        return 0;
    }
}

export default SearchResult;
