import { FUZZY_SEARCH_CONFIG, wordsContainPhrase } from "./utils/text_utils.js";

/**
 * Quality tiers describing how well a note's body content matched the query,
 * ordered from weakest to strongest. Propagated from expression evaluation into
 * scoring so that a note whose body contains the exact query phrase outranks a
 * note that merely contains the individual words scattered around.
 */
export type ContentMatchTier = "fuzzy" | "substring" | "word_prefix" | "exact_word" | "proximity" | "exact_phrase";

export interface ContentMatchQuality {
    /** The best tier achieved for this note's content. */
    tier: ContentMatchTier;
    /** Number of distinct query tokens that matched at any tier (scoring caps this at 5). */
    matchedTokenCount: number;
    /** Proximity only: whether the tokens appeared in query order within the window. */
    inOrder: boolean;
}

const TIER_RANK: Record<ContentMatchTier, number> = {
    fuzzy: 0,
    substring: 1,
    word_prefix: 2,
    exact_word: 3,
    proximity: 4,
    exact_phrase: 5
};

/** Numeric rank of a tier; higher is a stronger match. */
export function tierRank(tier: ContentMatchTier): number {
    return TIER_RANK[tier];
}

/**
 * Returns the better of two content-match qualities: the higher tier wins, and
 * a tier tie is broken by the higher matched-token count. Used to merge multiple
 * matches recorded for the same note.
 */
export function betterQuality(a: ContentMatchQuality, b: ContentMatchQuality): ContentMatchQuality {
    const rankA = tierRank(a.tier);
    const rankB = tierRank(b.tier);

    if (rankA !== rankB) {
        return rankA > rankB ? a : b;
    }

    return b.matchedTokenCount > a.matchedTokenCount ? b : a;
}

/**
 * Classifies how well a set of already-normalized query tokens matches a note's
 * already-tokenized content words, returning the best tier plus how many distinct
 * tokens matched (at any tier). Returns null when nothing matched.
 *
 * This is a pure function: tokens and contentWords must already be normalized and
 * tokenized (e.g. via {@link tokenizeIntoWords}) by the caller. It never computes
 * edit distances — the "fuzzy" tier is recorded by callers when only fuzzy matching
 * succeeded.
 */
export function classifyContentMatch(tokens: string[], contentWords: string[]): ContentMatchQuality | null {
    if (tokens.length === 0 || contentWords.length === 0) {
        return null;
    }

    const filteredTokens = tokens.filter((token) => token.length > 0);
    // Distinct tokens preserve first-appearance order (Set iteration order).
    const distinctTokens = Array.from(new Set(filteredTokens));
    if (distinctTokens.length === 0) {
        return null;
    }

    // Map each exact content word to its sorted positions for proximity/phrase checks.
    const wordPositions = new Map<string, number[]>();
    contentWords.forEach((word, index) => {
        const positions = wordPositions.get(word);
        if (positions) {
            positions.push(index);
        } else {
            wordPositions.set(word, [index]);
        }
    });

    let anyExact = false;
    let anyPrefix = false;
    let allExact = true;
    let matchedTokenCount = 0;
    const positionLists: number[][] = [];

    for (const token of distinctTokens) {
        const exactPositions = wordPositions.get(token) ?? [];
        positionLists.push(exactPositions);

        if (exactPositions.length > 0) {
            anyExact = true;
            matchedTokenCount++;
            continue;
        }

        allExact = false;

        if (contentWords.some((word) => word.startsWith(token))) {
            anyPrefix = true;
            matchedTokenCount++;
        } else if (contentWords.some((word) => word.includes(token))) {
            matchedTokenCount++;
        }
    }

    if (matchedTokenCount === 0) {
        return null;
    }

    const maxSpan = FUZZY_SEARCH_CONFIG.MAX_PHRASE_PROXIMITY;
    let tier: ContentMatchTier;
    let inOrder = false;

    if (filteredTokens.length >= 2 && wordsContainPhrase(contentWords, filteredTokens)) {
        tier = "exact_phrase";
    } else if (distinctTokens.length >= 2 && allExact && withinProximityWindow(positionLists, maxSpan)) {
        tier = "proximity";
        inOrder = inOrderWithinWindow(positionLists, maxSpan);
    } else if (anyExact) {
        tier = "exact_word";
    } else if (anyPrefix) {
        tier = "word_prefix";
    } else {
        tier = "substring";
    }

    return { tier, matchedTokenCount, inOrder };
}

/**
 * True when there is a window of at most `maxSpan` word positions containing at
 * least one occurrence of every token's position list. Classic minimum-window
 * sweep over the merged, position-sorted occurrences.
 */
function withinProximityWindow(positionLists: number[][], maxSpan: number): boolean {
    const merged: { position: number; listIndex: number }[] = [];
    positionLists.forEach((positions, listIndex) => {
        for (const position of positions) {
            merged.push({ position, listIndex });
        }
    });
    merged.sort((a, b) => a.position - b.position);

    const need = positionLists.length;
    const counts = new Array<number>(need).fill(0);
    let have = 0;
    let left = 0;

    for (let right = 0; right < merged.length; right++) {
        if (counts[merged[right].listIndex]++ === 0) {
            have++;
        }

        while (have === need) {
            if (merged[right].position - merged[left].position <= maxSpan) {
                return true;
            }
            if (--counts[merged[left].listIndex] === 0) {
                have--;
            }
            left++;
        }
    }

    return false;
}

/**
 * True when one occurrence per token can be chosen in strictly increasing
 * position order (i.e. query order) with the whole run spanning at most `maxSpan`
 * words. Position lists across distinct tokens are disjoint, so strict increase
 * is safe.
 */
function inOrderWithinWindow(positionLists: number[][], maxSpan: number): boolean {
    const [firstPositions, ...restLists] = positionLists;

    for (const start of firstPositions) {
        let previous = start;
        let ok = true;

        for (const positions of restLists) {
            const next = positions.find((position) => position > previous);
            if (next === undefined) {
                ok = false;
                break;
            }
            previous = next;
        }

        if (ok && previous - start <= maxSpan) {
            return true;
        }
    }

    return false;
}
