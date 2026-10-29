/**
 * Marks up the word-level difference between two HTML fragments: the new fragment, with each
 * deleted run of text in a `<del>` and each inserted one in an `<ins>`. A run that replaces another
 * gets the class `diffmod` on both marks, a plain insertion `diffins` and a plain deletion `diffdel`.
 *
 * It follows htmldiff (and its `htmldiff-js` port): the fragments are split into words, tags,
 * whitespace and punctuation, and aligned on the longest common run of those, then recursively on
 * the longest runs on either side of it. Aligning on long runs rather than on the shortest edit
 * keeps a reworded sentence readable, where a minimal diff would match every "a" and "the" in it;
 * {@link mergeShortUnchangedRuns} then folds what short matches remain into the changes around them.
 *
 * Tags are compared without their attributes, so a changed attribute alone is not marked; an
 * `<img>` counts as a word, attributes included, so a changed image is. A deleted formatting tag
 * (`<strong>`, `<em>`, …) is dropped from the output, which shows the formatting the new fragment
 * has.
 */
export function diffHtml(oldHtml: string, newHtml: string): string {
    if (oldHtml === newHtml) {
        return newHtml;
    }

    const oldTokens = tokenize(oldHtml);
    const newTokens = tokenize(newHtml);
    const matches = findMatchingRuns(oldTokens.map(toKey), newTokens.map(toKey));
    matches.push({ inOld: oldTokens.length, inNew: newTokens.length, size: 0 });

    const segments: Segment[] = [];
    let positionInOld = 0;
    let positionInNew = 0;
    for (const match of matches) {
        const deleted = oldTokens.slice(positionInOld, match.inOld);
        const inserted = newTokens.slice(positionInNew, match.inNew);
        if (deleted.length || inserted.length) {
            segments.push({ deleted, inserted });
        }
        if (match.size) {
            segments.push({ unchanged: newTokens.slice(match.inNew, match.inNew + match.size) });
        }
        positionInOld = match.inOld + match.size;
        positionInNew = match.inNew + match.size;
    }

    const output: string[] = [];
    for (const segment of mergeShortUnchangedRuns(segments)) {
        if ("unchanged" in segment) {
            output.push(...segment.unchanged);
            continue;
        }
        const isReplacement = segment.deleted.length > 0 && segment.inserted.length > 0;
        markRun(output, "del", isReplacement ? "diffmod" : "diffdel", segment.deleted);
        markRun(output, "ins", isReplacement ? "diffmod" : "diffins", segment.inserted);
    }

    return output.join("");
}

/** A run of `size` tokens that starts at `inOld` in the old fragment and at `inNew` in the new one. */
interface Match {
    inOld: number;
    inNew: number;
    size: number;
}

/** A run of tokens both fragments have, or the tokens the new fragment has instead of the old one's. */
type Segment = { unchanged: string[] } | { deleted: string[]; inserted: string[] };

/**
 * Folds each unchanged run between two changes into them when its text is no longer than the
 * larger side of the change on either side of it, which is the semantic cleanup of Google's
 * diff-match-patch. Without it a reworded phrase is aligned on the spaces and short words it
 * shares, and reads as the old and the new phrase interleaved a word at a time. A run that holds
 * a tag stays, so that no tag is emitted on both sides of a change.
 */
function mergeShortUnchangedRuns(segments: Segment[]) {
    const merged = [ ...segments ];
    for (let index = 1; index < merged.length - 1;) {
        const before = merged[index - 1];
        const segment = merged[index];
        const after = merged[index + 1];
        if (!("unchanged" in segment) || "unchanged" in before || "unchanged" in after
            || segment.unchanged.some(isTag)) {
            index++;
            continue;
        }

        const length = textLength(segment.unchanged);
        if (length > changeLength(before) || length > changeLength(after)) {
            index++;
            continue;
        }

        merged.splice(index - 1, 3, {
            deleted: [ ...before.deleted, ...segment.unchanged, ...after.deleted ],
            inserted: [ ...before.inserted, ...segment.unchanged, ...after.inserted ]
        });
        // The merged change is longer, so the unchanged run before it can now qualify too.
        index = Math.max(1, index - 1);
    }
    return merged;
}

function changeLength(change: { deleted: string[]; inserted: string[] }) {
    return Math.max(textLength(change.deleted), textLength(change.inserted));
}

function textLength(tokens: string[]) {
    return tokens.reduce((length, token) => length + (isTag(token) ? 0 : token.length), 0);
}

/**
 * A tag, an entity, a run of whitespace, a word, or any other single character. Chinese and
 * Japanese characters are words of their own, since those scripts put no spaces between words.
 */
const TOKEN = /<[^>]*>?|&#?\w+;|\s+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{M}\p{N}_#@]+|./gsu;

/** The tags whose deletion changes only how the text looks. */
const FORMATTING_TAG = /^<\/?(strong|b|i|em|big|small|u|sub|sup|strike|s)[\s>/]/i;

/**
 * The longest run is first looked for in blocks of this many tokens and then of fewer, which
 * makes it cheaper to find in long fragments, whose single tokens repeat a lot.
 */
const MAX_BLOCK_SIZE = 4;

function tokenize(html: string) {
    return html.match(TOKEN) ?? [];
}

function isTag(token: string) {
    return token.startsWith("<") && !token.toLowerCase().startsWith("<img");
}

/** What a token is compared by: a tag without its attributes. */
function toKey(token: string) {
    if (!isTag(token)) {
        return token;
    }
    const name = /^<\/?[^\s>/]*/.exec(token)?.[0] ?? token;
    return name + (token.endsWith("/>") ? "/>" : ">");
}

/**
 * Wraps each run of text among `tokens` in `<mark class="cssClass">`, and leaves the tags between
 * them out of the marks, apart from the formatting tags of a deletion, which it drops.
 */
function markRun(output: string[], mark: "ins" | "del", cssClass: string, tokens: string[]) {
    let text: string[] = [];
    const flush = () => {
        if (text.length) {
            // A mark that starts with a space would show nothing where the space is.
            if (text[0] === " ") text[0] = "&nbsp;";
            output.push(`<${mark} class="${cssClass}">${text.join("")}</${mark}>`);
            text = [];
        }
    };

    for (const token of tokens) {
        if (!isTag(token)) {
            text.push(token);
            continue;
        }

        flush();
        if (mark === "ins" || !FORMATTING_TAG.test(token)) {
            output.push(token);
        }
    }
    flush();
}

/** The runs the two fragments have in common, in order, found longest first. */
function findMatchingRuns(oldKeys: string[], newKeys: string[]) {
    const maxBlockSize = Math.min(MAX_BLOCK_SIZE, oldKeys.length, newKeys.length);
    const matches: Match[] = [];
    const ranges = [ { startInOld: 0, endInOld: oldKeys.length, startInNew: 0, endInNew: newKeys.length } ];

    for (let range = ranges.pop(); range; range = ranges.pop()) {
        const match = findLongestRun(oldKeys, newKeys, range, maxBlockSize);
        if (!match) continue;

        matches.push(match);
        if (range.startInOld < match.inOld && range.startInNew < match.inNew) {
            ranges.push({ ...range, endInOld: match.inOld, endInNew: match.inNew });
        }
        if (match.inOld + match.size < range.endInOld && match.inNew + match.size < range.endInNew) {
            ranges.push({ ...range, startInOld: match.inOld + match.size, startInNew: match.inNew + match.size });
        }
    }

    return matches.sort((a, b) => a.inOld - b.inOld);
}

interface Range {
    startInOld: number;
    endInOld: number;
    startInNew: number;
    endInNew: number;
}

function findLongestRun(oldKeys: string[], newKeys: string[], range: Range, maxBlockSize: number) {
    for (let blockSize = maxBlockSize; blockSize > 0; blockSize--) {
        const match = findLongestRunOfBlocks(oldKeys, newKeys, range, blockSize);
        if (match) return match;
    }
    return null;
}

/**
 * The longest run of consecutive common blocks of `blockSize` tokens, the earliest in the old
 * fragment and then in the new one among equally long runs.
 */
function findLongestRunOfBlocks(oldKeys: string[], newKeys: string[], range: Range, blockSize: number): Match | null {
    const blockKey = (keys: string[], end: number) => keys.slice(end - blockSize + 1, end + 1).join("\0");

    /** The positions in the new fragment at which each block ends. */
    const blockEndsInNew = new Map<string, number[]>();
    for (let index = range.startInNew + blockSize - 1; index < range.endInNew; index++) {
        const key = blockKey(newKeys, index);
        const ends = blockEndsInNew.get(key);
        if (ends) {
            ends.push(index);
        } else {
            blockEndsInNew.set(key, [ index ]);
        }
    }

    let best: Match | null = null;
    /** For each block end in the new fragment, the run of common blocks ending there. */
    let runLengths = new Map<number, number>();
    for (let indexInOld = range.startInOld + blockSize - 1; indexInOld < range.endInOld; indexInOld++) {
        const nextRunLengths = new Map<number, number>();
        for (const indexInNew of blockEndsInNew.get(blockKey(oldKeys, indexInOld)) ?? []) {
            const runLength = (runLengths.get(indexInNew - 1) ?? 0) + 1;
            nextRunLengths.set(indexInNew, runLength);

            const size = runLength + blockSize - 1;
            if (!best || size > best.size) {
                best = { inOld: indexInOld - size + 1, inNew: indexInNew - size + 1, size };
            }
        }
        runLengths = nextRunLengths;
    }

    return best;
}
