import type { NoteRow } from "@triliumnext/commons";

import becca from "../../../becca/becca.js";
import log from "../../log.js";
import protectedSessionService from "../../protected_session.js";
import sql from "../../sql.js";
import NoteSet from "../note_set.js";
import type SearchContext from "../search_context.js";
import {
    FUZZY_SEARCH_CONFIG,
    fuzzyMatchWord,
    normalizeSearchText,
    validateAndPreprocessContent,
    validateFuzzySearchTokens} from "../utils/text_utils.js";
import Expression from "./expression.js";
import preprocessContent from "./note_content_fulltext_preprocessor.js";

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
}

type SearchRow = Pick<NoteRow, "noteId" | "type" | "mime" | "content" | "isProtected">;

class NoteContentFulltextExp extends Expression {
    private operator: string;
    tokens: string[];
    private raw: boolean;
    private flatText: boolean;

    constructor(operator: string, { tokens, raw, flatText }: ConstructorOpts) {
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
        }

        const resultNoteSet = new NoteSet();

        // Search through notes with content
        for (const row of sql.iterateRows<SearchRow>(`
                SELECT noteId, type, mime, content, isProtected
                FROM notes JOIN blobs USING (blobId)
                WHERE type IN ('text', 'code', 'mermaid', 'canvas', 'mindMap', 'spreadsheet')
                  AND isDeleted = 0
                  AND LENGTH(content) < ${MAX_SEARCH_CONTENT_SIZE}`)) {
            this.findInText(row, inputNoteSet, resultNoteSet);
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
        const words = text.split(/\s+/);
        return words.some(word => word === wordToFind);
    }

    /**
     * Checks if content contains the exact word (with word boundaries) or exact phrase
     * This is case-insensitive since content and token are already normalized
     */
    private containsExactWord(token: string, content: string): boolean {
        // Normalize both for case-insensitive comparison
        const normalizedToken = normalizeSearchText(token);
        const normalizedContent = normalizeSearchText(content);

        // If token contains spaces, it's a multi-word phrase from quotes
        // Check for substring match (consecutive phrase)
        if (normalizedToken.includes(' ')) {
            return normalizedContent.includes(normalizedToken);
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

        // For multi-word phrases, check if the phrase appears as consecutive words
        if (normalizedContent.includes(phrase)) {
            return true;
        }

        // For flatText, also check if the phrase appears in attribute values
        // Attributes in flatText appear as "#name=value" or "~name=value"
        // So we need to check for "=phrase" to match attribute values
        if (checkFlatTextAttributes && normalizedContent.includes(`=${phrase}`)) {
            return true;
        }

        return false;
    }

    findInText({ noteId, isProtected, content, type, mime }: SearchRow, inputNoteSet: NoteSet, resultNoteSet: NoteSet) {
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
                log.info(`Cannot decrypt content of note ${noteId}`);
                return;
            }
        }

        if (!content) {
            return;
        }

        content = preprocessContent(content, type, mime, this.raw);

        // Apply content size validation and preprocessing
        const processedContent = validateAndPreprocessContent(content, noteId);
        if (!processedContent) {
            return; // Content too large or invalid
        }
        content = processedContent;

        if (this.tokens.length === 1) {
            const [token] = this.tokens;

            let matches = false;
            if (this.operator === "=") {
                matches = this.containsExactWord(token, content);
                // Also check flatText if enabled (includes attributes)
                if (!matches && this.flatText) {
                    const flatText = becca.notes[noteId].getFlatText();
                    matches = this.containsExactPhrase([token], flatText, true);
                }
            } else if (this.operator === "!=") {
                matches = !this.containsExactWord(token, content);
                // For negation, check flatText too
                if (matches && this.flatText) {
                    const flatText = becca.notes[noteId].getFlatText();
                    matches = !this.containsExactPhrase([token], flatText, true);
                }
            }

            if (
                matches ||
                (this.operator === "*=" && content.endsWith(token)) ||
                (this.operator === "=*" && content.startsWith(token)) ||
                (this.operator === "*=*" && content.includes(token)) ||
                (this.operator === "%=" && getRegex(token).test(content)) ||
                (this.operator === "~=" && this.matchesWithFuzzy(content, noteId)) ||
                (this.operator === "~*" && this.fuzzyMatchToken(normalizeSearchText(token), normalizeSearchText(content)))
            ) {
                resultNoteSet.add(becca.notes[noteId]);
            }
        } else {
            // Multi-token matching with fuzzy support and phrase proximity
            if (this.operator === "~=" || this.operator === "~*") {
                // Fuzzy phrase matching
                if (this.matchesWithFuzzy(content, noteId)) {
                    resultNoteSet.add(becca.notes[noteId]);
                }
            } else if (this.operator === "=" || this.operator === "!=") {
                // Exact phrase matching for = and !=
                let matches = this.containsExactPhrase(this.tokens, content, false);

                // Also check flatText if enabled (includes attributes)
                if (!matches && this.flatText) {
                    const flatText = becca.notes[noteId].getFlatText();
                    matches = this.containsExactPhrase(this.tokens, flatText, true);
                }

                if ((this.operator === "=" && matches) ||
                    (this.operator === "!=" && !matches)) {
                    resultNoteSet.add(becca.notes[noteId]);
                }
            } else {
                // Other operators: check all tokens present (any order)
                const nonMatchingToken = this.tokens.find(
                    (token) =>
                        !this.tokenMatchesContent(token, content, noteId)
                );

                if (!nonMatchingToken) {
                    resultNoteSet.add(becca.notes[noteId]);
                }
            }
        }

        return content;
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
            log.error(`Error in fuzzy matching for note ${noteId}: ${error}`);
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
     * Fuzzy matches a single token against a single word
     */
    private fuzzyMatchSingle(token: string, word: string): boolean {
        // Use shared optimized fuzzy matching logic
        return fuzzyMatchWord(token, word, FUZZY_SEARCH_CONFIG.MAX_EDIT_DISTANCE);
    }
}

export default NoteContentFulltextExp;
