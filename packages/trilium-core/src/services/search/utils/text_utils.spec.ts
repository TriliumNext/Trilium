import { describe, it, expect } from "vitest";
import { calculateOptimizedEditDistance, validateFuzzySearchTokens, fuzzyMatchWord, stripHtmlTags } from './text_utils.js';

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

        it('matches with typos within distance threshold', () => {
            expect(fuzzyMatchWord('hello', 'helo')).toBe(true);
            expect(fuzzyMatchWord('world', 'wrold')).toBe(true);
            expect(fuzzyMatchWord('test', 'tset')).toBe(true);
            expect(fuzzyMatchWord('test', 'xyz')).toBe(false);
        });

        it('handles edge cases safely', () => {
            expect(fuzzyMatchWord('', 'test')).toBe(false);
            expect(fuzzyMatchWord('test', '')).toBe(false);
            expect(fuzzyMatchWord('a', 'b')).toBe(false); // Very short tokens
        });
    });

    describe('stripHtmlTags', () => {
        it('strips simple HTML tags', () => {
            expect(stripHtmlTags('<p>Hello</p>')).toBe('Hello');
            expect(stripHtmlTags('<div><span>World</span></div>')).toBe('World');
            expect(stripHtmlTags('<b>Bold</b> and <i>italic</i>')).toBe('Bold and italic');
        });

        it('handles self-closing tags', () => {
            expect(stripHtmlTags('Line1<br/>Line2')).toBe('Line1Line2');
            expect(stripHtmlTags('Image: <img src="x.png"/>')).toBe('Image: ');
        });

        it('handles tags with attributes', () => {
            expect(stripHtmlTags('<a href="url">Link</a>')).toBe('Link');
            expect(stripHtmlTags('<div class="foo" id="bar">Content</div>')).toBe('Content');
        });

        it('handles nested tag patterns securely', () => {
            // Security property: no complete <tag> patterns remain after stripping
            // Residual `>` chars are harmless for XSS

            // Nested tags: inner tag removed, then outer tag removed
            // <a<b>c> → <ac> → '' (but leaves residual `c>`)
            const result1 = stripHtmlTags('<a<b>c>text');
            expect(result1).not.toMatch(/<[a-z]/i); // No opening tags remain
            expect(result1).toBe('c>text'); // Residual text is safe

            // Complex nesting leaves no exploitable patterns
            const result2 = stripHtmlTags('<scr<script>ipt>alert(1)</script>');
            expect(result2).not.toMatch(/<script/i);
            expect(result2).not.toMatch(/<\/script/i);

            // Double-nested removal
            const result3 = stripHtmlTags('<<b>script>code');
            expect(result3).toBe('script>code'); // <b> removed, then < alone doesn't match
            expect(result3).not.toMatch(/<[a-z]/i);
        });

        it('handles unclosed tags', () => {
            expect(stripHtmlTags('<p>Unclosed paragraph')).toBe('Unclosed paragraph');
            expect(stripHtmlTags('Text with <b>unclosed bold')).toBe('Text with unclosed bold');
        });

        it('handles empty and null input', () => {
            expect(stripHtmlTags('')).toBe('');
            expect(stripHtmlTags(null as any)).toBe('');
            expect(stripHtmlTags(undefined as any)).toBe('');
        });

        it('returns plain text unchanged', () => {
            expect(stripHtmlTags('Just plain text')).toBe('Just plain text');
            expect(stripHtmlTags('No tags here!')).toBe('No tags here!');
        });

        it('handles angle brackets in text', () => {
            // Standalone > without matching < is preserved
            expect(stripHtmlTags('Text > with > symbols')).toBe('Text > with > symbols');
            // Note: `< 10 >` looks like a tag to the regex - this is a known limitation
            // For search snippets, this is acceptable as it's still safe (no XSS)
            expect(stripHtmlTags('Math: 5 < 10 > 3')).toBe('Math: 5  3');
            // But properly escaped content works
            expect(stripHtmlTags('5 &lt; 10')).toBe('5 &lt; 10');
        });
    });
});