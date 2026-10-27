import {
    ensureSyntaxTree, LanguageSupport, StreamLanguage, type StreamParser, syntaxHighlighting
} from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";
import { SupportedMimeTypes } from "@triliumnext/commons";
import { describe, expect, it, vi } from "vitest";

import byMimeType, { MIME_ALIASES } from "./syntax_highlighting.js";

const entries = Object.entries(byMimeType) as [SupportedMimeTypes, (typeof byMimeType)[SupportedMimeTypes]][];
const loadable = entries.filter((entry): entry is [SupportedMimeTypes, NonNullable<typeof entry[1]>] => entry[1] !== null);
const MARKDOWN_MIMES = [ "text/x-markdown", "text/x-gfm" ] as const;

describe("byMimeType", () => {
    it("covers every supported MIME type exactly once", () => {
        // The map is typed as Record<SupportedMimeTypes, …>, so a missing key is a compile error —
        // but an accidental duplicate literal silently keeps only the last one, and a MIME added to
        // commons without an entry here would fall through to no highlighting at all.
        expect(entries.length).toBe(Object.keys(byMimeType).length);
        expect(new Set(entries.map(([mime]) => mime)).size).toBe(entries.length);
        expect(loadable.length).toBeGreaterThan(0);
    });

    // Each entry is a dynamic import of a third-party grammar, reaching for a specific named
    // export. A renamed or dropped export only surfaces when a user opens a note of that type,
    // so load every one of them here and assert it produced something CodeMirror can consume.
    it.each(loadable.map(([mime]) => mime))("loads a usable language for %s", async (mime) => {
        const loader = byMimeType[mime];
        expect(loader).toBeTruthy();
        if (!loader) return;

        const syntax = await loader();
        expect(syntax).toBeTruthy();
        expect(() => stateFor(syntax)).not.toThrow();
    });

    it("maps aliased MIME types onto a language that exists in the map", () => {
        // SVG notes highlight as XML; an alias pointing at a missing or null entry would silently
        // drop highlighting for that note type.
        for (const [alias, target] of Object.entries(MIME_ALIASES)) {
            expect(Object.keys(byMimeType)).toContain(target);
            expect(byMimeType[target]).not.toBeNull();
            expect(alias in byMimeType).toBe(false);
        }
    });

    it("leaves plain text and template languages without a highlighter", () => {
        // These are deliberately null rather than absent — the editor treats null as "no syntax"
        // instead of falling into the "unknown MIME" path.
        expect(byMimeType["text/plain"]).toBeNull();
        expect(byMimeType["application/x-ejs"]).toBeNull();
    });

    it("highlights ASN.1 and MariaDB with their own grammars", async () => {
        const asn1 = await byMimeType["text/x-ttcn-asn"]?.();
        expect(asn1).toMatchObject({ name: "asn1" });

        const { mariaDB } = await import("@codemirror/legacy-modes/mode/sql");
        expect(await byMimeType["text/x-mariadb"]?.()).toBe(mariaDB);
    });

    it("highlights PEG.js with its grammar and Literate Haskell as Haskell", async () => {
        const { pegjs } = await import("@codemirror/legacy-modes/mode/pegjs");
        expect(await byMimeType["text/x-pegjs"]?.()).toBe(pegjs);

        const { haskell } = await import("@codemirror/legacy-modes/mode/haskell");
        expect(await byMimeType["text/x-literate-haskell"]?.()).toBe(haskell);
    });

    it("highlights the statements of slow queries in the Trilium log as SQLite", async () => {
        const syntax = await byMimeType["text/x-trilium-log"]?.();
        expect(Array.isArray(syntax)).toBe(true);
        if (!Array.isArray(syntax)) return;

        const doc = "00:10:01.540 Slow query took 78ms: SELECT 1";
        const state = EditorState.create({
            doc, extensions: [ syntax, syntaxHighlighting(classHighlighter) ]
        });
        const keywords: string[] = [];
        for (const set of state.facet(EditorView.decorations)) {
            if (typeof set === "function") continue;
            set.between(0, doc.length, (from, to, decoration) => {
                if (decoration.spec.class === "tok-keyword") keywords.push(doc.slice(from, to));
            });
        }
        expect(keywords).toEqual([ "SELECT" ]);
    });

    it.each(MARKDOWN_MIMES)("highlights mermaid code blocks in %s", async (mime) => {
        const syntax = await byMimeType[mime]?.();
        expect(syntax).toBeTruthy();
        if (!syntax) return;

        // The Mermaid grammar loads on first use, so a code block parses as plain text until then.
        const doc = "```mermaid\n---\nconfig:\n  gantt: {}\n---\nflowchart\n    A --> B\n```\n";
        await vi.waitFor(() => {
            const tree = ensureSyntaxTree(stateFor(syntax, doc), doc.length, 1000);
            const nodeAt = (text: string) => {
                const names: string[] = [];
                let node = tree?.resolveInner(doc.indexOf(text), 1) ?? null;
                while (node) {
                    names.push(node.name);
                    node = node.parent;
                }
                return names;
            };
            expect(nodeAt("A -->")).toContain("FlowchartDiagram");
            expect(nodeAt("gantt")).toContain("Key");
        });
    });
});

/**
 * Builds an editor state from whatever shape a loader returned — a legacy `StreamParser`, a
 * `LanguageSupport`, or a ready-made extension array — which is exactly what `setMimeType` does.
 */
function stateFor(
    syntax: StreamParser<unknown> | LanguageSupport | Extension[],
    doc = "a\nb\n"
): EditorState {
    const extension = syntax instanceof LanguageSupport || Array.isArray(syntax)
        ? syntax
        : StreamLanguage.define(syntax);
    return EditorState.create({ doc, extensions: [extension] });
}
