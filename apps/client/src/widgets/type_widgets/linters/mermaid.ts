import { type Diagnostic, linter, lintGutter } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";

interface MermaidParseError extends Error {
    hash: {
        text: string;
        token: string | null;
        /** 0-based line number reported for lexical errors. */
        line: number;
        /** Present for parser (grammar) errors; absent for lexical errors. */
        loc?: {
            first_line: number;
            first_column: number;
            last_line: number;
            last_column: number;
        };
        expected?: string[];
    };
}

/** A Mermaid parse error expressed in editor line/column coordinates. */
export interface MermaidLineDiagnostic {
    message: string;
    /** 1-based line number, matching CodeMirror's `doc.line()`. */
    fromLine: number;
    fromColumn: number;
    toLine: number;
    toColumn: number;
}

/**
 * Builds a CodeMirror 6 lint extension that surfaces Mermaid parse errors inline
 * as the user edits the diagram source. The extension re-runs (debounced) on
 * every document change, so no manual re-triggering is required. `lintGutter()`
 * adds the error markers in the gutter alongside the inline underline.
 */
export default function mermaidLinter() {
    return [ linter(validateMermaid), lintGutter() ];
}

/**
 * Lint source for {@link mermaidLinter}: parses the editor content and maps any
 * Mermaid error onto CodeMirror's absolute-offset {@link Diagnostic} positions.
 */
export async function validateMermaid(view: EditorView): Promise<Diagnostic[]> {
    const { doc } = view.state;
    const diagnostics = await getMermaidDiagnostics(doc.toString());

    return diagnostics.map(({ message, fromLine, fromColumn, toLine, toColumn }) => {
        // Clamp to the document/line bounds: an out-of-range position reported by a future
        // Mermaid version would otherwise throw from doc.line() and (since this is an async
        // lint source) silently drop every diagnostic.
        const fromLineObj = doc.line(clampLine(fromLine, doc.lines));
        const toLineObj = doc.line(clampLine(toLine, doc.lines));
        const from = Math.min(fromLineObj.from + fromColumn, fromLineObj.to);
        const to = Math.min(toLineObj.from + toColumn, toLineObj.to);

        return {
            severity: "error",
            message,
            from: Math.min(from, to),
            to: Math.max(from, to)
        };
    });
}

function clampLine(line: number, lineCount: number) {
    return Math.max(1, Math.min(line, lineCount));
}

/**
 * Parses Mermaid diagram source and returns any parse error as a line/column
 * diagnostic. Extracted from {@link validateMermaid} so the message and position
 * handling can be unit-tested without a live editor.
 *
 * Mermaid throws two differently-shaped errors: grammar (parser) errors carry a
 * `hash.loc` with precise positions, while lexical errors only report a 0-based
 * `hash.line` — for those we highlight the whole offending line.
 */
export async function getMermaidDiagnostics(text: string): Promise<MermaidLineDiagnostic[]> {
    if (!text.trim()) {
        return [];
    }

    const mermaid = (await import("mermaid")).default;

    try {
        await mermaid.parse(text);
    } catch (e: unknown) {
        if (typeof e !== "object" || e === null) {
            // mermaid.parse is expected to throw a structured error object; bail out
            // gracefully if it ever rejects with a primitive or null.
            return [];
        }
        const hash = (e as MermaidParseError).hash;
        if (!hash) {
            // Some diagram types (e.g. the newer Langium-based parsers) throw errors
            // without jison-style position info; we can't place a marker for those.
            return [];
        }

        const message = (e as MermaidParseError).message;

        if (hash.loc) {
            return [ buildParseDiagnostic(message, hash.loc) ];
        }

        if (typeof hash.line === "number") {
            return [ buildLexicalDiagnostic(message, hash.line, text) ];
        }

        return [];
    }

    return [];
}

/** Builds a precise diagnostic from a grammar (parser) error's `loc`. */
function buildParseDiagnostic(message: string, loc: NonNullable<MermaidParseError["hash"]["loc"]>): MermaidLineDiagnostic {
    let fromColumn = loc.first_column + 1;
    const toColumn = loc.last_column + 1;

    // A zero-width error at the very start of a line points before the first
    // character; anchor it to the line start so the marker stays visible.
    if (fromColumn === 1 && toColumn === 1) {
        fromColumn = 0;
    }

    // Mermaid prepends a few lines of boilerplate ("Parse error on line N:" plus
    // a caret diagram) before the useful "Expecting …" message.
    let messageLines = message.split("\n");
    if (messageLines.length >= 4) {
        messageLines = messageLines.slice(3);
    }

    return {
        message: messageLines.join("\n"),
        fromLine: loc.first_line,
        fromColumn,
        toLine: loc.last_line,
        toColumn
    };
}

/**
 * Builds a diagnostic for a lexical error, which carries no column info — only a
 * 0-based line. The whole offending line is highlighted, and only the first
 * message line is kept (the rest is a caret diagram that can't be re-aligned).
 */
function buildLexicalDiagnostic(message: string, zeroBasedLine: number, text: string): MermaidLineDiagnostic {
    const line = zeroBasedLine + 1;
    const lineContent = text.split("\n")[line - 1] ?? "";

    return {
        message: message.split("\n")[0],
        fromLine: line,
        fromColumn: 0,
        toLine: line,
        toColumn: lineContent.length
    };
}
