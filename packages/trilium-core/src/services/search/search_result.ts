import becca from "../../becca/becca.js";
import becca_service, { type SegmentTitleCache } from "../../becca/becca_service.js";
import type { ContentMatchQuality } from "./match_quality.js";
import {
    calculateOptimizedEditDistance,
    FUZZY_SEARCH_CONFIG,
    getAutoMaxEditDistance,
    normalizeSearchText,
    stripWordPunctuation,
    tokenizeIntoWords,
    tokenizeNormalizedText,
    wordsContainPhrase} from "./utils/text_utils.js";

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
    // Content match weights (body content quality), by tier. The maximum possible
    // content contribution is exact_phrase (150) + the four-token bonus (4 x 5 = 20)
    // = 170, which stays below TITLE_WORD_MATCH (300) by construction so an
    // exact/prefix/word title match always outranks a content-only match.
    CONTENT_EXACT_PHRASE: 150,
    CONTENT_PROXIMITY: 80,
    CONTENT_IN_ORDER_BONUS: 20, // only when tier === "proximity" && inOrder
    CONTENT_EXACT_WORD: 60,
    CONTENT_WORD_PREFIX: 30,
    CONTENT_SUBSTRING: 15,
    CONTENT_FUZZY: 5,
    CONTENT_TOKEN_COUNT_BONUS: 5, // per distinct matched token beyond the first, capped at 5 tokens total
    // Score caps to prevent fuzzy matches from outranking exact matches
    MAX_FUZZY_SCORE_PER_TOKEN: 3, // Cap fuzzy token contributions to stay below exact matches
    MAX_FUZZY_TOKEN_LENGTH_MULTIPLIER: 3, // Limit token length impact for fuzzy matches
    MAX_TOTAL_FUZZY_SCORE: 200 // Total cap on fuzzy scoring per search
} as const;


/**
 * The query-side strings every result is scored against. They depend on the query alone, so
 * `performSearch` derives them once and hands the same bundle to every result.
 */
export interface ScoringTerms {
    normalizedQuery: string;
    queryWords: string[];
    normalizedTokens: string[];
    /**
     * Words per path segment title. Results under the same ancestors repeat those titles, so one
     * search tokenizes each distinct segment once instead of once per result.
     */
    pathSegmentWords: Map<string, string[]>;
}

export function precomputeScoringTerms(fulltextQuery: string, tokens: string[]): ScoringTerms {
    const normalizedQuery = normalizeSearchText(fulltextQuery);

    return {
        normalizedQuery,
        queryWords: tokenizeNormalizedText(normalizedQuery),
        normalizedTokens: tokens.map((token) => stripWordPunctuation(normalizeSearchText(token))),
        pathSegmentWords: new Map()
    };
}

class SearchResult {
    notePathArray: string[];
    score: number;
    private segmentTitles?: SegmentTitleCache;
    private __pathTitleSegments?: string[];
    private __notePathTitle?: string;
    highlightedNotePathTitle?: string;
    contentSnippet?: string;
    highlightedContentSnippet?: string;
    attributeSnippet?: string;
    highlightedAttributeSnippet?: string;
    private fuzzyScore: number; // Track fuzzy score separately

    constructor(notePathArray: string[], segmentTitles?: SegmentTitleCache) {
        this.notePathArray = notePathArray;
        this.segmentTitles = segmentTitles;
        this.score = 0;
        this.fuzzyScore = 0;
    }

    /**
     * Resolved on demand. Ranking scores far more results than it returns, and only the ones that
     * survive to the second pass need their path spelled out.
     */
    private get pathTitleSegments(): string[] {
        if (!this.__pathTitleSegments) {
            this.__pathTitleSegments = becca_service.getNoteTitleArrayForPath(this.notePathArray, this.segmentTitles);
        }

        return this.__pathTitleSegments;
    }

    get notePathTitle(): string {
        if (this.__notePathTitle === undefined) {
            this.__notePathTitle = this.pathTitleSegments.join(" › ");
        }

        return this.__notePathTitle;
    }

    get notePath() {
        return this.notePathArray.join("/");
    }

    get noteId() {
        return this.notePathArray[this.notePathArray.length - 1];
    }

    computeScore(fulltextQuery: string, tokens: string[], enableFuzzyMatching: boolean = true, contentMatch?: ContentMatchQuality, terms?: ScoringTerms, includePathScore: boolean = true) {
        this.score = 0;
        this.fuzzyScore = 0; // Reset fuzzy score tracking

        const note = becca.notes[this.noteId];
        const { normalizedQuery, queryWords, normalizedTokens, pathSegmentWords } = terms ?? precomputeScoringTerms(fulltextQuery, tokens);
        // normalizeSearchText already lowercases — no need for .toLowerCase() first
        const { normalized: normalizedTitle, words: titleWords } = note.getSearchableTitle();

        // Note ID exact match, much higher score
        if (note.noteId.toLowerCase() === fulltextQuery) {
            this.score += SCORE_WEIGHTS.NOTE_ID_EXACT_MATCH;
        }

        // Title matching scores with fuzzy matching support
        if (normalizedTitle === normalizedQuery) {
            this.score += SCORE_WEIGHTS.TITLE_EXACT_MATCH;
        } else if (normalizedTitle.startsWith(normalizedQuery)) {
            this.score += SCORE_WEIGHTS.TITLE_PREFIX_MATCH;
        } else if (wordsContainPhrase(titleWords, queryWords)) {
            this.score += SCORE_WEIGHTS.TITLE_WORD_MATCH;
        } else if (enableFuzzyMatching) {
            // Try fuzzy matching for typos only if enabled
            const fuzzyScore = this.calculateFuzzyTitleScore(normalizedTitle, normalizedQuery);
            this.score += fuzzyScore;
            this.fuzzyScore += fuzzyScore; // Track fuzzy score contributions
        }

        // Add scores for token matches
        this.addScoreForChunks(titleWords, tokens, SCORE_WEIGHTS.TITLE_FACTOR, enableFuzzyMatching, normalizedTokens);
        if (includePathScore) {
            this.addScoreForChunks(this.getPathWords(pathSegmentWords), tokens, SCORE_WEIGHTS.PATH_FACTOR, enableFuzzyMatching, normalizedTokens);
        }

        // Add score for how well the note's body content matched the query.
        if (contentMatch) {
            this.addContentScore(contentMatch);
        }

        if (note.isInHiddenSubtree()) {
            this.score = this.score / SCORE_WEIGHTS.HIDDEN_NOTE_PENALTY;
        }
    }

    /**
     * Adds the content-match contribution for a note's body. The tier weight plus a
     * per-token bonus (capped at five tokens) is bounded well below the title
     * weights, so content quality can reorder equally-titled notes without ever
     * overtaking a title match. Fuzzy-tier content counts toward the shared fuzzy
     * budget so it cannot help a fuzzy result outrank an exact one.
     */
    private addContentScore(contentMatch: ContentMatchQuality) {
        let base = 0;
        switch (contentMatch.tier) {
            case "exact_phrase":
                base = SCORE_WEIGHTS.CONTENT_EXACT_PHRASE;
                break;
            case "proximity":
                base = SCORE_WEIGHTS.CONTENT_PROXIMITY + (contentMatch.inOrder ? SCORE_WEIGHTS.CONTENT_IN_ORDER_BONUS : 0);
                break;
            case "exact_word":
                base = SCORE_WEIGHTS.CONTENT_EXACT_WORD;
                break;
            case "word_prefix":
                base = SCORE_WEIGHTS.CONTENT_WORD_PREFIX;
                break;
            case "substring":
                base = SCORE_WEIGHTS.CONTENT_SUBSTRING;
                break;
            case "fuzzy":
                base = SCORE_WEIGHTS.CONTENT_FUZZY;
                break;
        }

        const cappedTokens = Math.min(contentMatch.matchedTokenCount, 5);
        const tokenBonus = SCORE_WEIGHTS.CONTENT_TOKEN_COUNT_BONUS * Math.max(0, cappedTokens - 1);
        let contentScore = base + tokenBonus;

        if (contentMatch.tier === "fuzzy") {
            if (this.fuzzyScore >= SCORE_WEIGHTS.MAX_TOTAL_FUZZY_SCORE) {
                contentScore = 0;
            } else {
                this.fuzzyScore += contentScore;
            }
        }

        this.score += contentScore;
    }

    addScoreForStrings(tokens: string[], str: string, factor: number, enableFuzzyMatching: boolean = true, precomputedTokens?: string[]) {
        // Tokenize (strip boundary punctuation) so a chunk like "(sync)" scores as
        // an exact token match for "sync" rather than only a contains match.
        const chunks = tokenizeIntoWords(str);
        const normalizedTokens = precomputedTokens ?? tokens.map(t => stripWordPunctuation(normalizeSearchText(t)));

        this.addScoreForChunks(chunks, tokens, factor, enableFuzzyMatching, normalizedTokens);
    }

    /**
     * The words of `notePathTitle`. Splitting on whitespace drops the " › " separators, so tokenizing
     * each segment and concatenating yields exactly what tokenizing the joined title would.
     */
    private getPathWords(cache: Map<string, string[]>): string[] {
        const words: string[] = [];

        for (const segment of this.pathTitleSegments) {
            let segmentWords = cache.get(segment);

            if (!segmentWords) {
                segmentWords = tokenizeIntoWords(segment);
                cache.set(segment, segmentWords);
            }

            words.push(...segmentWords);
        }

        return words;
    }

    /** Scores already-tokenized text, so a caller holding cached words skips re-tokenizing them. */
    private addScoreForChunks(chunks: string[], tokens: string[], factor: number, enableFuzzyMatching: boolean, normalizedTokens: string[]) {
        let tokenScore = 0;
        for (const chunk of chunks) {
            for (let ti = 0; ti < normalizedTokens.length; ti++) {
                const normalizedToken = normalizedTokens[ti];
                if (!normalizedToken) {
                    continue;
                }

                if (chunk === normalizedToken) {
                    tokenScore += SCORE_WEIGHTS.TOKEN_EXACT_MATCH * tokens[ti].length * factor;
                } else if (chunk.startsWith(normalizedToken)) {
                    tokenScore += SCORE_WEIGHTS.TOKEN_PREFIX_MATCH * tokens[ti].length * factor;
                } else if (chunk.includes(normalizedToken)) {
                    tokenScore += SCORE_WEIGHTS.TOKEN_CONTAINS_MATCH * tokens[ti].length * factor;
                } else if (enableFuzzyMatching &&
                           normalizedToken.length >= FUZZY_SEARCH_CONFIG.MIN_FUZZY_TOKEN_LENGTH &&
                           this.fuzzyScore < SCORE_WEIGHTS.MAX_TOTAL_FUZZY_SCORE) {
                    // Only compute edit distance when fuzzy matching is enabled.
                    // Cap the per-chunk distance with the length-scaled bound
                    // so short tokens can't fuzzy-match at distance 2.
                    const maxEditDistance = getAutoMaxEditDistance(normalizedToken.length);
                    const editDistance = calculateOptimizedEditDistance(chunk, normalizedToken, maxEditDistance);
                    if (editDistance <= maxEditDistance) {
                        const fuzzyWeight = SCORE_WEIGHTS.TOKEN_FUZZY_MATCH * (1 - editDistance / FUZZY_SEARCH_CONFIG.MAX_EDIT_DISTANCE);
                        const cappedTokenLength = Math.min(tokens[ti].length, SCORE_WEIGHTS.MAX_FUZZY_TOKEN_LENGTH_MULTIPLIER);
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
     * Checks if the query matches as a complete word (or consecutive run of words)
     * in the text. Tokenizing both sides makes this punctuation-aware, so a title
     * like "(sync) notes" is a word match for the query "sync".
     */
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
