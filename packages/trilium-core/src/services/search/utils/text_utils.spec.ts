import { describe, it, expect } from "vitest";
import { calculateOptimizedEditDistance, validateFuzzySearchTokens, fuzzyMatchWord, fuzzyMatchWordWithResult, getAutoMaxEditDistance, stripWordPunctuation, tokenizeIntoWords, wordsContainPhrase } from './text_utils.js';

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