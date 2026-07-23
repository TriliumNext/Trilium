import type { NoteRow } from "@triliumnext/commons";

import becca from "../../../becca/becca.js";
import { getLog } from "../../log.js";
import protectedSessionService from "../../protected_session.js";
import { classifyContentMatch } from "../match_quality.js";
import NoteSet from "../note_set.js";
import type SearchContext from "../search_context.js";
import {
    FUZZY_SEARCH_CONFIG,
    fuzzyMatchWord,
    getAutoMaxEditDistance,
    normalizeSearchText,
    stripWordPunctuation,
    tokenizeIntoWords,
    validateAndPreprocessContent,
    validateFuzzySearchTokens,
    wordsContainPhrase} from "../utils/text_utils.js";
import Expression from "./expression.js";
import preprocessContent from "./note_content_fulltext_preprocessor.js";
import { getSql } from "../../../services/sql/index.js";

const ALLOWED_OPERATORS = new Set(["=", "!=", "*=*", "*=", "=*", "%=", "~=", "~*"]);

// Maximum content size for search processing (2MB)
const MAX_SEARCH_CONTENT_SIZE = 2 * 1024 * 1024;

const cachedRegexes: Record<string, RegExp> = {};

function getRegex(str: string): RegExp {
    if (!(str in cachedRegexes)) {
        cachedRegexes[str] = new RegExp(str, "ms"); // multiline, dot-all
    }

    return cachedRegexes[str];
}

interface ConstructorOpts {
    tokens: string[];
    raw?: boolean;
    flatText?: boolean;
    /**
     * When set, a note that fails normal `*=*` matching is retried with fuzzy
     * matching against its body content (progressive phase 2 only, gated on
     * {@link SearchContext.enableFuzzyMatching}). Only the default plain-query
     * content expression built by parse's getFulltext sets this; explicit user
     * operators never do.
     */
    fuzzyFallback?: boolean;
}

type SearchRow = Pick<NoteRow, "noteId" | "type" | "mime" | "content" | "isProtected">;

class NoteContentFulltextExp extends Expression {
    private operator: string;
    tokens: string[];
    private raw: boolean;
    private flatText: boolean;
    private fuzzyFallback: boolean;

    constructor(operator: string, { tokens, raw, flatText, fuzzyFallback }: ConstructorOpts) {
        super();

        if (!operator || !tokens || !Array.isArray(tokens)) {
            throw new Error('Invalid parameters: operator and tokens are required');
        }

        // Validate fuzzy search tokens
        const validation = validateFuzzySearchTokens(tokens, operator);
        if (!validation.isValid) {
            throw new Error(validation.error!);
        }

        this.operator = operator;
        this.tokens = tokens;
        this.raw = !!raw;
        this.flatText = !!flatText;
        this.fuzzyFallback = !!fuzzyFallback;
    }

    execute(inputNoteSet: NoteSet, executionContext: {}, searchContext: SearchContext) {
        if (!ALLOWED_OPERATORS.has(this.operator)) {
            searchContext.addError(`Note content can be searched only with operators: ${Array.from(ALLOWED_OPERATORS).join(", ")}, operator ${this.operator} given.`);

            return inputNoteSet;
        }

        // Add tokens to highlightedTokens so snippet extraction knows what to look for
        for (const token of this.tokens) {
            if (!searchContext.highlightedTokens.includes(token)) {
                searchContext.highlightedTokens.push(token);
            }

            if (this.operator === "%=") {
                // Regex operator: tag each token so snippet highlighting matches it
                // as a RegExp rather than literal text.
                searchContext.regexTokens.add(token);
            }
        }

        const resultNoteSet = new NoteSet();

        // Search through notes with content
        for (const row of getSql().iterateRows<SearchRow>(`
                SELECT noteId, type, mime, content, isProtected
                FROM notes JOIN blobs USING (blobId)
                WHERE type IN ('text', 'code', 'mermaid', 'canvas', 'mindMap', 'spreadsheet', 'llmChat')
                  AND isDeleted = 0
                  AND LENGTH(content) < ${MAX_SEARCH_CONTENT_SIZE}`)) {
            this.findInText(row, inputNoteSet, resultNoteSet, searchContext);
        }

        // For exact match with flatText, also search notes WITHOUT content (they may have matching attributes)
        if (this.flatText && (this.operator === "=" || this.operator === "!=")) {
            for (const note of inputNoteSet.notes) {
                // Skip if already found or doesn't exist
                if (resultNoteSet.hasNoteId(note.noteId) || !(note.noteId in becca.notes)) {
                    continue;
                }

                const noteFromBecca = becca.notes[note.noteId];
                const flatText = noteFromBecca.getFlatText();

                // For flatText, only check attribute values (format: #name=value or ~name=value)
                // Don't match against noteId, type, mime, or title which are also in flatText
                let matches = false;
                const phrase = this.tokens.join(" ");
                const normalizedPhrase = normalizeSearchText(phrase);
                const normalizedFlatText = normalizeSearchText(flatText);

                // Check if =phrase appears in flatText (indicates attribute value match)
                // For single words, use word-boundary matching to avoid substring matches
                if (!normalizedPhrase.includes(' ')) {
                    // Single word: look for =word with word boundaries
                    // Split by = to get attribute values, then check each value for exact word match
                    const parts = normalizedFlatText.split('=');
                    matches = parts.slice(1).some(part => this.exactWordMatch(normalizedPhrase, part));
                } else {
                    // Multi-word phrase: check for substring match
                    matches = normalizedFlatText.includes(`=${normalizedPhrase}`);
                }

                if ((this.operator === "=" && matches) || (this.operator === "!=" && !matches)) {
                    resultNoteSet.add(noteFromBecca);
                }
            }
        }

        return resultNoteSet;
    }

    /**
     * Helper method to check if a single word appears as an exact match in text
     * @param wordToFind - The word to search for (should be normalized)
     * @param text - The text to search in (should be normalized)
     * @returns true if the word is found as an exact match (not substring)
     */
    private exactWordMatch(wordToFind: string, text: string): boolean {
        // Strip boundary punctuation from both sides so a content word wrapped in
        // punctuation (e.g. "(sync)") still matches the bare token ("sync").
        const needle = stripWordPunctuation(wordToFind);
        return tokenizeIntoWords(text).some(word => word === needle);
    }

    /**
     * Checks if content contains the exact word (with word boundaries) or exact phrase
     * This is case-insensitive since content and token are already normalized
     */
    private containsExactWord(token: string, content: string): boolean {
        // Normalize both for case-insensitive comparison
        const normalizedToken = normalizeSearchText(token);
        const normalizedContent = normalizeSearchText(content);

        // If token contains spaces, it's a multi-word phrase from quotes. Scan the
        // tokenized content for a consecutive run so the phrase matches across
        // boundary punctuation (consistent with containsExactPhrase).
        if (normalizedToken.includes(' ')) {
            return wordsContainPhrase(tokenizeIntoWords(content), tokenizeIntoWords(normalizedToken));
        }

        // For single words, use exact word matching to avoid substring matches
        return this.exactWordMatch(normalizedToken, normalizedContent);
    }

    /**
     * Checks if content contains the exact phrase (consecutive words in order)
     * This is case-insensitive since content and tokens are already normalized
     */
    private containsExactPhrase(tokens: string[], content: string, checkFlatTextAttributes: boolean = false): boolean {
        const normalizedTokens = tokens.map(t => normalizeSearchText(t));
        const normalizedContent = normalizeSearchText(content);

        // Join tokens with single space to form the phrase
        const phrase = normalizedTokens.join(" ");

        // For single-word phrases, use word-boundary matching to avoid substring matches
        // e.g., "asd" should not match "asdfasdf"
        if (!phrase.includes(' ')) {
            // Single word: use exact word matching to avoid substring matches
            return this.exactWordMatch(phrase, normalizedContent);
        }

        // For multi-word phrases, scan the tokenized content for a consecutive run
        // of the phrase words. Tokenizing (instead of a raw substring scan) lets a
        // phrase match across punctuation, newlines and repeated whitespace.
        const phraseWords = normalizedTokens
            .map(t => stripWordPunctuation(t))
            .filter(word => word.length > 0);
        if (wordsContainPhrase(tokenizeIntoWords(content), phraseWords)) {
            return true;
        }

        // For flatText, also check if the phrase appears in attribute values.
        // Attributes in flatText appear as "#name=value" or "~name=value", so we
        // look for "=phrase" against the raw string — this depends on the
        // #name=value structure and must stay a raw-string scan.
        if (checkFlatTextAttributes && normalizedContent.includes(`=${phrase}`)) {
            return true;
        }

        return false;
    }

    findInText({ noteId, isProtected, content, type, mime }: SearchRow, inputNoteSet: NoteSet, resultNoteSet: NoteSet, searchContext: SearchContext) {
        if (!inputNoteSet.hasNoteId(noteId) || !(noteId in becca.notes)) {
            return;
        }

        if (isProtected) {
            if (!protectedSessionService.isProtectedSessionAvailable() || !content || typeof content !== "string") {
                return;
            }

            try {
                content = protectedSessionService.decryptString(content) || undefined;
            } catch (e) {
                getLog().info(`Cannot decrypt content of note ${noteId}`);
                return;
            }
        }

        if (!content) {
            return;
        }

        content = preprocessContent(content, type, mime, this.raw, (id) => becca.notes[id]?.title ?? null);

        // Apply content size validation and preprocessing
        const processedContent = validateAndPreprocessContent(content, noteId);
        if (!processedContent) {
            return; // Content too large or invalid
        }
        content = processedContent;

        const { matched, negation } = this.matchesContent(content, noteId);

        // A4: progressive phase-2 fuzzy fallback for plain-query body content. Only
        // runs for notes that failed the cheap match above, and only when this is the
        // default *=* content expression (fuzzyFallback) with fuzzy matching enabled.
        const fuzzyMatched = !matched && !negation && this.fuzzyFallback && searchContext.enableFuzzyMatching
            && this.allTokensFuzzyMatchContent(content);

        if (matched || fuzzyMatched) {
            resultNoteSet.add(becca.notes[noteId]);

            if (fuzzyMatched) {
                searchContext.recordContentMatch(noteId, {
                    tier: "fuzzy",
                    matchedTokenCount: new Set(this.tokens.flatMap((token) => tokenizeIntoWords(token))).size,
                    inOrder: false
                });
            } else if (!negation) {
                // Record how well the content matched so scoring can rank body matches.
                // Negation (!=) matches are added because content does NOT contain the
                // query — there is no positive content match to record.
                this.recordContentMatchQuality(noteId, content, searchContext);
            }
        }

        return content;
    }

    /**
     * True when every query token fuzzy-matches (or is a substring of) some word in
     * the content. Used only by the phase-2 fuzzy fallback; per-word work is bounded
     * by the length-difference early-skip and AUTO edit distances.
     */
    private allTokensFuzzyMatchContent(content: string): boolean {
        const normalizedContent = normalizeSearchText(content);

        return this.tokens.every((token) => {
            const normalizedToken = normalizeSearchText(token);
            return normalizedContent.includes(normalizedToken) || this.fuzzyMatchToken(normalizedToken, normalizedContent);
        });
    }

    /**
     * Applies the operator's matching semantics for this note's content and
     * returns whether it matched and whether the match was a negation (!=).
     */
    private matchesContent(content: string, noteId: string): { matched: boolean; negation: boolean } {
        if (this.tokens.length === 1) {
            const [token] = this.tokens;

            if (this.operator === "=") {
                let matches = this.containsExactWord(token, content);
                // Also check flatText if enabled (includes attributes)
                if (!matches && this.flatText) {
                    matches = this.containsExactPhrase([token], becca.notes[noteId].getFlatText(), true);
                }
                return { matched: matches, negation: false };
            }

            if (this.operator === "!=") {
                let matches = !this.containsExactWord(token, content);
                // For negation, check flatText too
                if (matches && this.flatText) {
                    matches = !this.containsExactPhrase([token], becca.notes[noteId].getFlatText(), true);
                }
                return { matched: matches, negation: true };
            }

            const matched =
                (this.operator === "*=" && content.endsWith(token)) ||
                (this.operator === "=*" && content.startsWith(token)) ||
                (this.operator === "*=*" && content.includes(token)) ||
                (this.operator === "%=" && getRegex(token).test(content)) ||
                (this.operator === "~=" && this.matchesWithFuzzy(content, noteId)) ||
                (this.operator === "~*" && this.fuzzyContainsToken(normalizeSearchText(token), normalizeSearchText(content)));

            return { matched, negation: false };
        }

        // Multi-token matching with fuzzy support and phrase proximity
        if (this.operator === "~=" || this.operator === "~*") {
            return { matched: this.matchesWithFuzzy(content, noteId), negation: false };
        }

        if (this.operator === "=" || this.operator === "!=") {
            // Exact phrase matching for = and !=
            let matches = this.containsExactPhrase(this.tokens, content, false);
            // Also check flatText if enabled (includes attributes)
            if (!matches && this.flatText) {
                matches = this.containsExactPhrase(this.tokens, becca.notes[noteId].getFlatText(), true);
            }

            if (this.operator === "=") {
                return { matched: matches, negation: false };
            }
            return { matched: !matches, negation: true };
        }

        // Other operators: check all tokens present (any order)
        const nonMatchingToken = this.tokens.find((token) => !this.tokenMatchesContent(token, content, noteId));
        return { matched: !nonMatchingToken, negation: false };
    }

    /**
     * Classifies how well this note's body content matched the query tokens and
     * records the result on the search context for scoring. An exact-operator
     * match that came from flat text (attributes) rather than the body is recorded
     * at the exact tier directly, since body classification would find nothing.
     */
    private recordContentMatchQuality(noteId: string, content: string, searchContext: SearchContext) {
        const normalizedTokens = this.tokens.flatMap((token) => tokenizeIntoWords(token));
        if (normalizedTokens.length === 0) {
            return;
        }

        let quality = classifyContentMatch(normalizedTokens, tokenizeIntoWords(content));

        if (!quality && this.operator === "=") {
            quality = {
                tier: normalizedTokens.length > 1 ? "exact_phrase" : "exact_word",
                matchedTokenCount: new Set(normalizedTokens).size,
                inOrder: false
            };
        }

        if (quality) {
            searchContext.recordContentMatch(noteId, quality);
        }
    }

    /**
     * Checks if a token matches content with optional fuzzy matching
     */
    private tokenMatchesContent(token: string, content: string, noteId: string): boolean {
        const normalizedToken = normalizeSearchText(token);
        const normalizedContent = normalizeSearchText(content);

        if (normalizedContent.includes(normalizedToken)) {
            return true;
        }

        // Check flat text for default fulltext search
        if (!this.flatText || !becca.notes[noteId].getFlatText().includes(token)) {
            return false;
        }

        return true;
    }

    /**
     * Performs fuzzy matching with edit distance and phrase proximity
     */
    private matchesWithFuzzy(content: string, noteId: string): boolean {
        try {
            const normalizedContent = normalizeSearchText(content);
            const flatText = this.flatText ? normalizeSearchText(becca.notes[noteId].getFlatText()) : "";

            // For phrase matching, check if tokens appear within reasonable proximity
            if (this.tokens.length > 1) {
                return this.matchesPhrase(normalizedContent, flatText);
            }

            // Single token fuzzy matching
            const token = normalizeSearchText(this.tokens[0]);
            return this.fuzzyMatchToken(token, normalizedContent) ||
                   (this.flatText && this.fuzzyMatchToken(token, flatText));
        } catch (error) {
            getLog().error(`Error in fuzzy matching for note ${noteId}: ${error}`);
            return false;
        }
    }

    /**
     * Checks if multiple tokens match as a phrase with proximity consideration
     */
    private matchesPhrase(content: string, flatText: string): boolean {
        const searchText = this.flatText ? `${content} ${flatText}` : content;

        // Apply content size limits for phrase matching
        const limitedText = validateAndPreprocessContent(searchText);
        if (!limitedText) {
            return false;
        }

        const words = limitedText.toLowerCase().split(/\s+/);

        // Only skip phrase matching for truly extreme word counts that could crash the system
        if (words.length > FUZZY_SEARCH_CONFIG.ABSOLUTE_MAX_WORD_COUNT) {
            console.error(`Phrase matching skipped due to extreme word count that could cause system instability: ${words.length} words`);
            return false;
        }

        // Warn about large word counts but still attempt matching
        if (words.length > FUZZY_SEARCH_CONFIG.PERFORMANCE_WARNING_WORDS) {
            console.info(`Large word count for phrase matching: ${words.length} words - may take longer but will attempt full matching`);
        }

        // Find positions of each token
        const tokenPositions: number[][] = this.tokens.map(token => {
            const normalizedToken = normalizeSearchText(token);
            const positions: number[] = [];

            words.forEach((word, index) => {
                if (this.fuzzyMatchSingle(normalizedToken, word)) {
                    positions.push(index);
                }
            });

            return positions;
        });

        // Check if we found all tokens
        if (tokenPositions.some(positions => positions.length === 0)) {
            return false;
        }

        // Check for phrase proximity using configurable distance
        return this.hasProximityMatch(tokenPositions, FUZZY_SEARCH_CONFIG.MAX_PHRASE_PROXIMITY);
    }

    /**
     * Checks if token positions indicate a phrase match within max distance
     */
    private hasProximityMatch(tokenPositions: number[][], maxDistance: number): boolean {
        // For 2 tokens, simple proximity check
        if (tokenPositions.length === 2) {
            const [pos1, pos2] = tokenPositions;
            return pos1.some(p1 => pos2.some(p2 => Math.abs(p1 - p2) <= maxDistance));
        }

        // For more tokens, check if we can find a sequence where all tokens are within range
        const findSequence = (remaining: number[][], currentPos: number): boolean => {
            if (remaining.length === 0) return true;

            const [nextPositions, ...rest] = remaining;
            return nextPositions.some(pos =>
                Math.abs(pos - currentPos) <= maxDistance &&
                findSequence(rest, pos)
            );
        };

        const [firstPositions, ...rest] = tokenPositions;
        return firstPositions.some(startPos => findSequence(rest, startPos));
    }

    /**
     * Performs fuzzy matching for a single token against content
     */
    private fuzzyMatchToken(token: string, content: string): boolean {
        if (token.length < FUZZY_SEARCH_CONFIG.MIN_FUZZY_TOKEN_LENGTH) {
            // For short tokens, require exact match to avoid too many false positives
            return content.includes(token);
        }

        const words = content.split(/\s+/);

        // Only limit word processing for truly extreme cases to prevent system instability
        const limitedWords = words.slice(0, FUZZY_SEARCH_CONFIG.ABSOLUTE_MAX_WORD_COUNT);

        return limitedWords.some(word => this.fuzzyMatchSingle(token, word));
    }

    /**
     * Fuzzy CONTAINS for a single "~*" token: a plain substring (fragment) match
     * counts (so "progr" matches "programming"), otherwise fall back to per-word
     * fuzzy matching. Mirrors the substring fallback used by "~=" and keeps "~="
     * (fuzzy equals, word-level via fuzzyMatchToken) unaffected.
     */
    private fuzzyContainsToken(token: string, content: string): boolean {
        return content.includes(token) || this.fuzzyMatchToken(token, content);
    }

    /**
     * Fuzzy matches a single token against a single word
     */
    private fuzzyMatchSingle(token: string, word: string): boolean {
        // Use shared optimized fuzzy matching logic with a length-scaled (AUTO)
        // edit-distance bound so short tokens don't produce false positives.
        return fuzzyMatchWord(token, word, getAutoMaxEditDistance(token.length));
    }
}

export default NoteContentFulltextExp;
