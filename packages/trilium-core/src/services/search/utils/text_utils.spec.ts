import { afterEach, describe, expect, it, vi } from "vitest";

import { calculateOptimizedEditDistance, FUZZY_SEARCH_CONFIG, normalizeSearchText, validateAndPreprocessContent, validateFuzzySearchTokens, fuzzyMatchWord, fuzzyMatchWordWithResult, getAutoMaxEditDistance, stripWordPunctuation, tokenizeIntoWords, wordsContainPhrase } from "./text_utils.js";

describe('Fuzzy Search Core', () => {
    describe('calculateOptimizedEditDistance', () => {
        it('calculates edit distance for common typos', () => {
            expect(calculateOptimizedEditDistance('hello', 'helo')).toBe(1);
            expect(calculateOptimizedEditDistance('world', 'wrold')).toBe(2);
            expect(calculateOptimizedEditDistance('cafe', 'café')).toBe(1);
            expect(calculateOptimizedEditDistance('identical', 'identical')).toBe(0);
        });

        it('handles performance safety with oversized input', () => {
            const longString = 'a'.repeat(2000);
            const result = calculateOptimizedEditDistance(longString, 'short');
            expect(result).toBeGreaterThan(2); // Should use fallback heuristic
        });
    });

    describe('validateFuzzySearchTokens', () => {
        it('validates minimum length requirements for fuzzy operators', () => {
            const result1 = validateFuzzySearchTokens(['ab'], '~=');
            expect(result1.isValid).toBe(false);
            expect(result1.error).toContain('at least 3 characters');

            const result2 = validateFuzzySearchTokens(['hello'], '~=');
            expect(result2.isValid).toBe(true);

            const result3 = validateFuzzySearchTokens(['ok'], '=');
            expect(result3.isValid).toBe(true); // Non-fuzzy operators allow short tokens
        });

        it('validates token types and empty arrays', () => {
            expect(validateFuzzySearchTokens([], '=')).toEqual({
                isValid: false,
                error: 'Invalid tokens: at least one token is required'
            });

            expect(validateFuzzySearchTokens([''], '=')).toEqual({
                isValid: false,
                error: 'Invalid tokens: empty or whitespace-only tokens are not allowed'
            });
        });
    });

    describe('fuzzyMatchWord', () => {
        it('matches words with diacritics normalization', () => {
            expect(fuzzyMatchWord('cafe', 'café')).toBe(true);
            expect(fuzzyMatchWord('naive', 'naïve')).toBe(true);
        });

        it('matches with typos within the length-scaled distance threshold', () => {
            // helo -> hello is a single edit (d=1), allowed for 5-char tokens.
            expect(fuzzyMatchWord('hello', 'helo')).toBe(true);
            // wrold/tset are transpositions (Levenshtein d=2). Under length-scaled
            // distance, <=5-char tokens only allow d=1, so these no longer match.
            // (Old behavior allowed a flat d=2 for any length, which was too loose, #10616.)
            expect(fuzzyMatchWord('world', 'wrold')).toBe(false);
            expect(fuzzyMatchWord('test', 'tset')).toBe(false);
            expect(fuzzyMatchWord('test', 'xyz')).toBe(false);
        });

        it('handles edge cases safely', () => {
            expect(fuzzyMatchWord('', 'test')).toBe(false);
            expect(fuzzyMatchWord('test', '')).toBe(false);
            expect(fuzzyMatchWord('a', 'b')).toBe(false); // Very short tokens
        });
    });

    describe('stripWordPunctuation', () => {
        it('strips leading and trailing punctuation while keeping the inner word', () => {
            expect(stripWordPunctuation('(sync)')).toBe('sync');
            expect(stripWordPunctuation('sync,')).toBe('sync');
            expect(stripWordPunctuation('"sync"')).toBe('sync');
            expect(stripWordPunctuation('—dash—')).toBe('dash');
        });

        it('keeps connector/symbol chars and inner punctuation', () => {
            // "+" is a math symbol (Sm), "_" is a connector (Pc); both are deliberately kept.
            expect(stripWordPunctuation('c++')).toBe('c++');
            expect(stripWordPunctuation('_private')).toBe('_private');
            // Inner apostrophe is preserved; only leading/trailing punctuation is stripped.
            expect(stripWordPunctuation("d'artagnan")).toBe("d'artagnan");
        });

        it('handles words that are entirely punctuation or empty', () => {
            expect(stripWordPunctuation('...')).toBe('');
            expect(stripWordPunctuation('')).toBe('');
        });
    });

    describe('tokenizeIntoWords', () => {
        it('normalizes, splits on whitespace and strips per-word punctuation', () => {
            expect(tokenizeIntoWords('see (sync) mode')).toEqual(['see', 'sync', 'mode']);
            expect(tokenizeIntoWords('sync, async')).toEqual(['sync', 'async']);
            expect(tokenizeIntoWords('"sync"')).toEqual(['sync']);
        });

        it('keeps symbol/connector tokens and inner punctuation intact', () => {
            expect(tokenizeIntoWords('c++ _private')).toEqual(['c++', '_private']);
            expect(tokenizeIntoWords("d'artagnan is dead")).toEqual(['d\'artagnan', 'is', 'dead']);
        });

        it('normalizes diacritics via the shared normalizer', () => {
            expect(tokenizeIntoWords('ktorý')).toEqual(['ktory']);
        });

        it('returns an empty array for empty or whitespace-only input', () => {
            expect(tokenizeIntoWords('')).toEqual([]);
            expect(tokenizeIntoWords('   ')).toEqual([]);
        });
    });

    describe('getAutoMaxEditDistance', () => {
        it('scales the allowed edit distance by token length', () => {
            // 0-3 chars: no fuzzy.
            expect(getAutoMaxEditDistance(0)).toBe(0);
            expect(getAutoMaxEditDistance(1)).toBe(0);
            expect(getAutoMaxEditDistance(2)).toBe(0);
            expect(getAutoMaxEditDistance(3)).toBe(0);
            // 4-6 chars: 1 edit.
            expect(getAutoMaxEditDistance(4)).toBe(1);
            expect(getAutoMaxEditDistance(5)).toBe(1);
            expect(getAutoMaxEditDistance(6)).toBe(1);
            // 7+ chars: 2 edits.
            expect(getAutoMaxEditDistance(7)).toBe(2);
            expect(getAutoMaxEditDistance(8)).toBe(2);
            expect(getAutoMaxEditDistance(20)).toBe(2);
        });

        it('gives a three-character token no edit budget at all', () => {
            // One edit reaches a different word rather than correcting a typo at this length,
            // so "for" must not match "fox" nor "not" match "now".
            expect(getAutoMaxEditDistance(3)).toBe(0);
            expect(fuzzyMatchWord('for', 'fox')).toBe(false);
            expect(fuzzyMatchWord('not', 'now')).toBe(false);
            // The token still matches itself, so an exact hit is unaffected.
            expect(fuzzyMatchWord('for', 'for')).toBe(true);
        });

        it('rejects distance-2 typos for short (<=6 char) tokens', () => {
            // "sync" (4) vs "send": d=2 > 1 -> no fuzzy match (was a false positive).
            expect(fuzzyMatchWord('sync', 'send')).toBe(false);
            // "ceck" (4) vs "tech": d=2 > 1 -> no fuzzy match.
            expect(fuzzyMatchWord('ceck', 'tech')).toBe(false);
        });

        it('allows distance-2 typos for longer (7+ char) tokens', () => {
            // "combinef" (8) vs "combined": d=1 <= 2 -> fuzzy match.
            expect(fuzzyMatchWord('combinef', 'combined')).toBe(true);
        });

        it('does not treat a substring word as a fuzzy match', () => {
            // "sync" is a substring of "async"; substring semantics belong to the
            // callers' own .includes() checks, not to the fuzzy matcher. So the
            // fuzzy matcher alone reports no match here.
            expect(fuzzyMatchWordWithResult('sync', 'async text')).toBeNull();
            // Sanity: a genuine 1-edit typo of a 4-char token still matches.
            expect(fuzzyMatchWordWithResult('sync', 'sinc')).toBe('sinc');
        });

        it('finds a word within the distance wherever the edits land', () => {
            // The chunk prefilter splits "abcdefg" into "ab", "cd" and "efg". Two edits reach at
            // most two of those, so every two-substitution variant keeps one chunk intact and
            // must still be found — a filter that left any chunk out would drop the variants
            // whose edits fall on the other two.
            const token = "abcdefg";

            for (let i = 0; i < token.length; i++) {
                for (let j = i + 1; j < token.length; j++) {
                    const characters = token.split("");
                    characters[i] = "z";
                    characters[j] = "z";
                    const variant = characters.join("");

                    expect(calculateOptimizedEditDistance(token, variant, 2)).toBeLessThanOrEqual(2);
                    expect(fuzzyMatchWordWithResult(token, variant, 2)).toBe(variant);
                }
            }
        });
    });

    describe('wordsContainPhrase', () => {
        it('matches a consecutive run of words in order', () => {
            expect(wordsContainPhrase(['a', 'exact', 'phrase', 'b'], ['exact', 'phrase'])).toBe(true);
            expect(wordsContainPhrase(['exact', 'phrase'], ['exact', 'phrase'])).toBe(true);
        });

        it('does not match non-consecutive or out-of-order words', () => {
            expect(wordsContainPhrase(['exact', 'x', 'phrase'], ['exact', 'phrase'])).toBe(false);
            expect(wordsContainPhrase(['phrase', 'exact'], ['exact', 'phrase'])).toBe(false);
        });

        it('never matches an empty phrase or a phrase longer than the haystack', () => {
            expect(wordsContainPhrase(['a', 'b'], [])).toBe(false);
            expect(wordsContainPhrase(['a'], ['a', 'b'])).toBe(false);
        });
    });
});

describe("input guards", () => {
    it("rejects invalid edit-distance arguments and handles empty and long strings", () => {
        expect(() => calculateOptimizedEditDistance(1 as unknown as string, "a")).toThrow("must be strings");
        expect(() => calculateOptimizedEditDistance("a", 2 as unknown as string)).toThrow("must be strings");
        expect(() => calculateOptimizedEditDistance("a", "b", -1)).toThrow("non-negative integer");
        expect(() => calculateOptimizedEditDistance("a", "b", 1.5)).toThrow("non-negative integer");

        expect(calculateOptimizedEditDistance("", "ab", 2)).toBe(2);
        expect(calculateOptimizedEditDistance("ab", "", 2)).toBe(2);
        expect(calculateOptimizedEditDistance("a".repeat(1001), "a".repeat(1002), 2)).toBe(1);
        expect(calculateOptimizedEditDistance("a".repeat(5), "a".repeat(1002), 2)).toBe(3);
    });

    it("normalizes only non-empty strings", () => {
        expect(normalizeSearchText("")).toBe("");
        expect(normalizeSearchText(5 as unknown as string)).toBe("");
        expect(normalizeSearchText("CAFÉ")).toBe("cafe");
    });

    it("rejects a missing operator, non-array tokens, non-string and overlong tokens", () => {
        expect(validateFuzzySearchTokens([ "a" ], "").isValid).toBe(false);
        expect(validateFuzzySearchTokens([ "a" ], 3 as unknown as string).error).toContain("Invalid operator");
        expect(validateFuzzySearchTokens("abc" as unknown as string[], "=").error).toContain("must be an array");
        expect(validateFuzzySearchTokens([ null as unknown as string ], "=").error).toContain("non-null strings");
        expect(validateFuzzySearchTokens([ 3 as unknown as string ], "=").error).toContain("non-null strings");
        expect(validateFuzzySearchTokens([ "a".repeat(101) ], "~*").error).toContain("too long");
        expect(validateFuzzySearchTokens([ "a".repeat(100) ], "~*").isValid).toBe(true);
    });

    it("returns null from fuzzy matching on non-string input or an internal error", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(fuzzyMatchWordWithResult(1 as unknown as string, "abc")).toBeNull();
        expect(fuzzyMatchWordWithResult("abc", 1 as unknown as string)).toBeNull();
        // A fractional distance passes the chunk filter but makes the edit-distance check throw.
        expect(fuzzyMatchWordWithResult("abc", "abd", 1.5)).toBeNull();
        expect(warn).toHaveBeenCalledOnce();
        warn.mockRestore();
    });
});

describe("validateAndPreprocessContent", () => {
    afterEach(() => vi.restoreAllMocks());

    it("returns null for empty or non-string content and passes ordinary content through", () => {
        expect(validateAndPreprocessContent("")).toBeNull();
        expect(validateAndPreprocessContent(5 as unknown as string)).toBeNull();
        expect(validateAndPreprocessContent("hello world", "note1")).toBe("hello world");
    });

    it("warns about large content and word counts but keeps it whole", () => {
        const info = vi.spyOn(console, "info").mockImplementation(() => {});

        const large = "x".repeat(FUZZY_SEARCH_CONFIG.PROGRESSIVE_PROCESSING_SIZE + 1);
        expect(validateAndPreprocessContent(large, "big")).toBe(large);
        expect(info.mock.calls.map(([ message ]) => String(message))).toEqual([
            expect.stringContaining("Large content for note big"),
            expect.stringContaining("Very large content for note big")
        ]);

        info.mockClear();
        const manyWords = "a ".repeat(FUZZY_SEARCH_CONFIG.PROGRESSIVE_PROCESSING_WORDS);
        expect(validateAndPreprocessContent(manyWords)).toBe(manyWords);
        expect(info.mock.calls.map(([ message ]) => String(message))).toEqual([
            expect.stringContaining("High word count for note unknown"),
            expect.stringContaining("Very large content for note unknown")
        ]);
    });

    it("truncates content beyond the absolute size and word limits", () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(console, "info").mockImplementation(() => {});

        const huge = "x".repeat(FUZZY_SEARCH_CONFIG.ABSOLUTE_MAX_CONTENT_SIZE + 1);
        expect(validateAndPreprocessContent(huge)?.length).toBe(FUZZY_SEARCH_CONFIG.ABSOLUTE_MAX_CONTENT_SIZE);

        const wordy = "a ".repeat(FUZZY_SEARCH_CONFIG.ABSOLUTE_MAX_WORD_COUNT + 1);
        expect(validateAndPreprocessContent(wordy, "wordy")?.split(" ")).toHaveLength(FUZZY_SEARCH_CONFIG.ABSOLUTE_MAX_WORD_COUNT);
        expect(error).toHaveBeenCalledTimes(2);
        expect(String(error.mock.calls[0][0])).toContain("note unknown");
        expect(String(error.mock.calls[1][0])).toContain("note wordy");
    });
});
