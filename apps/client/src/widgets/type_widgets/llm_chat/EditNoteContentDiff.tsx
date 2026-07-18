import "./EditNoteContentDiff.css";

import { diffLines as jsDiffLines } from "diff";

import { t } from "../../../services/i18n.js";

/** A single find-and-replace edit performed by the `edit_note_content` tool. */
export interface NoteContentEdit {
    oldText: string;
    newText: string;
}

export type DiffLineType = "add" | "remove" | "context";

export interface DiffLine {
    type: DiffLineType;
    text: string;
}

/**
 * Compute a line-based diff between two text blocks via the `diff` (jsdiff)
 * library, flattening its grouped change list into one entry per line — each
 * tagged as added, removed or unchanged context — for row-by-row rendering.
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
    const result: DiffLine[] = [];
    // `ignoreNewlineAtEof` keeps a trailing-newline-only difference from
    // showing up as a spurious changed line.
    for (const part of jsDiffLines(oldText, newText, { ignoreNewlineAtEof: true })) {
        const type: DiffLineType = part.added ? "add" : part.removed ? "remove" : "context";
        const lines = part.value.split("\n");
        // jsdiff keeps each line's trailing newline, so a split yields an empty
        // tail element — drop it rather than rendering a blank line.
        if (lines.length > 1 && lines[lines.length - 1] === "") {
            lines.pop();
        }
        for (const line of lines) {
            result.push({ type, text: line });
        }
    }
    return result;
}

const GUTTER_MARKER: Record<DiffLineType, string> = {
    add: "+",
    remove: "-",
    context: " "
};

/** Renders a single edit (one find/replace pair) as a unified diff hunk. */
function DiffHunk({ edit }: { edit: NoteContentEdit }) {
    const lines = diffLines(edit.oldText, edit.newText);
    return (
        <div className="llm-diff-hunk">
            {lines.map((line, idx) => (
                <div key={idx} className={`llm-diff-line llm-diff-line-${line.type}`}>
                    <span className="llm-diff-gutter">{GUTTER_MARKER[line.type]}</span>
                    <span className="llm-diff-text">{line.text || " "}</span>
                </div>
            ))}
        </div>
    );
}

/** Maximum number of changed (added + removed) lines for an edit to count as "small". */
export const SMALL_EDIT_LINE_LIMIT = 10;

/**
 * Whether the combined diff of all edits is small enough that the section
 * should be expanded by default — i.e. the user can take it in at a glance.
 */
export function isSmallEdit(edits: NoteContentEdit[]): boolean {
    let changedLines = 0;
    for (const edit of edits) {
        for (const line of diffLines(edit.oldText, edit.newText)) {
            if (line.type !== "context") {
                changedLines++;
            }
        }
    }
    return changedLines <= SMALL_EDIT_LINE_LIMIT;
}

/** Validate that an unknown value is a usable list of note-content edits. */
export function parseNoteContentEdits(value: unknown): NoteContentEdit[] | null {
    if (!Array.isArray(value) || value.length === 0) return null;
    const edits: NoteContentEdit[] = [];
    for (const item of value) {
        if (typeof item !== "object" || item === null) return null;
        const { oldText, newText } = item as Record<string, unknown>;
        if (typeof oldText !== "string" || typeof newText !== "string") return null;
        edits.push({ oldText, newText });
    }
    return edits;
}

/** A fancy unified diff for the `edit_note_content` tool's list of edits. */
export function EditNoteContentDiff({ edits }: { edits: NoteContentEdit[] }) {
    return (
        <div className="llm-diff">
            {edits.map((edit, idx) => (
                <div key={idx} className="llm-diff-edit">
                    {edits.length > 1 && (
                        <div className="llm-diff-edit-header">
                            {t("llm_chat.edit_index", { index: idx + 1, total: edits.length })}
                        </div>
                    )}
                    <DiffHunk edit={edit} />
                </div>
            ))}
        </div>
    );
}
