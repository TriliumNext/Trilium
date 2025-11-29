/**
 * FTS5 Query Builder
 *
 * Utilities for converting Trilium search syntax to FTS5 MATCH syntax,
 * sanitizing tokens, and handling text matching operations.
 */

import striptags from "striptags";
import log from "../../log.js";
import { FTSQueryError } from "./errors.js";

/**
 * Converts Trilium search syntax to FTS5 MATCH syntax
 *
 * @param tokens - Array of search tokens
 * @param operator - Trilium search operator
 * @returns FTS5 MATCH query string
 */
export function convertToFTS5Query(tokens: string[], operator: string): string {
    if (!tokens || tokens.length === 0) {
        throw new Error("No search tokens provided");
    }

    // Substring operators (*=*, *=, =*) use LIKE queries now, not MATCH
    if (operator === "*=*" || operator === "*=" || operator === "=*") {
        throw new Error("Substring operators should use searchWithLike(), not MATCH queries");
    }

    // Trigram tokenizer requires minimum 3 characters
    const shortTokens = tokens.filter(token => token.length < 3);
    if (shortTokens.length > 0) {
        const shortList = shortTokens.join(', ');
        log.info(`Tokens shorter than 3 characters detected (${shortList}) - cannot use trigram FTS5`);
        throw new FTSQueryError(
            `Trigram tokenizer requires tokens of at least 3 characters. Short tokens: ${shortList}`
        );
    }

    // Sanitize tokens to prevent FTS5 syntax injection
    const sanitizedTokens = tokens.map(token => sanitizeFTS5Token(token));

    // Only handle operators that work with MATCH
    switch (operator) {
        case "=": // Exact phrase match
            return `"${sanitizedTokens.join(" ")}"`;

        case "!=": // Does not contain
            return `NOT (${sanitizedTokens.join(" OR ")})`;

        case "~=": // Fuzzy match (use OR)
        case "~*":
            return sanitizedTokens.join(" OR ");

        case "%=": // Regex - uses traditional SQL iteration fallback
            throw new FTSQueryError("Regex search not supported in FTS5 - use traditional search path");

        default:
            throw new FTSQueryError(`Unsupported MATCH operator: ${operator}`);
    }
}

/**
 * Sanitizes a token for safe use in FTS5 queries
 * Validates that the token is not empty after sanitization
 */
export function sanitizeFTS5Token(token: string): string {
    // Remove special FTS5 characters that could break syntax
    const sanitized = token
        .replace(/["\(\)\*]/g, '') // Remove quotes, parens, wildcards
        .replace(/\s+/g, ' ')       // Normalize whitespace
        .trim();

    // Validate that token is not empty after sanitization
    if (!sanitized || sanitized.length === 0) {
        log.info(`Token became empty after sanitization: "${token}"`);
        // Return a safe placeholder that won't match anything
        return "__empty_token__";
    }

    return sanitized;
}

/**
 * Escapes LIKE wildcards (% and _) in user input to treat them as literals
 * @param str - User input string
 * @returns String with LIKE wildcards escaped
 */
export function escapeLikeWildcards(str: string): string {
    return str.replace(/[%_]/g, '\\$&');
}

/**
 * Checks if a phrase appears as exact words in text (respecting word boundaries)
 * @param phrase - The phrase to search for (case-insensitive)
 * @param text - The text to search in
 * @returns true if the phrase appears as complete words, false otherwise
 */
export function containsExactPhrase(phrase: string, text: string | null | undefined): boolean {
    if (!text || !phrase || typeof text !== 'string') {
        return false;
    }

    // Normalize both to lowercase for case-insensitive comparison
    const normalizedPhrase = phrase.toLowerCase().trim();
    const normalizedText = text.toLowerCase();

    // Strip HTML tags for content matching
    const plainText = striptags(normalizedText);

    // For single words, use word-boundary matching
    if (!normalizedPhrase.includes(' ')) {
        // Split text into words and check for exact match
        const words = plainText.split(/\s+/);
        return words.some(word => word === normalizedPhrase);
    }

    // For multi-word phrases, check if the phrase appears as consecutive words
    // Split text into words, then check if the phrase appears in the word sequence
    const textWords = plainText.split(/\s+/);
    const phraseWords = normalizedPhrase.split(/\s+/);

    // Sliding window to find exact phrase match
    for (let i = 0; i <= textWords.length - phraseWords.length; i++) {
        let match = true;
        for (let j = 0; j < phraseWords.length; j++) {
            if (textWords[i + j] !== phraseWords[j]) {
                match = false;
                break;
            }
        }
        if (match) {
            return true;
        }
    }

    return false;
}

/**
 * Generates a snippet from content
 */
export function generateSnippet(content: string, maxLength: number = 30): string {
    // Strip HTML tags for snippet
    const plainText = striptags(content);
    // Simple normalization - just trim and collapse whitespace
    const normalized = plainText.replace(/\s+/g, ' ').trim();

    if (normalized.length <= maxLength * 10) {
        return normalized;
    }

    // Extract snippet around first occurrence
    return normalized.substring(0, maxLength * 10) + '...';
}
