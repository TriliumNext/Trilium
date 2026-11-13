import type { Editor, ModelPosition, ModelRange } from "ckeditor5";

import { type LineIndex, type LinePosition, toCharacterEdge } from "./vim_lines.js";

/** The most matches that show highlighted at once. */
const MAX_HIGHLIGHTS = 1000;

/** The group of the markers that highlight the matches of a search. */
export const SEARCH_MARKER = "vimSearch";

/** A match in the lines of a `LineIndex`. */
interface LineMatch {
    line: number;
    start: number;
    end: number;
    match: RegExpExecArray;
}

/** What a search cursor reads and changes the note through. */
export interface SearchCursorHost {
    /** The lines of the whole note, the hidden ones included. */
    getFullIndex(): LineIndex;
    /**
     * The place of `position` among the lines that show. Shows `position` first when it is hidden.
     */
    toShownPosition(position: ModelPosition): LinePosition;
    /** Replaces the text from `start` to `end` with `text`, and returns where the new text ends. */
    replace(
        start: ModelPosition, end: ModelPosition, text: string, oldText: string
    ): ModelPosition | null;
}

/**
 * Finds the matches of `query` one after another from `start`, as CodeMirror's search cursor does.
 * A match never spans two lines. The whole note is searched, the hidden content included.
 */
export class SearchCursor {

    private last: LineMatch | null = null;
    private isAfterEmptyMatch = false;
    private readonly regExp: RegExp;

    constructor(
        private readonly host: SearchCursorHost,
        query: RegExp,
        private readonly start: ModelPosition
    ) {
        this.regExp = toGlobal(query);
    }

    get match(): string[] | undefined {
        return this.last?.match;
    }

    findNext() {
        return this.find(false);
    }

    findPrevious() {
        return this.find(true);
    }

    find(isBackward?: boolean): string[] | null {
        const index = this.host.getFullIndex();
        const last = this.last;
        let found: LineMatch | null;
        if (isBackward) {
            const from = last ? { line: last.line, ch: last.start } : index.locate(this.start);
            const limit = last && this.isAfterEmptyMatch ? from.ch - 1 : from.ch;
            found = findBackward(index, this.regExp, from.line, limit);
        } else {
            const from = last ? { line: last.line, ch: last.end } : index.locate(this.start);
            const startCh = last && this.isAfterEmptyMatch ? from.ch + 1 : from.ch;
            found = findForward(index, this.regExp, from.line, startCh);
        }
        this.last = found;
        this.isAfterEmptyMatch = !!found && found.start === found.end;
        return found?.match ?? null;
    }

    from(): LinePosition | undefined {
        return this.last ? this.toShown(this.last.line, this.last.start) : undefined;
    }

    to(): LinePosition | undefined {
        return this.last ? this.toShown(this.last.line, this.last.end) : undefined;
    }

    replace(text: string) {
        const last = this.last;
        if (!last) {
            return;
        }
        const index = this.host.getFullIndex();
        const lineText = index.getText(last.line);
        // A match that ends inside a character, as before a combining accent, takes all of it.
        const from = toCharacterEdge(lineText, last.start, false);
        const to = toCharacterEdge(lineText, last.end, true);
        const newText = lineText.slice(from, last.start) + text + lineText.slice(last.end, to);
        const newEnd = this.host.replace(index.positionAt(last.line, from),
            index.positionAt(last.line, to), newText, lineText.slice(from, to));
        if (!newEnd) {
            return;
        }
        const located = this.host.getFullIndex().locate(newEnd);
        const startCh = located.line === last.line ? Math.min(last.start, located.ch) : 0;
        this.last = { ...last, line: located.line, start: startCh, end: located.ch };
    }

    private toShown(line: number, ch: number): LinePosition {
        return this.host.toShownPosition(this.host.getFullIndex().positionAt(line, ch));
    }
}

/** The first match at or after column `startCh` of line `fromLine`. */
function findForward(
    index: LineIndex, regExp: RegExp, fromLine: number, startCh: number
): LineMatch | null {
    for (let line = fromLine; line <= index.lastLine; line++) {
        const text = index.getText(line);
        const ch = line === fromLine ? startCh : 0;
        if (ch > text.length) {
            continue;
        }
        regExp.lastIndex = ch;
        const match = regExp.exec(text);
        if (match) {
            return { line, start: match.index, end: match.index + match[0].length, match };
        }
    }
    return null;
}

/** The last match that ends at or before column `limit` of line `fromLine`. */
function findBackward(
    index: LineIndex, regExp: RegExp, fromLine: number, limit: number
): LineMatch | null {
    for (let line = fromLine; line >= 0; line--) {
        const lineLimit = line === fromLine ? limit : Infinity;
        let found: LineMatch | null = null;
        for (const match of getLineMatches(regExp, index.getText(line))) {
            const end = match.index + match[0].length;
            if (end > lineLimit) {
                break;
            }
            found = { line, start: match.index, end, match };
        }
        if (found) {
            return found;
        }
    }
    return null;
}

/** The matches of `regExp`, which has the `g` flag, in `text`. */
function* getLineMatches(regExp: RegExp, text: string): Generator<RegExpExecArray> {
    regExp.lastIndex = 0;
    while (regExp.lastIndex <= text.length) {
        const match = regExp.exec(text);
        if (!match) {
            return;
        }
        yield match;
        if (match[0].length === 0) {
            regExp.lastIndex = match.index + 1;
        }
    }
}

/** `query` with the `g` flag, which `lastIndex` needs, and without the `y` flag. */
function toGlobal(query: RegExp): RegExp {
    return new RegExp(query.source, `${query.flags.replace(/[gy]/g, "")}g`);
}

/**
 * The highlights of the matches of a search, as markers that look like the results of Search in
 * note. They follow the changes of the note until they are hidden.
 */
export class SearchHighlights {

    private query: RegExp | null = null;
    private count = 0;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly editor: Editor, private readonly getFullIndex: () => LineIndex) {}

    get isShown() {
        return !!this.query;
    }

    show(query: RegExp) {
        this.query = query;
        this.cancelUpdate();
        this.update();
    }

    hide() {
        this.query = null;
        this.cancelUpdate();
        this.write([]);
    }

    /** Updates the highlights after a change of the note, once the changes pause. */
    scheduleUpdate() {
        if (!this.query || this.timer) {
            return;
        }
        this.timer = setTimeout(() => {
            this.timer = null;
            this.update();
        }, 100);
    }

    private cancelUpdate() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private update() {
        const index = this.getFullIndex();
        const regExp = toGlobal(this.query as RegExp);
        const ranges: ModelRange[] = [];
        for (let line = 0; line <= index.lastLine && ranges.length < MAX_HIGHLIGHTS; line++) {
            for (const match of getLineMatches(regExp, index.getText(line))) {
                if (match[0].length) {
                    ranges.push(this.editor.model.createRange(index.positionAt(line, match.index),
                        index.positionAt(line, match.index + match[0].length)));
                }
                if (ranges.length >= MAX_HIGHLIGHTS) {
                    break;
                }
            }
        }
        this.write(ranges);
    }

    private write(ranges: ModelRange[]) {
        const model = this.editor.model;
        if (!ranges.length && !this.count) {
            return;
        }
        model.change((writer) => {
            for (const [ number, range ] of ranges.entries()) {
                const name = `${SEARCH_MARKER}:${number}`;
                if (model.markers.has(name)) {
                    writer.updateMarker(name, { range });
                } else {
                    writer.addMarker(name, { range, usingOperation: false, affectsData: false });
                }
            }
            for (let number = ranges.length; number < this.count; number++) {
                writer.removeMarker(`${SEARCH_MARKER}:${number}`);
            }
        });
        this.count = ranges.length;
    }
}
