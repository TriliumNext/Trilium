/**
 * Cloze deletion parsing and rendering for flashcards.
 *
 * A cloze deletion uses Anki's `{{cN::text}}` syntax inside the note content,
 * with an optional hint: `{{c1::Paris::capital of France}}`. Each unique index
 * N produces one card (ordinal N-1). Reviewing card N hides only the text of
 * cN; all other deletions stay visible.
 */

const CLOZE_PATTERN = /\{\{c([1-9]\d*)::([\s\S]*?)\}\}/g;

/** Matches a single cloze deletion and captures its index and body. */
export function parseClozeDeletions(content: string): Array<{ index: number; text: string; hint?: string }> {
    const deletions: Array<{ index: number; text: string; hint?: string }> = [];
    for (const match of content.matchAll(CLOZE_PATTERN)) {
        const index = Number(match[1]);
        const body = match[2];
        const separator = body.indexOf("::");
        if (separator === -1) {
            deletions.push({ index, text: body });
        } else {
            deletions.push({ index, text: body.slice(0, separator), hint: body.slice(separator + 2) });
        }
    }
    return deletions;
}

/** True when the content contains at least one cloze deletion. */
export function isClozeContent(content: string) {
    return new RegExp(CLOZE_PATTERN.source).test(content);
}

/** Sorted unique 1-based cloze indices found in the content. */
export function extractClozeIndices(content: string): number[] {
    return [ ...new Set(parseClozeDeletions(content).map((d) => d.index)) ].sort((a, b) => a - b);
}

function replaceAll(content: string, replacer: (index: number, text: string, hint?: string) => string) {
    return content.replace(CLOZE_PATTERN, (_, rawIndex: string, body: string) => {
        const separator = body.indexOf("::");
        const text = separator === -1 ? body : body.slice(0, separator);
        const hint = separator === -1 ? undefined : body.slice(separator + 2);
        return replacer(Number(rawIndex), text, hint);
    });
}

/**
 * Renders the question side of cloze card `ordinal` (0-based): the target
 * deletion becomes an ellipsis (or its hint), every other deletion shows its
 * plain text.
 */
export function renderClozeFront(content: string, ordinal: number) {
    const target = ordinal + 1;
    return replaceAll(content, (index, text, hint) =>
        index === target
            ? `<span class="flashcard-cloze">${hint ? `[${hint}]` : "[...]"}</span>`
            : text);
}

/**
 * Renders the answer side of cloze card `ordinal` (0-based): the target
 * deletion is shown highlighted, every other deletion stays as plain text.
 */
export function renderClozeBack(content: string, ordinal: number) {
    const target = ordinal + 1;
    return replaceAll(content, (index, text) =>
        index === target
            ? `<span class="flashcard-cloze-revealed">${text}</span>`
            : text);
}
