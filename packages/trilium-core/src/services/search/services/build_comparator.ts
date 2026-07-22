import { FUZZY_SEARCH_CONFIG, fuzzyMatchWord, normalizeSearchText, stripWordPunctuation, tokenizeIntoWords } from "../utils/text_utils.js";

const cachedRegexes: Record<string, RegExp> = {};

function getRegex(str: string) {
    if (!(str in cachedRegexes)) {
        cachedRegexes[str] = new RegExp(str);
    }

    return cachedRegexes[str];
}

type Comparator<T> = (comparedValue: T) => (val: string) => boolean;

const stringComparators: Record<string, Comparator<string>> = {
    // Strict normalized full-value equality: the whole value must equal the whole
    // compared value (case- and diacritic-insensitive). This is the documented
    // label-equality semantics — e.g. #capital=Vienna matches "vienna" but NOT
    // "Vienna Austria". Word/phrase matching lives in the internal "word=" operator.
    "=": (comparedValue) => (val) => normalizeSearchText(val) === normalizeSearchText(comparedValue),
    "!=": (comparedValue) => (val) => normalizeSearchText(val) !== normalizeSearchText(comparedValue),
    // Internal operator (not user-typable): word/phrase match used by the leading-"="
    // fulltext title comparison. Punctuation-aware via Task 1's helpers.
    "word=": (comparedValue) => (val) => {
        if (!val) return false;

        const normalizedVal = normalizeSearchText(val);
        const normalizedCompared = normalizeSearchText(comparedValue);

        // If comparedValue has spaces, it's a multi-word phrase
        // Check for substring match (consecutive phrase)
        if (normalizedCompared.includes(" ")) {
            return normalizedVal.includes(normalizedCompared);
        }

        // For single word, tokenize into punctuation-stripped words and check for
        // an exact word match, so a value like "(Books)" matches the token "books".
        const words = tokenizeIntoWords(normalizedVal);
        return words.some(word => word === stripWordPunctuation(normalizedCompared));
    },
    ">": (comparedValue) => (val) => val > comparedValue,
    ">=": (comparedValue) => (val) => val >= comparedValue,
    "<": (comparedValue) => (val) => val < comparedValue,
    "<=": (comparedValue) => (val) => val <= comparedValue,
    "*=": (comparedValue) => (val) => !!val && val.endsWith(comparedValue),
    "=*": (comparedValue) => (val) => !!val && val.startsWith(comparedValue),
    "*=*": (comparedValue) => (val) => !!val && val.includes(comparedValue),
    "%=": (comparedValue) => (val) => !!val && !!getRegex(comparedValue).test(val),
    "~=": (comparedValue) => (val) => {
        if (!val || !comparedValue) return false;
        
        // Validate minimum length for fuzzy search to prevent false positives
        if (comparedValue.length < FUZZY_SEARCH_CONFIG.MIN_FUZZY_TOKEN_LENGTH) {
            return val.includes(comparedValue);
        }
        
        const normalizedVal = normalizeSearchText(val);
        const normalizedCompared = normalizeSearchText(comparedValue);
        
        // First try exact substring match
        if (normalizedVal.includes(normalizedCompared)) {
            return true;
        }
        
        // Then try fuzzy word matching over the tokenized (punctuation-stripped) value
        const words = tokenizeIntoWords(normalizedVal);
        return words.some(word => fuzzyMatchWord(normalizedCompared, word));
    },
    "~*": (comparedValue) => (val) => {
        if (!val || !comparedValue) return false;
        
        // Validate minimum length for fuzzy search
        if (comparedValue.length < FUZZY_SEARCH_CONFIG.MIN_FUZZY_TOKEN_LENGTH) {
            return val.includes(comparedValue);
        }
        
        const normalizedVal = normalizeSearchText(val);
        const normalizedCompared = normalizeSearchText(comparedValue);

        // "~*" is fuzzy CONTAINS: first try a plain substring (fragment) match, so
        // a fragment like "progr" matches "programming" (mirrors the ~= fallback).
        // Then fall back to fuzzy matching for typos that are not substrings.
        if (normalizedVal.includes(normalizedCompared)) {
            return true;
        }

        return fuzzyMatchWord(normalizedCompared, normalizedVal);
    }
};

const numericComparators: Record<string, Comparator<number>> = {
    ">": (comparedValue) => (val) => parseFloat(val) > comparedValue,
    ">=": (comparedValue) => (val) => parseFloat(val) >= comparedValue,
    "<": (comparedValue) => (val) => parseFloat(val) < comparedValue,
    "<=": (comparedValue) => (val) => parseFloat(val) <= comparedValue
};

function buildComparator(operator: string, comparedValue: string) {
    comparedValue = comparedValue.toLowerCase();

    if (operator in numericComparators && !isNaN(+comparedValue)) {
        return numericComparators[operator](parseFloat(comparedValue));
    }

    if (operator in stringComparators) {
        return stringComparators[operator](comparedValue);
    }
}

export default buildComparator;
