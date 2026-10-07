import { describe, expect, it } from "vitest";

import {
    BLOCK_ID_ATTRIBUTE,
    type BlockNode,
    encodeBlockParameter,
    formatBlockRange,
    isValidBlockId,
    parseBlockRange,
    resolveBlockRange,
    resolveBlockReference,
    sliceToBlockReference
} from "./block_reference.js";

describe("parseBlockRange", () => {
    it("parses a single block and a range", () => {
        expect(parseBlockRange("a1")).toEqual({ startId: "a1", endId: "a1" });
        expect(parseBlockRange("a1:b2")).toEqual({ startId: "a1", endId: "b2" });
        expect(parseBlockRange("intro section")).toEqual({
            startId: "intro section",
            endId: "intro section"
        });
    });

    it("rejects empty and malformed values", () => {
        for (const value of [ undefined, null, "", ":", "a1:", ":b2", "a1:b2:c3" ]) {
            expect(parseBlockRange(value)).toBeNull();
        }
    });
});

describe("formatBlockRange", () => {
    it("writes a single block as its id and a range with a colon", () => {
        expect(formatBlockRange({ startId: "a1", endId: "a1" })).toBe("a1");
        expect(formatBlockRange({ startId: "a1", endId: "b2" })).toBe("a1:b2");
    });
});

describe("encodeBlockParameter", () => {
    it("encodes each id and keeps the colon between them", () => {
        expect(encodeBlockParameter("a1:b2")).toBe("a1:b2");
        expect(encodeBlockParameter("intro & more:b/2")).toBe("intro%20%26%20more:b%2F2");
    });
});

describe("isValidBlockId", () => {
    it("accepts any non-empty text without a colon", () => {
        expect(isValidBlockId("aB3dE6gH9jK2")).toBe(true);
        expect(isValidBlockId("intro & more?")).toBe(true);
        expect(isValidBlockId("a:b")).toBe(false);
        expect(isValidBlockId("")).toBe(false);
        expect(isValidBlockId(null)).toBe(false);
        expect(isValidBlockId(undefined)).toBe(false);
    });
});

describe("resolveBlockRange", () => {
    it("finds nested blocks and skips text nodes", () => {
        const start = block("p", "a");
        const end = block("p", "b");
        const root = el("div", {},
            text("x"),
            el("blockquote", {}, start),
            el("ul", {}, el("li", {}, end))
        );

        expect(resolveBlockRange(root, { startId: "a", endId: "b" })).toEqual({ start, end });
    });

    it("returns the blocks in document order", () => {
        const first = block("p", "a");
        const second = block("p", "b");
        const root = el("div", {}, first, second);

        expect(resolveBlockRange(root, { startId: "b", endId: "a" })).toEqual({
            start: first,
            end: second
        });
    });

    it("finds a single block once, and the first of duplicate ids", () => {
        const first = block("p", "a");
        const root = el("div", {}, first, block("p", "a"));

        expect(resolveBlockRange(root, { startId: "a", endId: "a" })).toEqual({
            start: first,
            end: first
        });
    });

    it("leaves a missing block null", () => {
        const found = block("p", "a");
        const root = el("div", {}, found);

        const resolve = (startId: string, endId: string) =>
            resolveBlockRange(root, { startId, endId });

        expect(resolve("a", "x")).toEqual({ start: found, end: null });
        expect(resolve("x", "a")).toEqual({ start: null, end: found });
        expect(resolve("x", "y")).toEqual({ start: null, end: null });
    });
});

describe("resolveBlockReference", () => {
    it("parses the link parameter and finds its blocks", () => {
        const start = block("p", "a");
        const end = block("p", "b");
        const root = el("div", {}, start, end);

        expect(resolveBlockReference(root, "a:b")).toEqual({ start, end });
        expect(resolveBlockReference(root, "a:b:c")).toEqual({ start: null, end: null });
    });
});

describe("sliceToBlockReference", () => {
    it("keeps a single block and its ancestors", () => {
        const target = block("p", "b", text("B"));
        const root = el("div", {},
            block("p", "a"),
            el("blockquote", {}, el("p", {}, text("A")), target, el("p", {}, text("C"))),
            block("p", "c")
        );

        expect(sliceToBlockReference(root, "b")).toBe(true);
        expect(render(root)).toBe(`<div><blockquote>${render(target)}</blockquote></div>`);
    });

    it("keeps a range across nesting levels", () => {
        const start = block("p", "a", text("A"));
        const end = el("li", {}, block("p", "c", text("C")));
        const root = el("div", {},
            el("p", {}, text("before")),
            el("blockquote", {}, el("p", {}, text("skip")), start),
            el("p", {}, text("middle")),
            el("ul", {}, end, el("li", {}, text("after")))
        );

        expect(sliceToBlockReference(root, "c:a")).toBe(true);
        expect(render(root)).toBe(
            `<div><blockquote>${render(start)}</blockquote><p>middle</p>`
            + `<ul>${render(end)}</ul></div>`
        );
    });

    it("changes nothing when a block is missing", () => {
        const root = el("div", {}, block("p", "a"), el("p", {}));

        expect(sliceToBlockReference(root, "a:x")).toBe(false);
        expect(sliceToBlockReference(root, "a:b:c")).toBe(false);
        expect(root.childNodes).toHaveLength(2);
    });

    it("keeps the numbers of the remaining items of an ordered list", () => {
        const list = el("ol", {}, el("li", {}, text("1")), text(" "), el("li", {}, text("2")),
            el("li", {}, block("p", "x")));
        const numberedList = el("ol", { start: "4" }, el("li", {}, text("4")), block("li", "x"));
        const bulletList = el("ul", {}, el("li", {}, text("a")), block("li", "x"));

        for (const container of [ list, numberedList, bulletList ]) {
            sliceToBlockReference(el("div", {}, container), "x");
        }

        expect(list.getAttribute("start")).toBe("3");
        expect(numberedList.getAttribute("start")).toBe("5");
        expect(bulletList.getAttribute("start")).toBeNull();
    });
});

class TestElement implements BlockNode {
    parentNode: BlockNode | null = null;
    childNodes: BlockNode[] = [];

    constructor(
        readonly tagName: string,
        private readonly attributes: Record<string, string>,
        children: BlockNode[]
    ) {
        for (const child of children) {
            child.parentNode = this;
            this.childNodes.push(child);
        }
    }

    getAttribute(name: string) {
        return this.attributes[name] ?? null;
    }

    setAttribute(name: string, value: string) {
        this.attributes[name] = value;
    }

    remove() {
        removeFromParent(this);
    }

    render(): string {
        const attributes = Object.entries(this.attributes)
            .map(([ name, value ]) => ` ${name}="${value}"`);
        const tag = this.tagName.toLowerCase();
        return `<${tag}${attributes.join("")}>${this.childNodes.map(render).join("")}</${tag}>`;
    }
}

class TestText implements BlockNode {
    parentNode: BlockNode | null = null;
    childNodes: BlockNode[] = [];

    constructor(readonly text: string) {}

    remove() {
        removeFromParent(this);
    }
}

function removeFromParent(node: BlockNode) {
    const siblings = node.parentNode?.childNodes;
    if (Array.isArray(siblings)) {
        siblings.splice(siblings.indexOf(node), 1);
    }
    node.parentNode = null;
}

function el(tagName: string, attributes: Record<string, string>, ...children: BlockNode[]) {
    return new TestElement(tagName.toUpperCase(), attributes, children);
}

function block(tagName: string, id: string, ...children: BlockNode[]) {
    return el(tagName, { [BLOCK_ID_ATTRIBUTE]: id }, ...children);
}

function text(value: string) {
    return new TestText(value);
}

function render(node: BlockNode): string {
    return node instanceof TestElement ? node.render() : (node as TestText).text;
}
