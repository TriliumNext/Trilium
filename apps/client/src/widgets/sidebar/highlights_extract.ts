import { randomString } from "../../services/utils";

/**
 * A formatted run of text, as the highlights sidebar consumes it. Every producer — the text
 * editor, read-only HTML, the Markdown preview — reduces its own representation to this.
 */
export interface RawHighlight {
    id: string;
    /** Inline HTML of the run, so nested content (e.g. maths) survives into the list. */
    text: string;
    attrs: {
        bold: boolean;
        italic: boolean;
        underline: boolean;
        color: string | undefined;
        background: string | undefined;
    }
}

export interface DomHighlight extends RawHighlight {
    element: HTMLElement;
}

/**
 * Collects the formatted runs of a rendered HTML tree: coloured runs first, then bold/italic/
 * underline ones that are not already inside a coloured run.
 *
 * Used both for read-only text notes and for the Markdown preview, whose rendered HTML this
 * treats identically — `**bold**` reaches here as `<strong>` like any other.
 */
export function extractHighlightsFromStaticHtml(el: HTMLElement | null) {
    if (!el) return [];

    const highlights: DomHighlight[] = [];
    const processedElements = new Set<Element>();

    // Find all elements with inline background-color or color styles
    const styledElements = el.querySelectorAll<HTMLElement>('[style*="background-color"], [style*="color"]');

    for (const styledEl of styledElements) {
        /* v8 ignore next -- nothing is in the set yet on this pass; kept to mirror the second */
        if (processedElements.has(styledEl)) continue;
        if (!styledEl.textContent?.trim()) continue;

        record(highlights, processedElements, styledEl, {
            bold: !!styledEl.closest("strong"),
            italic: !!styledEl.closest("em"),
            underline: !!styledEl.closest("u"),
            background: styledEl.style.backgroundColor,
            color: styledEl.style.color
        });
    }

    // Also find bold, italic, underline elements
    const formattingElements = el.querySelectorAll<HTMLElement>("strong, em, u, b, i");

    for (const formattedEl of formattingElements) {
        if (processedElements.has(formattedEl)) continue;
        if (!formattedEl.textContent?.trim()) continue;
        if (isAlreadyReported(formattedEl, processedElements)) continue;

        record(highlights, processedElements, formattedEl, {
            bold: formattedEl.matches("strong, b"),
            italic: formattedEl.matches("em, i"),
            underline: formattedEl.matches("u"),
            background: formattedEl.style.backgroundColor,
            color: formattedEl.style.color
        });
    }

    return highlights;
}

/** Records a run, unless nothing about it is worth reporting — a `border-color`, say. */
function record(
    highlights: DomHighlight[],
    processedElements: Set<Element>,
    element: HTMLElement,
    attrs: RawHighlight["attrs"]
) {
    if (!Object.values(attrs).some(Boolean)) return;

    processedElements.add(element);
    highlights.push({
        id: randomString(),
        text: element.innerHTML,
        element,
        attrs
    });
}

/**
 * The rendered markup of a run, read off the element the editor's mapper landed in — but only
 * when that element holds the run and nothing besides, so nested content (a formula inside a
 * coloured run) survives into the list.
 *
 * The mapper does not reliably land on the formatting element. A run at the very start of a
 * block maps to the *block*, because `Mapper#findPositionIn` returns the container position
 * unchanged when the node after it is not a text node — so a paragraph opening with a coloured
 * word would otherwise be listed with the whole paragraph as its text. The run's own text is
 * the safe answer there.
 */
export function htmlForRun(element: HTMLElement, data: string): string {
    return element.textContent?.trim() === data.trim() ? element.innerHTML : data;
}

/**
 * Whether the runs already recorded by the colour pass account for all of this element, making
 * it a repeat: either it sits inside one, or every piece of text it holds is inside one.
 *
 * That second shape is what formatting around colour looks like — `**==hl==**` renders as
 * `<strong><span style="background-color:…">hl</span></strong>` — and it holds however many
 * runs the formatting is split across, so the test is per text node rather than a comparison
 * of whole strings. Those runs already report the formatting, since the colour pass resolves
 * it with `closest`, and repeating them under the `<strong>` would lose their colours.
 *
 * Text of the element's own keeps it: in `<strong>a <span style="color:red">b</span> c</strong>`
 * the bold "a … c" is a run nothing else reports. Whitespace between runs is not such text.
 */
function isAlreadyReported(element: HTMLElement, processedElements: Set<Element>): boolean {
    const processed = Array.from(processedElements);

    if (processed.some((other) => other.contains(element))) return true;

    const textNodes = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);

    for (let node = textNodes.nextNode(); node; node = textNodes.nextNode()) {
        if (!node.textContent?.trim()) continue;
        if (!processed.some((other) => other.contains(node))) return false;
    }

    return true;
}
