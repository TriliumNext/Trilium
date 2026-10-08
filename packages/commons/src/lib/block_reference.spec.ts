import { describe, expect, it } from "vitest";

import {
    BLOCK_ID_ATTRIBUTE,
    type BlockNode,
    encodeBlockParameter,
    formatBlockRange,
    getEditableBlockRun,
    getListItemNumber,
    isValidBlockId,
    MULTICOLUMN_LAYOUT_CLASS,
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

    it("drops a layout left with one column around the blocks, and keeps one with more", () => {
        const layout = (...columns: BlockNode[]) =>
            el("section", { class: `${MULTICOLUMN_LAYOUT_CLASS} wide` }, ...columns);
        const target = block("p", "b", text("B"));
        const inner = layout(
            el("section", {}, el("p", {}, text("A")), target),
            el("section", {}, el("p", {}, text("C")))
        );
        const root = el("div", {}, layout(el("section", {}, inner), el("section", {})));

        expect(sliceToBlockReference(root, "b")).toBe(true);
        expect(render(root)).toBe(`<div>${render(target)}</div>`);

        const across = layout(
            el("section", {}, block("p", "x")),
            el("section", {}, block("p", "y"))
        );
        const otherRoot = el("div", {}, across);
        sliceToBlockReference(otherRoot, "x:y");
        expect(otherRoot.childNodes).toEqual([ across ]);
        expect(across.childNodes).toHaveLength(2);
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
        const reversedList = el("ol", { reversed: "" }, block("li", "x", text("3")),
            el("li", {}, text("2")), el("li", {}, text("1")));
        const numberedReversedList = el("ol", { reversed: "", start: "10" },
            el("li", {}, text("10")), block("li", "x"), el("li", {}, text("8")));
        const bulletList = el("ul", {}, el("li", {}, text("a")), block("li", "x"));

        for (const container of [
            list, numberedList, reversedList, numberedReversedList, bulletList
        ]) {
            sliceToBlockReference(el("div", {}, container), "x");
        }

        expect(list.getAttribute("start")).toBe("3");
        expect(numberedList.getAttribute("start")).toBe("5");
        expect(reversedList.getAttribute("start")).toBe("3");
        expect(numberedReversedList.getAttribute("start")).toBe("9");
        expect(bulletList.getAttribute("start")).toBeNull();
    });
});

describe("getListItemNumber", () => {
    it("counts up from the start of a list, and down in a reversed list", () => {
        const items = () => [ el("li", {}), text(" "), el("li", {}) ];

        expect(getListItemNumber(el("ol", {}, ...items()), 1)).toBe(2);
        expect(getListItemNumber(el("ol", { start: "5" }, ...items()), -2)).toBe(3);
        expect(getListItemNumber(el("ol", { reversed: "" }, ...items()), 0)).toBe(2);
        expect(getListItemNumber(el("ol", { reversed: "", start: "5" }, ...items()), -1)).toBe(6);
    });
});

describe("getEditableBlockRun", () => {
    it("finds a single block, and the blocks of a range with their nested ancestors", () => {
        const single = block("p", "a");
        const quote = el("blockquote", {}, el("p", {}), single, el("p", {}));
        const start = el("blockquote", {}, text(" "), block("p", "b"));
        const end = el("ul", {}, el("li", {}, block("p", "c")), text("\n"));
        const root = el("div", {}, quote, start, el("p", {}), end, el("p", {}));

        expect(getEditableBlockRun(root, "a")).toEqual({
            parent: quote, first: single, last: single
        });
        expect(getEditableBlockRun(root, "c:b")).toEqual({
            parent: root, first: start, last: end
        });
    });

    it("finds the items of a list, and a block that holds the end of the range", () => {
        const firstItem = el("li", {}, block("p", "a"));
        const lastItem = el("li", {}, block("p", "b"));
        const list = el("ol", {}, el("li", {}), firstItem, el("li", {}), lastItem);
        const quote = block("blockquote", "c", el("p", {}), block("p", "d"));
        const root = el("div", {}, list, quote);

        expect(getEditableBlockRun(root, "a:b")).toEqual({
            parent: list, first: firstItem, last: lastItem
        });
        expect(getEditableBlockRun(root, "a")).toEqual({
            parent: list, first: firstItem, last: firstItem
        });
        expect(getEditableBlockRun(root, "c:d")).toEqual({
            parent: root, first: quote, last: quote
        });
    });

    it("finds to-do items past their checkbox, and a block beside a nested list", () => {
        const todo = (id: string) => el("li", {}, el("label", {}, el("input", {})), block("p", id));
        const firstTask = todo("t1");
        const lastTask = todo("t2");
        const todoList = el("ul", { class: "todo-list" }, firstTask, lastTask);
        const paragraph = block("p", "p");
        const item = el("li", {}, paragraph, el("ul", {}, el("li", {})));
        const root = el("div", {}, todoList, el("ul", {}, item));

        expect(getEditableBlockRun(root, "t1:t2")).toEqual({
            parent: todoList, first: firstTask, last: lastTask
        });
        expect(getEditableBlockRun(root, "p")).toEqual({
            parent: item, first: paragraph, last: paragraph
        });
    });

    it("finds the blocks of a column of a multicolumn layout", () => {
        const first = block("p", "a");
        const last = block("p", "b");
        const column = el("section", {}, el("p", {}), first, last);
        const root = el("div", {},
            el("section", { class: MULTICOLUMN_LAYOUT_CLASS }, column, el("section", {})));

        expect(getEditableBlockRun(root, "a:b")).toEqual({ parent: column, first, last });
    });

    it("finds nothing for a missing block, or an ancestor that holds other content", () => {
        const root = el("div", {},
            el("ul", {},
                el("li", {}, el("p", {}), block("p", "a")),
                el("li", {}, block("p", "s")),
                el("li", {}, block("p", "b"), el("ul", {}))
            ),
            el("p", {}, block("span", "c"), text("after")),
            el("table", {}, el("tr", {}, block("td", "d"), block("td", "e")))
        );

        for (const value of [ "a:x", "a:s", "s:b", "c", "d:e" ]) {
            expect(getEditableBlockRun(root, value), value).toBeNull();
        }
        expect(getEditableBlockRun(root, "s")).not.toBeNull();
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

    replaceWith(...nodes: BlockNode[]) {
        const siblings = this.parentNode?.childNodes;
        if (Array.isArray(siblings)) {
            siblings.splice(siblings.indexOf(this), 1, ...nodes);
        }
        for (const node of nodes) {
            node.parentNode = this.parentNode;
        }
        this.parentNode = null;
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

    get textContent() {
        return this.text;
    }

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
