import { decodeHtmlEntities } from "@triliumnext/commons";

/** An element of a document that `parseXml()` read. */
export interface XmlElement {
    /** The local name, in lower case. */
    name: string;
    /** By name in lower case, the values with entities decoded. */
    attributes: Map<string, string>;
    children: XmlNode[];
}

export type XmlNode = XmlElement | { text: string };

/** A tag or a run of text, as `readTokens()` reads them. */
export type XmlToken =
    | {
        kind: "start"; name: string; start: number; end: number; isSelfClosing: boolean;
        attributes: Map<string, string>;
    }
    | { kind: "end"; name: string; start: number; end: number }
    /** Text as written, entities included, or the content of a CDATA section. */
    | { kind: "text"; raw: string; isCdata: boolean };

/** The elements that have no content and no end tag in HTML. */
export const VOID_ELEMENTS = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track",
    "wbr"
]);
/** The elements whose content is text up to their end tag. */
const RAW_TEXT_ENDS: Record<string, RegExp> = {
    script: /<\/script[\s>]/gi,
    style: /<\/style[\s>]/gi
};

/**
 * The elements of `text`, an XML document or, when `isHtml`, an XHTML one, whose void elements
 * have no content even when they are not written self-closing.
 */
export function parseXml(text: string, isHtml: boolean): XmlElement {
    const root: XmlElement = { name: "", attributes: new Map(), children: [] };
    const stack = [ root ];
    for (const token of readTokens(text, isHtml)) {
        const parent = stack[stack.length - 1];
        if (token.kind === "text") {
            const text = token.isCdata ? token.raw : decodeHtmlEntities(token.raw);
            parent.children.push({ text });
        } else if (token.kind === "start") {
            const element = { name: token.name, attributes: token.attributes, children: [] };
            parent.children.push(element);
            if (!token.isSelfClosing && !(isHtml && VOID_ELEMENTS.has(token.name))) {
                stack.push(element);
            }
        } else {
            const index = stack.findLastIndex(({ name }) => name === token.name);
            if (index > 0) {
                stack.length = index;
            }
        }
    }
    return root;
}

/**
 * The tags and text of `text`, in order. Comments, processing instructions and declarations are
 * skipped; a CDATA section is text. In an XHTML document (`isHtml`), the content of `<script>`
 * and `<style>` is text up to their end tag. Names are local names in lower case.
 */
export function* readTokens(text: string, isHtml: boolean): Generator<XmlToken> {
    let at = 0;
    while (at < text.length) {
        const open = text.indexOf("<", at);
        if (open < 0) {
            yield { kind: "text", raw: text.slice(at), isCdata: false };
            return;
        }
        if (open > at) {
            yield { kind: "text", raw: text.slice(at, open), isCdata: false };
        }

        if (text.startsWith("<!--", open)) {
            at = skipPast(text, "-->", open + 4);
        } else if (text.startsWith("<![CDATA[", open)) {
            const end = text.indexOf("]]>", open + 9);
            const raw = text.slice(open + 9, end < 0 ? text.length : end);
            yield { kind: "text", raw, isCdata: true };
            at = end < 0 ? text.length : end + 3;
        } else if (text.startsWith("<?", open)) {
            at = skipPast(text, "?>", open + 2);
        } else if (text.startsWith("<!", open)) {
            at = skipPast(text, ">", open + 2);
        } else if (text[open + 1] === "/") {
            const end = skipPast(text, ">", open + 2);
            const name = localName(text.slice(open + 2, end - 1).trim().split(/\s/)[0]);
            yield { kind: "end", name, start: open, end };
            at = end;
        } else if (isLetter(text.charCodeAt(open + 1))) {
            const tag = readStartTag(text, open);
            yield tag;
            at = tag.end;
            const rawEnd = isHtml && !tag.isSelfClosing ? RAW_TEXT_ENDS[tag.name] : undefined;
            if (rawEnd) {
                rawEnd.lastIndex = at;
                const close = rawEnd.exec(text)?.index ?? text.length;
                yield { kind: "text", raw: text.slice(at, close), isCdata: true };
                at = close;
            }
        } else {
            yield { kind: "text", raw: "<", isCdata: false };
            at = open + 1;
        }
    }
}

/** The descendants of `root` named `name`, or all of them, in document order. */
export function findElements(root: XmlElement, name?: string) {
    const found: XmlElement[] = [];
    const stack = [ ...root.children ].reverse();
    while (stack.length > 0) {
        const node = stack.pop();
        if (node && isElement(node)) {
            if (name === undefined || node.name === name) {
                found.push(node);
            }
            stack.push(...node.children.toReversed());
        }
    }
    return found;
}

export function findElement(root: XmlElement, name: string): XmlElement | undefined {
    return findElements(root, name)[0];
}

export function childElements(parent: XmlElement, name: string) {
    return parent.children.filter((child): child is XmlElement =>
        isElement(child) && child.name === name);
}

/** The text of `element` and its descendants. */
export function readText(element: XmlElement) {
    const parts: string[] = [];
    const stack: XmlNode[] = [ element ];
    for (let node = stack.pop(); node; node = stack.pop()) {
        if (isElement(node)) {
            stack.push(...node.children.toReversed());
        } else {
            parts.push(node.text);
        }
    }
    return parts.join("");
}

export function isElement(node: XmlNode): node is XmlElement {
    return "name" in node;
}

/** The start tag at `open`, with its attributes, read up to its `>` outside quotes. */
function readStartTag(text: string, open: number): Extract<XmlToken, { kind: "start" }> {
    let at = open + 1;
    while (at < text.length && !isNameEnd(text.charCodeAt(at))) {
        at++;
    }
    const name = localName(text.slice(open + 1, at));
    const attributes = new Map<string, string>();
    const skipSpace = () => {
        while (at < text.length && isSpace(text.charCodeAt(at))) {
            at++;
        }
    };
    while (at < text.length) {
        skipSpace();
        const code = text.charCodeAt(at);
        if (code === GREATER_THAN) {
            return {
                kind: "start", name, start: open, end: at + 1, isSelfClosing: false, attributes
            };
        }
        if (code === SLASH) {
            if (text.charCodeAt(at + 1) === GREATER_THAN) {
                return {
                    kind: "start", name, start: open, end: at + 2, isSelfClosing: true, attributes
                };
            }
            at++;
            continue;
        }

        const nameStart = at;
        while (at < text.length && !isNameEnd(text.charCodeAt(at))
            && text.charCodeAt(at) !== EQUALS) {
            at++;
        }
        const attributeName = text.slice(nameStart, at).toLowerCase();
        skipSpace();
        let value = "";
        if (text.charCodeAt(at) === EQUALS) {
            at++;
            skipSpace();
            const quote = text[at];
            if (quote === "\"" || quote === "'") {
                const close = text.indexOf(quote, at + 1);
                const valueEnd = close < 0 ? text.length : close;
                value = text.slice(at + 1, valueEnd);
                at = valueEnd + 1;
            } else {
                const valueStart = at;
                while (at < text.length && !isSpace(text.charCodeAt(at))
                    && text.charCodeAt(at) !== GREATER_THAN) {
                    at++;
                }
                value = text.slice(valueStart, at);
            }
        }
        if (attributeName && !attributes.has(attributeName)) {
            attributes.set(attributeName, decodeHtmlEntities(value));
        }
    }
    return { kind: "start", name, start: open, end: text.length, isSelfClosing: false, attributes };
}

const SLASH = 0x2f;
const EQUALS = 0x3d;
const GREATER_THAN = 0x3e;

/** Whether `code` is XML white space. */
function isSpace(code: number) {
    return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0c;
}

/** Whether `code` ends a tag or attribute name. */
function isNameEnd(code: number) {
    return isSpace(code) || code === SLASH || code === GREATER_THAN;
}

/** The offset after the first `terminator` at or after `from`, or the end of `text`. */
function skipPast(text: string, terminator: string, from: number) {
    const index = text.indexOf(terminator, from);
    return index < 0 ? text.length : index + terminator.length;
}

/** Whether `code` is an ASCII letter, which starts a tag name. */
function isLetter(code: number) {
    return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

/** `name` without its namespace prefix, in lower case. */
function localName(name: string) {
    return name.slice(name.indexOf(":") + 1).toLowerCase();
}
