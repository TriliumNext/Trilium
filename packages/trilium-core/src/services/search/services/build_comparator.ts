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
    "=": (comparedValue) => (val) => {
        // For the = operator, check if the value contains the exact word or phrase
        // This is case-insensitive
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
    "!=": (comparedValue) => (val) => {
        // Negation of exact word/phrase match
        if (!val) return true;

        const normalizedVal = normalizeSearchText(val);
        const normalizedCompared = normalizeSearchText(comparedValue);

        // If comparedValue has spaces, it's a multi-word phrase
        // Check for substring match (consecutive phrase) and negate
        if (normalizedCompared.includes(" ")) {
            return !normalizedVal.includes(normalizedCompared);
        }

        // For single word, tokenize into punctuation-stripped words and check for
        // an exact word match, then negate.
        const words = tokenizeIntoWords(normalizedVal);
        return !words.some(word => word === stripWordPunctuation(normalizedCompared));
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
