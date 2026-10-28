import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const REPO = join(__dirname, "../../../..");
const CKEDITOR_CSS = join(REPO, "node_modules/ckeditor5/dist/ckeditor5.css");
const CKEDITOR_ROOT = /^(?::root|:host)$/;
const ROOT_ELEMENT = /^(?::where\(:root\)|:root|html|html:root)$/;
const OUTRANKS_CKEDITOR_ROOT = /^html:root$/;
const BODY_ELEMENT = /^body(?:[.#[:][^\s>+~]*)?$/;

/**
 * CKEditor 49 composes its component tokens on `:root` (`--ck-toolbar-border` from
 * `--ck-color-toolbar-border`), so each one inherits as a finished value. A global override only
 * reaches them when it is declared on the root element and outranks `ckeditor5.css`, which the
 * editor bundle loads after Trilium's stylesheets.
 */
describe("global CKEditor token overrides", () => {
    const rootTokens = new Map<string, string>();
    const read = new Set<string>();
    for (const block of parse(readFileSync(CKEDITOR_CSS, "utf8"), "ckeditor5.css")) {
        const onRoot = block.stack.length === 1 && matchesEvery(block.stack[0], CKEDITOR_ROOT);
        for (const [ name, { value } ] of block.decls) {
            if (onRoot) rootTokens.set(name, value);
            else for (const reference of references(value)) read.add(reference);
        }
    }
    const ours = ourStylesheets()
        .flatMap((file) => parse(readFileSync(file, "utf8"), relative(REPO, file)))
        .filter((block) => block.stack.length === 1);

    it("on body reach the tokens CKEditor composes from them", () => {
        const toolbar = staleTokens(rootTokens, new Set([ "--ck-color-base-border" ]));
        expect(toolbar.get("--ck-toolbar-border")).toBe("--ck-color-base-border");

        const problems: string[] = [];
        for (const block of ours.filter((b) => matchesEvery(b.stack[0], BODY_ELEMENT))) {
            const names = [ ...block.decls.keys() ];
            const overridden = new Set(names.filter((name) => name.startsWith("--ck-")));
            for (const [ token, ingredient ] of staleTokens(rootTokens, overridden)) {
                if (!read.has(token)) continue;
                const origin = block.decls.get(ingredient)?.origin;
                problems.push(`${token} ignores ${ingredient} (${origin})`);
            }
        }
        expect(problems).toEqual([]);
    });

    it("on the root element outrank the ones ckeditor5.css declares there", () => {
        const problems: string[] = [];
        for (const block of ours.filter((b) => matchesEvery(b.stack[0], ROOT_ELEMENT))) {
            if (matchesEvery(block.stack[0], OUTRANKS_CKEDITOR_ROOT)) continue;
            for (const [ name, { origin } ] of block.decls) {
                if (rootTokens.has(name)) problems.push(`${name} (${origin})`);
            }
        }
        expect(problems).toEqual([]);
    });
});

interface Block {
    stack: string[];
    decls: Map<string, { value: string; origin: string }>;
}

/** Splits a natively nested stylesheet into blocks, each with the chain of preludes above it. */
function parse(css: string, file: string): Block[] {
    const blocks: Block[] = [];
    const open: Block[] = [];
    let buffer = "";
    let line = 1;
    let start = 1;
    const source = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ""));
    for (const char of source) {
        if (char === "\n") line++;
        if (char === "{") {
            const prelude = buffer.replace(/\s+/g, " ").trim();
            const stack = [ ...(open.at(-1)?.stack ?? []), prelude ];
            const block: Block = { stack, decls: new Map() };
            blocks.push(block);
            open.push(block);
            buffer = "";
        } else if (char === ";" || char === "}") {
            const declaration = /^\s*([\w-]+)\s*:([\s\S]*)$/.exec(buffer);
            const parent = open.at(-1);
            if (declaration && parent) {
                const [ , name, value ] = declaration;
                parent.decls.set(name, { value: value.trim(), origin: `${file}:${start}` });
            }
            if (char === "}") open.pop();
            buffer = "";
        } else {
            if (!buffer.trim()) start = line;
            buffer += char;
        }
    }
    return blocks;
}

/** Maps each `:root` token left alone that reads an overridden name, even indirectly, to it. */
function staleTokens(rootTokens: Map<string, string>, overridden: Set<string>) {
    const stale = new Map<string, string>();
    let changed = true;
    while (changed) {
        changed = false;
        for (const [ token, value ] of rootTokens) {
            if (overridden.has(token) || stale.has(token)) continue;
            const isOverridden = (name: string) => overridden.has(name) || stale.has(name);
            const reference = references(value).find(isOverridden);
            if (!reference) continue;
            stale.set(token, stale.get(reference) ?? reference);
            changed = true;
        }
    }
    return stale;
}

function references(value: string) {
    return [ ...value.matchAll(/var\(\s*(--ck-[\w-]+)/g) ].map((match) => match[1]);
}

function matchesEvery(prelude: string, selector: RegExp) {
    return prelude.split(",").every((part) => selector.test(part.trim()));
}

function ourStylesheets() {
    const patterns = [ "apps/client/src/**.css", "packages/ckeditor5/src/**.css" ];
    const files = execFileSync("git", [ "ls-files", ...patterns ], { cwd: REPO, encoding: "utf8" });
    return files.trim().split("\n").map((file) => join(REPO, file));
}
