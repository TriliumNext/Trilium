import "./EditNoteContentDiff.css";

import { diffLines as jsDiffLines } from "diff";

import { t } from "../../../services/i18n.js";
import { MARKDOWN_NOTE_TYPE_MIME } from "../../../services/note_types.js";
import { useNote } from "../../react/hooks.js";
import { ReadOnlyTextContent } from "../text/ReadOnlyText.js";
import { renderMarkdown } from "./chat_markdown.js";

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

/** A run of consecutive diff lines of one kind, joined back into text. */
export interface DiffBlock {
    type: DiffLineType;
    text: string;
}

/** Diffs two texts into blocks, each a run of added, removed or unchanged lines. */
export function diffBlocks(oldText: string, newText: string): DiffBlock[] {
    const blocks: DiffBlock[] = [];
    for (const line of diffLines(oldText, newText)) {
        const last = blocks[blocks.length - 1];
        if (last?.type === line.type) {
            last.text += `\n${line.text}`;
        } else {
            blocks.push({ ...line });
        }
    }
    return blocks;
}

/**
 * Renders a single edit (one find/replace pair) as blocks: added text on a green edge, removed text on
 * a red edge and struck through. A Markdown note's blocks render as Markdown; other notes stay code.
 */
function DiffHunk({ edit, markdown }: { edit: NoteContentEdit; markdown: boolean }) {
    return (
        <div className="llm-diff-hunk">
            {diffBlocks(edit.oldText, edit.newText).map((block, idx) => (
                <div key={idx} className={`llm-diff-block llm-diff-block-${block.type}`}>
                    {markdown
                        ? <ReadOnlyTextContent html={renderMarkdown(block.text)} className="llm-chat-markdown" />
                        : <pre>{block.text || " "}</pre>}
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
export function EditNoteContentDiff({ noteId, edits }: { noteId?: string; edits: NoteContentEdit[] }) {
    const note = useNote(noteId);
    const markdown = note?.type === "code" && note.mime === MARKDOWN_NOTE_TYPE_MIME;
    return (
        <div className="llm-diff">
            {edits.map((edit, idx) => (
                <div key={idx} className="llm-diff-edit">
                    {edits.length > 1 && (
                        <div className="llm-diff-edit-header">
                            {t("llm_chat.edit_index", { index: idx + 1, total: edits.length })}
                        </div>
                    )}
                    <DiffHunk edit={edit} markdown={markdown} />
                </div>
            ))}
        </div>
    );
}
