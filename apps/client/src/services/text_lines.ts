/** A run of text on one line of an element, where the browser laid it out. */
export interface TextLine {
    text: string;
    /** The left edge of the text, relative to the element's border box. */
    x: number;
    /** The vertical middle of the glyphs, relative to the element's border box. */
    centerY: number;
    /** The element that holds the first character of the text, whose style the text has. */
    source: Element;
}

/**
 * Splits the text of an element into the lines the browser wrapped it into, from the client rects
 * of a `Range` over the text. Text on one line costs one `getClientRects()` call; wrapped text is
 * measured one character at a time.
 *
 * Client rects are in screen space, which a CSS zoom of an ancestor scales, so they are converted
 * back to the unscaled layout space of `offsetLeft`/`offsetTop`.
 *
 * With `splitNodes`, the text of each text node on a line is a `TextLine` of its own, for an
 * element whose descendants style their text differently. Otherwise a line is one `TextLine`.
 *
 * @returns the lines, or `null` when the element is not laid out (hidden, or no layout engine).
 */
export function measureTextLines(element: HTMLElement, splitNodes = false): TextLine[] | null {
    const box = element.getBoundingClientRect();
    const textNodes = getTextNodes(element);
    const range = document.createRange();
    if (!box.width || !textNodes.length || typeof range.getClientRects !== "function") {
        return null;
    }

    const scale = element.offsetWidth / box.width || 1;
    const toLine = (text: string, rect: DOMRect, source: Element): TextLine => ({
        text,
        x: (rect.left - box.left) * scale,
        centerY: (rect.top + rect.height / 2 - box.top) * scale,
        source
    });

    range.selectNodeContents(element);
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width && rect.height);
    if (!rects.length) {
        return null;
    }
    const isOneRun = !splitNodes || textNodes.length === 1;
    if (isOneRun && rects.every((rect) => Math.abs(rect.top - rects[0].top) < rects[0].height / 2)) {
        const source = (splitNodes && textNodes[0].parentElement) || element;
        return [ toLine((element.textContent ?? "").replace(/\n/g, "").trimEnd(), rects[0], source) ];
    }

    const lines: { text: string; rect: DOMRect; node: Text }[] = [];
    for (const node of textNodes) {
        for (let index = 0; index < node.data.length; index++) {
            const character = node.data[index];
            const current = lines.at(-1);
            if (character === "\n") {
                continue;
            }
            range.setStart(node, index);
            range.setEnd(node, index + 1);
            const rect = range.getBoundingClientRect();
            const isSameLine = current && (!rect.height || rect.top < current.rect.top + current.rect.height / 2);
            if (current && isSameLine && (!splitNodes || current.node === node)) {
                current.text += character;
            } else if (rect.height) {
                lines.push({ text: character, rect, node });
            }
        }
    }
    return lines
        .map(({ text, rect, node }) => toLine(text.trimEnd(), rect, (splitNodes && node.parentElement) || element))
        .filter((line) => line.text);
}

/** The lines of an element that is not laid out: its hard line breaks, spaced by its line height. */
export function estimateTextLines(element: HTMLElement, style: CSSStyleDeclaration): TextLine[] {
    const fontSize = Number.parseFloat(style.fontSize) || 16;
    const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.2;
    const x = (Number.parseFloat(style.borderLeftWidth) || 0) + (Number.parseFloat(style.paddingLeft) || 0);
    const top = (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.paddingTop) || 0);

    return (element.textContent ?? "").split("\n")
        .map((text, index) => ({
            text: text.trimEnd(), x, centerY: top + lineHeight * (index + 0.5), source: element
        }))
        .filter((line) => line.text);
}

function getTextNodes(element: HTMLElement) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        nodes.push(node as Text);
    }
    return nodes;
}
