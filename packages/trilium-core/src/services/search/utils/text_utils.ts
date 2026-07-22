"use strict";

import { normalize } from "../../utils/index";

/**
 * Shared text processing utilities for search functionality
 */

// Configuration constants for fuzzy matching
export const FUZZY_SEARCH_CONFIG = {
    // Minimum token length for fuzzy operators to prevent false positives
    MIN_FUZZY_TOKEN_LENGTH: 3,
    // Maximum edit distance for fuzzy matching
    MAX_EDIT_DISTANCE: 2,
    // Maximum proximity distance for phrase matching (in words)
    MAX_PHRASE_PROXIMITY: 10,
    // Absolute hard limits for extreme cases - only to prevent system crashes
    ABSOLUTE_MAX_CONTENT_SIZE: 100 * 1024 * 1024, // 100MB - extreme upper limit to prevent OOM
    ABSOLUTE_MAX_WORD_COUNT: 2000000, // 2M words - extreme upper limit for word processing
    // Performance warning thresholds - inform user but still attempt search
    PERFORMANCE_WARNING_SIZE: 5 * 1024 * 1024, // 5MB - warn about potential performance impact
    PERFORMANCE_WARNING_WORDS: 100000, // 100K words - warn about word count impact
    // Progressive processing thresholds for very large content
    PROGRESSIVE_PROCESSING_SIZE: 10 * 1024 * 1024, // 10MB - use progressive processing
    PROGRESSIVE_PROCESSING_WORDS: 500000, // 500K words - use progressive processing
    // Performance thresholds
    EARLY_TERMINATION_THRESHOLD: 3,
} as const;

/**
 * Normalizes text by removing diacritics and converting to lowercase.
 * This is the centralized text normalization function used across all search components.
 * Uses the shared normalize function from utils for consistency.
 *
 * Examples:
 * - "café" -> "cafe"
 * - "naïve" -> "naive"
 * - "HELLO WORLD" -> "hello world"
 *
 * @param text The text to normalize
 * @returns The normalized text
 */
export function normalizeSearchText(text: string): string {
    if (!text || typeof text !== 'string') {
        return '';
    }

    // Use shared normalize function for consistency across the codebase
    return normalize(text);
}

/**
 * Strips HTML tags from content for snippet extraction.
 * Uses iterative replacement to handle nested/malformed tags like `<scr<script>ipt>`.
 *
 * @param html The HTML content to strip
 * @returns Plain text with all HTML tags removed
 */
export function stripHtmlTags(html: string): string {
    if (!html || typeof html !== "string") {
        return "";
    }

    let result = html;
    let previous: string;

    // Loop until no more tags — handles nested cases like <scr<script>ipt>
    do {
        previous = result;
        result = result.replace(/<[^>]*>/g, "");
    } while (result !== previous);

    return result;
}

/**
 * Optimized edit distance calculation using single array and early termination.
 * This is significantly more memory efficient than the 2D matrix approach and includes
 * early termination optimizations for better performance.
 *
 * @param str1 First string
 * @param str2 Second string
 * @param maxDistance Maximum allowed distance (for early termination)
 * @returns The edit distance between the strings, or maxDistance + 1 if exceeded
 */
export function calculateOptimizedEditDistance(str1: string, str2: string, maxDistance: number = FUZZY_SEARCH_CONFIG.MAX_EDIT_DISTANCE): number {
    // Input validation
    if (typeof str1 !== 'string' || typeof str2 !== 'string') {
        throw new Error('Both arguments must be strings');
    }

    if (maxDistance < 0 || !Number.isInteger(maxDistance)) {
        throw new Error('maxDistance must be a non-negative integer');
    }

    const len1 = str1.length;
    const len2 = str2.length;

    // Performance guard: if strings are too long, limit processing
    const maxStringLength = 1000;
    if (len1 > maxStringLength || len2 > maxStringLength) {
        // For very long strings, fall back to simple length-based heuristic
        return Math.abs(len1 - len2) <= maxDistance ? Math.abs(len1 - len2) : maxDistance + 1;
    }

    // Early termination: if length difference exceeds max distance
    if (Math.abs(len1 - len2) > maxDistance) {
        return maxDistance + 1;
    }

    // Handle edge cases
    if (len1 === 0) return len2 <= maxDistance ? len2 : maxDistance + 1;
    if (len2 === 0) return len1 <= maxDistance ? len1 : maxDistance + 1;

    // Use single array optimization for better memory usage
    let previousRow = Array.from({ length: len2 + 1 }, (_, i) => i);
    let currentRow = new Array(len2 + 1);

    for (let i = 1; i <= len1; i++) {
        currentRow[0] = i;
        let minInRow = i;

        for (let j = 1; j <= len2; j++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            currentRow[j] = Math.min(
                previousRow[j] + 1,        // deletion
                currentRow[j - 1] + 1,     // insertion
                previousRow[j - 1] + cost  // substitution
            );

            // Track minimum value in current row for early termination
            if (currentRow[j] < minInRow) {
                minInRow = currentRow[j];
            }
        }

        // Early termination: if minimum distance in row exceeds threshold
        if (minInRow > maxDistance) {
            return maxDistance + 1;
        }

        // Swap arrays for next iteration
        [previousRow, currentRow] = [currentRow, previousRow];
    }

    const result = previousRow[len2];
    return result <= maxDistance ? result : maxDistance + 1;
}

/**
 * Validates that tokens meet minimum requirements for fuzzy operators.
 *
 * @param tokens Array of search tokens
 * @param operator The search operator being used
 * @returns Validation result with success status and error message
 */
export function validateFuzzySearchTokens(tokens: string[], operator: string): { isValid: boolean; error?: string } {
    if (!operator || typeof operator !== 'string') {
        return {
            isValid: false,
            error: 'Invalid operator: operator must be a non-empty string'
        };
    }

    if (!Array.isArray(tokens)) {
        return {
            isValid: false,
            error: 'Invalid tokens: tokens must be an array'
        };
    }

    if (tokens.length === 0) {
        return {
            isValid: false,
            error: 'Invalid tokens: at least one token is required'
        };
    }

    // Check for null, undefined, or non-string tokens
    const invalidTypeTokens = tokens.filter(token =>
        token == null || typeof token !== 'string'
    );

    if (invalidTypeTokens.length > 0) {
        return {
            isValid: false,
            error: 'Invalid tokens: all tokens must be non-null strings'
        };
    }

    // Check for empty string tokens
    const emptyTokens = tokens.filter(token => token.trim().length === 0);

    if (emptyTokens.length > 0) {
        return {
            isValid: false,
            error: 'Invalid tokens: empty or whitespace-only tokens are not allowed'
        };
    }

    if (operator !== '~=' && operator !== '~*') {
        return { isValid: true };
    }

    // Check minimum token length for fuzzy operators
    const shortTokens = tokens.filter(token => token.length < FUZZY_SEARCH_CONFIG.MIN_FUZZY_TOKEN_LENGTH);

    if (shortTokens.length > 0) {
        return {
            isValid: false,
            error: `Fuzzy search operators (~=, ~*) require tokens of at least ${FUZZY_SEARCH_CONFIG.MIN_FUZZY_TOKEN_LENGTH} characters. Invalid tokens: ${shortTokens.join(', ')}`
        };
    }

    // Check for excessively long tokens that could cause performance issues
    const maxTokenLength = 100; // Reasonable limit for search tokens
    const longTokens = tokens.filter(token => token.length > maxTokenLength);

    if (longTokens.length > 0) {
        return {
            isValid: false,
            error: `Tokens are too long (max ${maxTokenLength} characters). Long tokens: ${longTokens.map(t => t.substring(0, 20) + '...').join(', ')}`
        };
    }

    return { isValid: true };
}

/**
 * Validates and preprocesses content for search operations.
 * Philosophy: Try to search everything! Only block truly extreme cases that could crash the system.
 *
 * @param content The content to validate and preprocess
 * @param noteId The note ID (for logging purposes)
 * @returns Processed content, only null for truly extreme cases that could cause system instability
 */
export function validateAndPreprocessContent(content: string, noteId?: string): string | null {
    if (!content || typeof content !== 'string') {
        return null;
    }

    // Only block content that could actually crash the system (100MB+)
    if (content.length > FUZZY_SEARCH_CONFIG.ABSOLUTE_MAX_CONTENT_SIZE) {
        console.error(`Content size exceeds absolute system limit for note ${noteId || 'unknown'}: ${content.length} bytes - this could cause system instability`);
        // Only in truly extreme cases, truncate to prevent system crash
        return content.substring(0, FUZZY_SEARCH_CONFIG.ABSOLUTE_MAX_CONTENT_SIZE);
    }

    // Warn about very large content but still process it
    if (content.length > FUZZY_SEARCH_CONFIG.PERFORMANCE_WARNING_SIZE) {
        console.info(`Large content for note ${noteId || 'unknown'}: ${content.length} bytes - processing may take time but will attempt full search`);
    }

    // For word count, be even more permissive - only block truly extreme cases
    const wordCount = content.split(/\s+/).length;
    if (wordCount > FUZZY_SEARCH_CONFIG.ABSOLUTE_MAX_WORD_COUNT) {
        console.error(`Word count exceeds absolute system limit for note ${noteId || 'unknown'}: ${wordCount} words - this could cause system instability`);
        // Only in truly extreme cases, truncate to prevent system crash
        return content.split(/\s+/).slice(0, FUZZY_SEARCH_CONFIG.ABSOLUTE_MAX_WORD_COUNT).join(' ');
    }

    // Warn about high word counts but still process them
    if (wordCount > FUZZY_SEARCH_CONFIG.PERFORMANCE_WARNING_WORDS) {
        console.info(`High word count for note ${noteId || 'unknown'}: ${wordCount} words - phrase matching may take time but will attempt full search`);
    }

    // Progressive processing warning for very large content
    if (content.length > FUZZY_SEARCH_CONFIG.PROGRESSIVE_PROCESSING_SIZE || wordCount > FUZZY_SEARCH_CONFIG.PROGRESSIVE_PROCESSING_WORDS) {
        console.info(`Very large content for note ${noteId || 'unknown'} - using progressive processing to maintain responsiveness`);
    }

    return content;
}

/**
 * Escapes special regex characters in a string for use in RegExp constructor
 */
function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns the maximum edit distance allowed for a fuzzy match of a token of the
 * given length, scaled by length in the style of Elasticsearch's `fuzziness:
 * AUTO`. A flat edit distance of 2 is too loose for short words (e.g. "sync"
 * would match "send"), so short tokens get a tighter bound.
 *
 * - 0-2 chars: 0 (no fuzzy matching)
 * - 3-5 chars: 1
 * - 6+ chars: 2
 *
 * The result never exceeds {@link FUZZY_SEARCH_CONFIG.MAX_EDIT_DISTANCE}.
 *
 * @param tokenLength The length of the token being matched.
 * @returns The maximum allowed edit distance for that token.
 */
export function getAutoMaxEditDistance(tokenLength: number): number {
    if (tokenLength <= 2) {
        return 0;
    }
    if (tokenLength <= 5) {
        return 1;
    }
    return FUZZY_SEARCH_CONFIG.MAX_EDIT_DISTANCE;
}

/**
 * Checks if a word matches a token with fuzzy matching and returns the matched word.
 * Optimized for common case where distances are small.
 *
 * @param token The search token (should be normalized)
 * @param text The text to match against (should be normalized)
 * @param maxDistance Maximum allowed edit distance
 * @returns The matched word if found, null otherwise
 */
export function fuzzyMatchWordWithResult(token: string, text: string, maxDistance: number = getAutoMaxEditDistance(token.length)): string | null {
    // Input validation
    if (typeof token !== 'string' || typeof text !== 'string') {
        return null;
    }

    if (token.length === 0 || text.length === 0) {
        return null;
    }

    try {
        // Normalize for comparison — some callers pass pre-normalized text,
        // others don't, so this function must be self-contained.
        const normalizedToken = token.toLowerCase();
        const normalizedText = text.toLowerCase();

        // NOTE: no whole-text substring shortcut here. Substring relationships are
        // NOT fuzzy matches — callers that want substring semantics do their own
        // .includes() check first (note_flat_text smartMatch, build_comparator ~=,
        // note_content_fulltext tokenMatchesContent). Letting "async" count as a
        // fuzzy match for "sync" was a false positive (#10616).

        // For fuzzy matching, split into words and check each against the token
        const words = normalizedText.split(/\s+/).filter(word => word.length > 0);
        const originalWords = text.split(/\s+/).filter(word => word.length > 0);

        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const originalWord = originalWords[i];

            // A word that literally contains the token is a substring relationship,
            // not a fuzzy (typo) one — skip it so e.g. "sync" does not fuzzy-match
            // "async". Callers handle substrings via their own .includes() checks.
            if (word.length > normalizedToken.length && word.includes(normalizedToken)) {
                continue;
            }

            // Skip if word is too different in length for fuzzy matching
            if (Math.abs(word.length - normalizedToken.length) > maxDistance) {
                continue;
            }

            // Use optimized edit distance calculation. maxDistance is length-scaled
            // (Elasticsearch AUTO-style) via getAutoMaxEditDistance by default.
            const distance = calculateOptimizedEditDistance(normalizedToken, word, maxDistance);
            if (distance <= maxDistance) {
                return originalWord; // Return the original word with case preserved
            }
        }

        return null;
    } catch (error) {
        // Log error and return null for safety
        console.warn('Error in fuzzy word matching:', error);
        return null;
    }
}

/**
 * Checks if a word matches a token with fuzzy matching.
 * Optimized for common case where distances are small.
 *
 * @param token The search token (should be normalized)
 * @param word The word to match against (should be normalized)
 * @param maxDistance Maximum allowed edit distance
 * @returns True if the word matches the token within the distance threshold
 */
export function fuzzyMatchWord(token: string, text: string, maxDistance: number = getAutoMaxEditDistance(token.length)): boolean {
    return fuzzyMatchWordWithResult(token, text, maxDistance) !== null;
}

/**
 * Unicode character class for punctuation that should be trimmed from word
 * boundaries during tokenization: initial/final quotes (Pi/Pf), open/close
 * brackets (Ps/Pe), other punctuation such as `,` `.` `!` `#` `"` `'` (Po) and
 * dashes (Pd).
 *
 * Deliberately EXCLUDED so those characters survive tokenization:
 * - Connector punctuation (Pc), e.g. `_` — keeps identifiers like `_private`.
 * - Symbols (S*), e.g. `+`, `=`, `$` — keeps tokens like `c++`.
 */
const WORD_BOUNDARY_PUNCTUATION = "\\p{Pi}\\p{Pf}\\p{Ps}\\p{Pe}\\p{Po}\\p{Pd}";
const LEADING_PUNCTUATION = new RegExp(`^[${WORD_BOUNDARY_PUNCTUATION}]+`, "u");
const TRAILING_PUNCTUATION = new RegExp(`[${WORD_BOUNDARY_PUNCTUATION}]+$`, "u");

/**
 * Strips leading and trailing punctuation from a single word so that a search
 * token and a content word compare equal even when the content word is wrapped
 * in punctuation, e.g. `(sync)` -> `sync`, `sync,` -> `sync`, `"sync"` -> `sync`.
 *
 * Tradeoffs (documented deliberately):
 * - KEEPS connector punctuation (`_`, class Pc) and symbols (`+`, `=`, `$`,
 *   class S), so `c++` and `_private` survive intact.
 * - Only leading/trailing punctuation is removed; INNER punctuation is untouched,
 *   so `d'artagnan` keeps its apostrophe.
 * - Trailing symbol-like punctuation that IS in the stripped classes is removed:
 *   `f#` -> `f`. This is acceptable because stripping is applied symmetrically to
 *   both the query token and the content word, so matching stays self-consistent.
 *
 * @param word A single word (no internal whitespace expected).
 * @returns The word with boundary punctuation removed (may be empty).
 */
export function stripWordPunctuation(word: string): string {
    if (!word) {
        return "";
    }

    return word.replace(LEADING_PUNCTUATION, "").replace(TRAILING_PUNCTUATION, "");
}

/**
 * Splits text into normalized, punctuation-stripped words. This is the
 * tokenization used by exact word / phrase matching so that punctuation in
 * content (parentheses, quotes, trailing commas, newlines) does not prevent a
 * word from matching.
 *
 * Pipeline: {@link normalizeSearchText} (lowercase + strip diacritics) ->
 * split on whitespace -> {@link stripWordPunctuation} each -> drop empties.
 *
 * @param text The text to tokenize.
 * @returns An array of normalized words with empty entries removed.
 */
export function tokenizeIntoWords(text: string): string[] {
    return normalizeSearchText(text)
        .split(/\s+/)
        .map(stripWordPunctuation)
        .filter((word) => word.length > 0);
}

/**
 * Returns true if `phrase` appears as a consecutive run of words inside `words`.
 * Both arrays are expected to already be tokenized (e.g. via
 * {@link tokenizeIntoWords}). An empty phrase never matches.
 *
 * @param words The haystack words, in order.
 * @param phrase The needle words that must appear consecutively and in order.
 */
export function wordsContainPhrase(words: string[], phrase: string[]): boolean {
    if (phrase.length === 0 || phrase.length > words.length) {
        return false;
    }

    for (let i = 0; i <= words.length - phrase.length; i++) {
        if (phrase.every((phraseWord, j) => words[i + j] === phraseWord)) {
            return true;
        }
    }

    return false;
}
