import type {
    CM5EditorInterface, LineHandle, Marker, Pos, StringStream as EngineStringStream, vimState
} from "@replit/codemirror-vim-core";
import {
    type Batch, type DifferItem, type Editor, EmitterMixin, env, type ModelDocumentChangeEvent,
    type ModelElement, ModelLivePosition, type ModelPosition, type ModelRange, type ModelTextProxy,
    TableUtils, TableWalker, type ViewElement
} from "ckeditor5";

import { OPEN_ATTRIBUTE } from "../collapsible/constants.js";
import CollapsibleListItems from "../collapsible_list_items.js";
import FindReveal from "../find_reveal.js";
import HiddenBlocks from "../hidden_blocks.js";
import {
    getWholeLines, indentLines, isAtTwoStepBoundary, removeLines, replaceText, rewriteLines
} from "./vim_editing.js";
import {
    EVERYTHING_SHOWN, LineIndex, type LinePosition, type LineVisibility, toCharacterEdge
} from "./vim_lines.js";
import { readRichContent, type RichContent } from "./vim_registers.js";
import { SearchCursor, SearchHighlights } from "./vim_search.js";
import StringStream from "./vim_string_stream.js";

type Handler = (...args: never[]) => unknown;
type EngineCommand = (cm: VimAdapter) => void;

/** What the engine passes to `openDialog()`, as CodeMirror's dialog addon takes it. */
export interface DialogOptions {
    onKeyDown?(event: KeyboardEvent, value: string, close: CloseDialog): unknown;
    onKeyUp?(event: KeyboardEvent, value: string, close: CloseDialog): unknown;
    onInput?(event: Event, value: string, close: CloseDialog): unknown;
    onClose?(dialog: HTMLElement): void;
    value?: string;
    selectValueOnOpen?: boolean;
    closeOnEnter?: boolean;
    closeOnBlur?: boolean;
}

/** Text that the engine read, from where to where, and the version of the note it read. */
interface ReadText {
    from: LinePosition;
    to: LinePosition;
    text: string;
    version: number;
}

/** Closes a dialog, or with a string, sets the value of its input. */
export type CloseDialog = (value?: string) => void;

/** The services of the plugin that the adapter and the Trilium commands use. */
export interface VimAdapterHost {
    /** Shows a prompt for `template`, which the engine builds, such as the `:` command line. */
    openDialog(template: Element, onEnter: ((value: string) => void) | undefined,
        options: DialogOptions): CloseDialog;
    /** Shows a message for `duration` milliseconds, or until the next key with 0. */
    openNotification(template: Node, duration: number): () => void;
    /** Shows `message` in the status line. */
    notify(message: string): void;
    /** Undoes or redoes one step of Vim. */
    undo(): void;
    redo(): void;
    /** Runs at the end of each operation, once the engine knows of its changes. */
    onOperationEnd(): void;
    /** Saves the note now, for `:w`. */
    save(): void;
    /** Closes the tab of the note, for `:q`. */
    closeTab(): void;
    /** Follows the link at the cursor, for `gf`. */
    followLink(): void;
    /** The text of the system clipboard, for `"+p`, or `null` when it cannot be read. */
    readClipboard(): Promise<string | null>;
    /** Puts `text` on the system clipboard, with `html` as its formatted form, for `"+y`. */
    writeClipboard(text: string, html: string | null): void;
    /**
     * Enters the editable part of `widget`, at its start or, with `isAtEnd`, at its end: the
     * editor of an embed, which then takes the keys, or the caption, whose position comes back.
     */
    enterWidget(widget: ModelElement, isAtEnd: boolean): WidgetEntry | null;
}

/**
 * Where `i` and `a` went on a widget: into the editor of an embed, or to a place in its caption.
 */
export type WidgetEntry = { kind: "embed" } | { kind: "caption"; position: ModelPosition };

/** A position in the lines, as the engine counts them. */
export class VimPosition implements Pos {
    constructor(public line: number, public ch: number) {}
}

/** The adapter whose operation runs, for the register commands that the engine runs in it. */
let activeAdapter: VimAdapter | null = null;

export function getActiveAdapter(): VimAdapter | null {
    return activeAdapter;
}

/**
 * The editor that the Vim engine drives, after the interface of CodeMirror 5, over the model of a
 * CKEditor. The note is a list of lines (see `LineIndex`): a line and a column are positions in
 * that list, and every edit is a change of the model.
 */
export default class VimAdapter {

    // The static members are the `CodeMirror` object that `initVim()` takes.
    static isMac = env.isMac;
    static Pos = VimPosition;
    static StringStream = StringStream as unknown as new (text: string) => EngineStringStream;
    static commands = {
        undo: (cm: VimAdapter) => cm.host.undo(),
        redo: (cm: VimAdapter) => cm.host.redo(),
        newlineAndIndent: (cm: VimAdapter) => cm.replaceSelection("\n")
    };
    /** The keys of Insert mode that a repeat with `.` presses again. */
    static keys: Record<string, (cm: VimAdapter) => void> = {
        Backspace: (cm) => cm.editor.execute("delete"),
        Delete: (cm) => cm.editor.execute("deleteForward")
    };

    static isWordChar(character: string) {
        return /[\p{L}\p{N}_]/u.test(character);
    }

    static e_stop(event: Event) {
        event.stopPropagation();
        event.preventDefault();
    }

    static lookupKey(key: string, _map: string,
        handle: (binding: (cm: VimAdapter) => void) => void) {
        handle(VimAdapter.keys[key]);
    }

    static on(emitter: VimAdapter | EventTarget, type: string, handler: Handler) {
        if (emitter instanceof EventTarget) {
            emitter.addEventListener(type, handler as unknown as EventListener);
        } else {
            emitter._handlers[type] = [ ...(emitter._handlers[type] ?? []), handler ];
        }
    }

    static off(emitter: VimAdapter | EventTarget, type: string, handler: Handler) {
        if (emitter instanceof EventTarget) {
            emitter.removeEventListener(type, handler as unknown as EventListener);
        } else {
            const handlers = emitter._handlers[type] ?? [];
            emitter._handlers[type] = handlers.filter((each) => each !== handler);
        }
    }

    static signal(emitter: VimAdapter, type: string, ...args: unknown[]) {
        for (const handler of emitter._handlers[type] ?? []) {
            (handler as (...values: unknown[]) => unknown)(...args);
        }
    }

    // The members below are the interface the engine reads and writes.
    state: CM5EditorInterface["state"] = {};
    curOp: CM5EditorInterface["curOp"] = null;
    _handlers: Record<string, Handler[]> = { change: [], cursorActivity: [] };

    readonly highlights: SearchHighlights;
    /** The editing root, which stays known while the editor is destroyed. */
    private readonly root: HTMLElement;
    private readonly emitter = new (EmitterMixin())();
    private visibleIndex: LineIndex | null = null;
    private fullIndex: LineIndex | null = null;
    private revealVersion = -1;
    private isSelectionChanged = false;
    private lastEditEnd: ModelLivePosition | null = null;
    private lineHandles: (LineHandle & { position: ModelLivePosition })[] = [];
    /** What `getRange()` read last, for the register that the engine fills next. */
    private lastRead: ReadText | null = null;
    private lastReadContent: { text: string; lines: RichContent; range: RichContent } | null = null;
    private isRevealing = false;
    private readonly bookmarks = new Set<Bookmark>();
    /**
     * The selection that the engine made last, the range that it became in the model, which the
     * editor can widen, as to a whole table, and the lines it was made in.
     */
    private selected: { anchor: Pos; head: Pos; range: ModelRange; index: LineIndex } | null = null;
    private readonly options: Record<string, unknown> = {
        firstLineNumber: 1, tabSize: 4, indentWithTabs: false
    };

    constructor(readonly editor: Editor, readonly host: VimAdapterHost) {
        this.highlights = new SearchHighlights(editor, () => this.getFullIndex());
        this.root = editor.editing.view.getDomRoot() as HTMLElement;
        const document = editor.model.document;
        this.emitter.listenTo(document.selection, "change:range", () => {
            this.isSelectionChanged = true;
        });
        this.emitter.listenTo<ModelDocumentChangeEvent>(document, "change",
            (_evt, batch) => this.onDocumentChange(batch), { priority: "low" });
        if (editor.plugins.has(FindReveal)) {
            this.emitter.listenTo(editor.plugins.get(FindReveal), "change:position", () => {
                this.visibleIndex = null;
            });
        }
    }

    // Lines

    /** The lines that show, which the engine moves through. */
    index(): LineIndex {
        const hiddenBlocks = this.getHiddenBlocks();
        const revealVersion = hiddenBlocks?.revealVersion ?? 0;
        if (!this.visibleIndex || revealVersion !== this.revealVersion) {
            this.visibleIndex = new LineIndex(this.editor.model, this.getVisibility());
            this.revealVersion = revealVersion;
        }
        return this.visibleIndex;
    }

    /** All the lines of the note, the hidden ones included, which a search reads. */
    getFullIndex(): LineIndex {
        this.fullIndex ??= new LineIndex(this.editor.model, EVERYTHING_SHOWN);
        return this.fullIndex;
    }

    firstLine() {
        return 0;
    }

    lastLine() {
        return this.index().lastLine;
    }

    lineCount() {
        return this.index().lastLine + 1;
    }

    getLine(line: number): string {
        return this.index().getText(line);
    }

    indexFromPos(position: Pos): number {
        return this.index().indexOf(position);
    }

    posFromIndex(offset: number): Pos {
        const { line, ch } = this.index().positionOfIndex(offset);
        return new VimPosition(line, ch);
    }

    clipPos(position: Pos): Pos {
        const index = this.index();
        const last = index.lastLine;
        if (position.line < 0) {
            return new VimPosition(0, 0);
        }
        if (position.line > last) {
            return new VimPosition(last, index.getText(last).length);
        }
        const length = index.getText(position.line).length;
        const ch = position.ch === undefined || Number.isNaN(position.ch) ? length : position.ch;
        return new VimPosition(position.line, Math.min(Math.max(ch, 0), length));
    }

    getRange(from: Pos, to: Pos): string {
        const [ start, end ] = order(from, to);
        const clippedStart = this.clipPos(start);
        const clippedEnd = this.clipPos(end);
        const text = this.readText(clippedStart, clippedEnd);
        this.lastRead = {
            from: start, to: end, text, version: this.editor.model.document.version
        };
        this.lastReadContent = null;
        return text;
    }

    /**
     * The rich content that the engine read last as `text`, when nothing changed since: the
     * blocks of its lines for a linewise register, or else the content of the range. The register
     * commands store it with the text.
     */
    takeReadContent(text: string, isLinewise: boolean): RichContent | null {
        this.captureReadContent();
        const read = this.lastReadContent;
        if (!read || read.text !== text) {
            return null;
        }
        return isLinewise ? read.lines : read.range;
    }

    /** The place of `position` among the lines that show, for a position the engine reads. */
    locatePosition(position: ModelPosition): Pos {
        const { line, ch } = this.index().locate(position);
        return new VimPosition(line, ch);
    }

    /** The model position of `position`. A missing column is the end of the line. */
    toModelPosition(position: Pos): ModelPosition {
        const ch = position.ch === undefined ? Number.MAX_SAFE_INTEGER : position.ch;
        return this.index().positionAt(position.line, ch);
    }

    // Selection

    getCursor(which: "head" | "anchor" | "start" | "end" = "head"): Pos {
        const selection = this.editor.model.document.selection;
        const objectLine = this.getSelectedObjectLine();
        if (objectLine !== null) {
            const isEnd = !!this.state.vim?.visualMode && (which === "head" || which === "end");
            return new VimPosition(objectLine, isEnd ? 1 : 0);
        }
        const selected = this.getEngineSelection();
        if (selected) {
            const [ start, end ] = order(selected.anchor, selected.head);
            const ends = { head: selected.head, anchor: selected.anchor, start, end };
            return new VimPosition(ends[which].line, ends[which].ch);
        }
        let position: ModelPosition | null;
        switch (which) {
            case "anchor":
                position = selection.anchor;
                break;
            case "start":
                position = selection.getFirstPosition();
                break;
            case "end":
                position = selection.getLastPosition();
                break;
            default:
                position = selection.focus;
        }
        return this.locatePosition(position as ModelPosition);
    }

    listSelections() {
        return [ { anchor: this.getCursor("anchor"), head: this.getCursor("head") } ];
    }

    somethingSelected(): boolean {
        const selection = this.editor.model.document.selection;
        if (selection.isCollapsed) {
            return false;
        }
        return this.getSelectedObjectLine() === null || !!this.state.vim?.visualMode;
    }

    setCursor(line: number | Pos, ch?: number) {
        const position = typeof line === "object" ? line : new VimPosition(line, ch ?? 0);
        const clipped = this.clipPos(position);
        this.select(clipped, clipped);
    }

    setSelection(anchor: Pos, head: Pos) {
        this.select(this.clipPos(anchor), this.clipPos(head));
    }

    setSelections(ranges: { anchor: Pos; head: Pos }[], primary?: number) {
        const range = ranges[primary ?? 0] ?? ranges[0];
        if (range) {
            this.setSelection(range.anchor, range.head);
        }
    }

    /**
     * The text of the selection. A selection that the engine made is read as the engine made it,
     * since the editor can move its ends, as it moves the end of a range before a widget.
     */
    getSelection(): string {
        const selected = this.getEngineSelection();
        if (selected) {
            return this.getRange(selected.anchor, selected.head);
        }
        return this.somethingSelected()
            ? this.getRange(this.getCursor("start"), this.getCursor("end"))
            : "";
    }

    getSelections(): string[] {
        return [ this.getSelection() ];
    }

    isInMultiSelectMode() {
        return false;
    }

    /** Moves the cursor `increment` characters to the right, or to the left. */
    moveH(increment: number) {
        const cursor = this.getCursor();
        this.setCursor(cursor.line, cursor.ch + increment);
    }

    // Editing

    /**
     * Replaces the text from `from` to `to` with `text`. Text with as many lines as the text it
     * replaces changes in place, line by line. A caret inside the replaced text goes to the end of
     * the new text, and one in removed lines to the start of the line that takes their place.
     * Returns the position after the new text.
     */
    replaceRange(text: string, from: Pos, to?: Pos): ModelPosition | null {
        if (this.editor.isReadOnly) {
            return null;
        }
        const [ start, end ] = order(from, to ?? from);
        this.captureReadContent();
        const index = this.index();
        const wholeLines = text ? null : getWholeLines(index, start, end);
        if (wholeLines) {
            const cursor = this.getCursor();
            const isCursorInside = this.editor.model.document.selection.isCollapsed
                && cursor.line >= wholeLines.first && cursor.line <= wholeLines.last;
            removeLines(this.editor, index, wholeLines.first, wholeLines.last);
            if (isCursorInside) {
                this.setCursor(Math.min(wholeLines.first, this.lastLine()), 0);
            }
            return null;
        }

        const clippedStart = this.toCharacterEdge(this.clipPos(start), false);
        const clippedEnd = this.toCharacterEdge(this.clipPos(end), true);
        const range = this.toModelRange(clippedStart, clippedEnd);
        const selection = this.editor.model.document.selection;
        const focus = selection.focus;
        const isCursorInside = selection.isCollapsed && !!focus
            && !focus.isBefore(range.start) && !focus.isAfter(range.end);
        const oldText = this.readText(clippedStart, clippedEnd);
        const lines = text.split("\n");
        let newEnd: ModelPosition | null;
        if (oldText && lines.length === oldText.split("\n").length) {
            this.keepBookmarks(() => rewriteLines(this.editor, index, clippedStart, oldText, text));
            const last = lines.length - 1;
            const ch = (last ? 0 : clippedStart.ch) + lines[last].length;
            newEnd = this.index().positionAt(clippedStart.line + last, ch);
        } else {
            newEnd = replaceText(this.editor, range, text, oldText);
        }
        if (newEnd && isCursorInside) {
            this.editor.model.change((writer) => writer.setSelection(newEnd));
        }
        return newEnd;
    }

    replaceSelection(text: string) {
        const newEnd = this.replaceRange(text, this.getCursor("start"), this.getCursor("end"));
        if (newEnd) {
            this.editor.model.change((writer) => writer.setSelection(newEnd));
        }
    }

    replaceSelections(texts: string[]) {
        this.replaceSelection(texts[0] ?? "");
    }

    /** Writes `text` over the characters after the cursor, as Replace mode types. */
    overWriteSelection(text: string) {
        const head = this.getCursor("head");
        const length = this.getLine(head.line).length;
        const end = new VimPosition(head.line, Math.min(head.ch + text.length, length));
        this.replaceRange(text, head, end);
        this.setCursor(head.line, head.ch + text.length);
    }

    toggleOverwrite(isOn: boolean) {
        this.state.overwrite = isOn;
    }

    indentLine(line: number, isMore?: boolean) {
        const model = this.editor.model;
        const caret = ModelLivePosition.fromPosition(
            model.document.selection.focus as ModelPosition, "toNext");
        indentLines(this.editor, this.index(), line, line, !!isMore);
        model.change((writer) => writer.setSelection(caret.toPosition()));
        caret.detach();
    }

    indentMore() {
        this.indentSelection(true);
    }

    indentLess() {
        this.indentSelection(false);
    }

    execCommand(name: string) {
        if (name === "goLineLeft" || name === "goLineRight") {
            this.moveToDisplayLineEdge(name === "goLineRight");
            return;
        }
        const commands = VimAdapter.commands as Record<string, EngineCommand | undefined>;
        commands[name]?.(this);
    }

    // Operations and events

    operation<T>(fn: () => T): T {
        const operation = this.startOperationRecord();
        operation.$d++;
        const previous = activeAdapter;
        activeAdapter = this;
        try {
            return fn();
        } finally {
            activeAdapter = previous;
            operation.$d--;
            if (!operation.$d) {
                this.onBeforeEndOperation();
            }
        }
    }

    onBeforeEndOperation() {
        const operation = this.startOperationRecord();
        if (operation.change) {
            for (const handler of operation.changeHandlers as Handler[]) {
                (handler as (cm: VimAdapter, change: unknown) => void)(this, operation.change);
            }
        }
        const cursorHandlers = operation.cursorActivity
            ? operation.cursorActivityHandlers as Handler[]
            : [];
        for (const handler of cursorHandlers) {
            (handler as (cm: VimAdapter, value: null) => void)(this, null);
        }
        this.curOp = null;
        if (operation.cursorActivity && operation.isVimOp) {
            this.scrollIntoView();
        }
        this.host.onOperationEnd();
    }

    on(type: string, handler: Handler) {
        VimAdapter.on(this, type, handler);
    }

    off(type: string, handler: Handler) {
        VimAdapter.off(this, type, handler);
    }

    // Marks and line handles

    setBookmark(position: Pos, options?: { insertLeft?: boolean }): Marker {
        const live = ModelLivePosition.fromPosition(
            this.toModelPosition(this.clipPos(position)),
                options?.insertLeft ? "toNext" : "toPrevious");
        return new Bookmark(this, live, this.bookmarks) as unknown as Marker;
    }

    getLineHandle(line: number): LineHandle {
        const position = ModelLivePosition.fromPosition(
            this.toModelPosition(new VimPosition(line, 0)), "toNext");
        const handle = { row: line, index: 0, position };
        this.lineHandles.push(handle);
        return handle;
    }

    getLineNumber(handle: LineHandle): number | null {
        const position = (handle as LineHandle & { position: ModelLivePosition }).position;
        if (position.root.rootName === "$graveyard") {
            return null;
        }
        const located = this.index().locate(position.toPosition());
        return located.ch === 0 ? located.line : null;
    }

    releaseLineHandles() {
        for (const handle of this.lineHandles) {
            handle.position.detach();
        }
        this.lineHandles = [];
    }

    getLastEditEnd(): Pos {
        const position = this.lastEditEnd;
        if (!position || position.root.rootName === "$graveyard") {
            return this.getCursor();
        }
        return this.locatePosition(position.toPosition());
    }

    // Search

    getSearchCursor(query: RegExp, position: Pos) {
        return new SearchCursor({
            getFullIndex: () => this.getFullIndex(),
            toShownPosition: (modelPosition) => this.toShownPosition(modelPosition),
            replace: (start, end, text, oldText) => this.asVimOperation(() => replaceText(
                this.editor, this.editor.model.createRange(start, end), text, oldText))
        }, query, this.toModelPosition(position));
    }

    addOverlay(overlay: { query: RegExp }) {
        this.highlights.show(overlay.query);
        return overlay;
    }

    removeOverlay() {
        this.highlights.hide();
    }

    findMatchingBracket(position: Pos): { to: Pos | undefined } {
        const character = this.getLine(position.line).charAt(position.ch);
        const isOpening = "([{<".includes(character);
        const found = this.scanForBracket(
            new VimPosition(position.line, position.ch + (isOpening ? 1 : 0)), isOpening ? 1 : -1);
        return { to: found && found.ch === MATCHING_BRACKETS[character] ? found.pos : undefined };
    }

    scanForBracket(
        position: Pos, direction: 1 | -1, _style?: unknown, config?: { bracketRegex?: RegExp }
    ): { pos: Pos; ch: string } | false | null {
        const pattern = config?.bracketRegex ?? /[(){}[\]]/;
        const stack: string[] = [];
        const lastLine = this.lastLine();
        for (let line = position.line; line >= 0 && line <= lastLine; line += direction) {
            const text = this.getLine(line);
            const start = direction > 0 ? 0 : text.length - 1;
            let ch = line === position.line ? position.ch - (direction < 0 ? 1 : 0) : start;
            for (; ch >= 0 && ch < text.length; ch += direction) {
                const character = text.charAt(ch);
                if (!pattern.test(character)) {
                    continue;
                }
                if ("([{<".includes(character) === direction > 0) {
                    stack.push(character);
                } else if (!stack.length) {
                    return { pos: new VimPosition(line, ch), ch: character };
                } else {
                    stack.pop();
                }
            }
        }
        return null;
    }

    getTokenTypeAt(): "" {
        return "";
    }

    // Geometry and scrolling

    charCoords(position: Pos): { left: number; top: number; bottom: number } {
        const rect = this.getCharacterRect(this.clipPos(position));
        const origin = getOrigin(this.getScroller());
        return {
            left: rect.left - origin.left,
            top: rect.top - origin.top,
            bottom: rect.bottom - origin.top
        };
    }

    coordsChar(coordinates: { left: number; top: number }): Pos {
        const top = coordinates.top + getOrigin(this.getScroller()).top;
        return new VimPosition(this.getLineAt(top), 0);
    }

    getScrollInfo() {
        const scroller = this.getScroller();
        return {
            left: scroller.scrollLeft,
            top: scroller.scrollTop,
            height: scroller.scrollHeight,
            width: scroller.scrollWidth,
            clientHeight: scroller.clientHeight,
            clientWidth: scroller.clientWidth
        };
    }

    scrollTo(x?: number | null, y?: number | null) {
        const scroller = this.getScroller();
        scroller.scrollTo(
            { left: x ?? scroller.scrollLeft, top: y ?? scroller.scrollTop, behavior: "instant" });
    }

    scrollIntoView(position?: Pos | null, margin = 0) {
        if (!position) {
            this.scrollWithoutAnimation(() => this.editor.editing.view.scrollToTheSelection());
            return;
        }
        const scroller = this.getScroller();
        const coordinates = this.charCoords(position);
        const top = scroller.scrollTop;
        if (coordinates.top - margin < top) {
            this.scrollTo(null, coordinates.top - margin);
        } else if (coordinates.bottom + margin > top + scroller.clientHeight) {
            this.scrollTo(null, coordinates.bottom + margin - scroller.clientHeight);
        }
    }

    defaultTextHeight(): number {
        return parseFloat(getComputedStyle(this.root).lineHeight) || 16;
    }

    /**
     * The line `amount` lines away from `start`, or the line a page of the window away. A line in
     * a table moves to the same column of the next or the previous row.
     */
    findPosV(start: Pos, amount: number, unit: "page" | "line"): Pos {
        if (unit === "page") {
            return this.findPositionAPageAway(start, amount);
        }
        const lastLine = this.lastLine();
        let line = start.line;
        for (let step = 0; step < Math.abs(amount); step++) {
            const next = this.getVerticalNeighbor(line, amount > 0);
            if (next < 0 || next > lastLine) {
                break;
            }
            line = next;
        }
        return new VimPosition(line, (this.state.vim as vimState).lastHPos);
    }

    /**
     * The position on the screen line below `position`, or above it, in the same line of the note,
     * at `x` pixels from the left of the scrolled content. `null` when `position` is on the last or
     * the first screen line of its line.
     */
    findPositionOnScreenLine(position: Pos, isDown: boolean, x: number): Pos | null {
        const start = this.clipPos(position);
        const height = this.getCharacterRect(start).height;
        this.scrollIntoView(start, height * 2);
        const rect = this.getCharacterRect(start);
        const y = isDown ? rect.bottom + height / 2 : rect.top - height / 2;
        const target = this.toModelPositionAt(getOrigin(this.getScroller()).left + x, y);
        const found = target ? this.locatePosition(target) : null;
        const isAnotherRow = !!found && found.line === start.line
            && Math.abs(this.getCharacterRect(found).top - rect.top) > height / 2;
        return isAnotherRow ? found : null;
    }

    getInputField(): HTMLElement {
        return this.root;
    }

    focus() {
        this.editor.editing.view.focus();
    }

    // Options

    setOption(name: string, value: unknown) {
        this.options[name] = value;
    }

    getOption(name: string): unknown {
        return name === "readOnly" ? this.editor.isReadOnly : this.options[name];
    }

    // Dialogs

    openDialog(template: Element, onEnter: ((value: string) => void) | undefined,
        options: DialogOptions) {
        return this.host.openDialog(template, onEnter, options);
    }

    openNotification(template: Node, options: { duration: number }) {
        return this.host.openNotification(template, options.duration);
    }

    destroy() {
        this.emitter.stopListening();
        this.highlights.hide();
        this.releaseLineHandles();
        for (const bookmark of [ ...this.bookmarks ]) {
            bookmark.clear();
        }
        this.lastEditEnd?.detach();
    }

    // Helpers

    /** The model range from `from` to `to`, both inside the lines. */
    toModelRange(from: Pos, to: Pos): ModelRange {
        const index = this.index();
        return this.editor.model.createRange(index.positionAt(from.line, from.ch),
            index.positionAt(to.line, to.ch));
    }

    /**
     * The place of `position` among the lines that show. Hidden content around it shows for the
     * moment first, as Search in note shows its matches.
     */
    toShownPosition(position: ModelPosition): Pos {
        const block = position.parent as ModelElement;
        if (!this.index().has(block) && this.editor.plugins.has(FindReveal)) {
            this.isRevealing = true;
            this.editor.plugins.get(FindReveal).show(position);
            this.visibleIndex = null;
        }
        return this.locatePosition(position);
    }

    /** Stops showing the content that a search showed for the moment. */
    endReveal() {
        if (this.isRevealing) {
            this.isRevealing = false;
            this.editor.plugins.get(FindReveal).show(null);
            this.visibleIndex = null;
        }
    }

    /** Puts the caret outside a link or inline code that ends at it, as the arrow keys do. */
    leaveTwoStepBoundary() {
        const model = this.editor.model;
        const selection = model.document.selection;
        if (selection.isCollapsed && selection.focus && isAtTwoStepBoundary(selection.focus)) {
            model.change((writer) => writer.overrideSelectionGravity());
        }
    }

    /** The line of the object that the selection is on, or `null`. */
    getSelectedObjectLine(): number | null {
        const selected = this.editor.model.document.selection.getSelectedElement();
        const line = selected ? this.index().getFirstLine(selected) : undefined;
        return line !== undefined && this.index().lines[line].kind === "object" ? line : null;
    }

    private readText(from: Pos, to: Pos): string {
        const index = this.index();
        if (from.line === to.line) {
            return index.getText(from.line).slice(from.ch, to.ch);
        }
        const parts = [ index.getText(from.line).slice(from.ch) ];
        for (let line = from.line + 1; line < to.line; line++) {
            parts.push(index.getText(line));
        }
        parts.push(index.getText(to.line).slice(0, to.ch));
        return parts.join("\n");
    }

    /** Reads the rich content of what the engine read last, unless the note changed since. */
    private captureReadContent() {
        const read = this.lastRead;
        if (!read || this.lastReadContent || read.version !== this.editor.model.document.version) {
            return;
        }
        const index = this.index();
        this.lastReadContent = {
            text: read.text,
            lines: readRichContent(this.editor, index, read.from, read.to, true),
            range: readRichContent(this.editor, index, read.from, read.to, false)
        };
    }

    /**
     * Runs `rewrite`, which writes over lines in place, and puts each mark whose text it deleted
     * back at its line and column, as Vim keeps the marks of a changed line.
     */
    private keepBookmarks(rewrite: () => void) {
        const places: [ Bookmark, Pos | null ][] = [];
        for (const bookmark of this.bookmarks) {
            places.push([ bookmark, bookmark.find() ]);
        }
        rewrite();
        for (const [ bookmark, place ] of places) {
            if (place && bookmark.isDeleted()) {
                bookmark.moveTo(this.toModelPosition(this.clipPos(place)));
            }
        }
    }

    private select(from: Pos, to: Pos) {
        const index = this.index();
        const model = this.editor.model;
        // A collapsed cursor goes to the start of its character, and a range covers whole ones.
        const isRange = from.line !== to.line || from.ch !== to.ch;
        const isReversed = to.line < from.line || (to.line === from.line && to.ch < from.ch);
        const anchor = this.toCharacterEdge(from, isRange && isReversed);
        const head = this.toCharacterEdge(to, isRange && !isReversed);
        const entry = index.lines[head.line];
        const isObject = anchor.line === head.line && entry?.kind === "object";
        const anchorPosition = index.positionAt(anchor.line, anchor.ch);
        const headPosition = index.positionAt(head.line, head.ch);
        this.asVimOperation(() => {
            this.openCollapsiblesAround(headPosition);
            model.change((writer) => {
                if (isObject) {
                    writer.setSelection(entry.element, "on");
                    return;
                }
                const isBackward = headPosition.isBefore(anchorPosition);
                writer.setSelection(writer.createRange(
                    isBackward ? headPosition : anchorPosition,
                    isBackward ? anchorPosition : headPosition
                ), { backward: isBackward });
            });
            const range = model.document.selection.getFirstRange() as ModelRange;
            this.selected = { anchor, head, range, index: this.index() };
        });
    }

    /** The selection that the engine made last, while the editor keeps the range it became. */
    private getEngineSelection() {
        const selected = this.selected;
        const range = this.editor.model.document.selection.getFirstRange();
        const isKept = !!selected && !!range && selected.range.isEqual(range)
            && selected.index === this.index();
        return isKept ? selected : null;
    }

    /** `position`, or the edge of the character it falls inside, as `toCharacterEdge()` gives. */
    private toCharacterEdge(position: Pos, isForward: boolean): Pos {
        const ch = toCharacterEdge(this.getLine(position.line), position.ch, isForward);
        return ch === position.ch ? position : new VimPosition(position.line, ch);
    }

    /**
     * Runs `fn`, a change that the engine asked for, in an operation of the engine, which then
     * does not take the change for one of the user, as it does with a selection made outside, and
     * scrolls the cursor into view after it.
     */
    asVimOperation<T>(fn: () => T): T {
        if (this.curOp) {
            return fn();
        }
        return this.operation(() => {
            (this.curOp as { isVimOp?: boolean }).isVimOp = true;
            return fn();
        });
    }

    /**
     * Opens the closed collapsible blocks whose body holds `position`, which the cursor goes to.
     */
    private openCollapsiblesAround(position: ModelPosition) {
        const closed = position.getAncestors().filter((ancestor, index, ancestors) =>
            ancestor.is("element", "details") && !ancestor.getAttribute(OPEN_ATTRIBUTE)
            && !ancestors[index + 1]?.is("element", "summary")) as ModelElement[];
        if (closed.length) {
            this.editor.model.enqueueChange({ isUndoable: false }, (writer) => {
                for (const details of closed) {
                    writer.setAttribute(OPEN_ATTRIBUTE, true, details);
                }
            });
        }
    }

    private indentSelection(isMore: boolean) {
        const start = this.getCursor("start");
        const end = this.getCursor("end");
        const last = end.ch === 0 && end.line > start.line ? end.line - 1 : end.line;
        indentLines(this.editor, this.index(), start.line, last, isMore);
    }

    private onDocumentChange(batch: Batch) {
        const changes = this.editor.model.document.differ.getChanges();
        if (changes.length) {
            this.updateIndexes(changes);
            this.recordChanges(changes, batch.isUndoable);
            this.highlights.scheduleUpdate();
        }
        if (this.isSelectionChanged) {
            this.isSelectionChanged = false;
            const operation = this.startOperationRecord();
            operation.cursorActivityHandlers ??= [ ...this._handlers.cursorActivity ];
            operation.cursorActivity = true;
        }
        if (this.curOp && !this.curOp.$d) {
            this.onBeforeEndOperation();
        }
    }

    /** Keeps the indexes after a change of text only, and drops them after any other change. */
    private updateIndexes(changes: DifferItem[]) {
        const schema = this.editor.model.schema;
        const blocks = new Set<ModelElement>();
        for (const change of changes) {
            const isInline = change.type === "attribute"
                ? !change.range.start.nodeAfter?.is("element")
                    || schema.isInline(change.range.start.nodeAfter)
                : change.name === "$text" || schema.isInline(change.name);
            if (!isInline) {
                this.dropIndexes();
                return;
            }
            if (change.type !== "attribute") {
                blocks.add(change.position.parent as ModelElement);
            }
        }
        for (const block of blocks) {
            if (this.visibleIndex?.refreshBlock(block) === false) {
                this.visibleIndex = null;
            }
            if (this.fullIndex?.refreshBlock(block) === false) {
                this.fullIndex = null;
            }
        }
    }

    private dropIndexes() {
        this.visibleIndex = null;
        this.fullIndex = null;
    }

    /**
     * Passes the changes to the engine, which records the text typed in Insert mode, and keeps the
     * end of the last change that undo can take back, as the last edit: the end of inserted text,
     * or the start of an inserted block.
     */
    private recordChanges(changes: DifferItem[], isEdit: boolean) {
        const model = this.editor.model;
        const operation = this.startOperationRecord();
        operation.changeHandlers ??= [ ...this._handlers.change ];
        let lastEnd: ModelPosition | null = null;
        for (const change of changes) {
            let text = "";
            if (change.type === "insert") {
                const end = change.position.getShiftedBy(change.length);
                const isBlock = change.name !== "$text" && !model.schema.isInline(change.name);
                lastEnd = isBlock ? change.position : end;
                if (change.name === "$text") {
                    for (const item of model.createRange(change.position, end).getItems()) {
                        text += (item as ModelTextProxy).data;
                    }
                } else if (change.name === "softBreak" || !model.schema.isInline(change.name)) {
                    text = "\n";
                }
            } else if (change.type === "remove") {
                lastEnd = change.position;
            }
            const record = { text: text.split("\n"), origin: "+input", next: undefined as unknown };
            if (operation.lastChange) {
                operation.lastChange.next = record;
            } else {
                operation.change = record;
            }
            operation.lastChange = record;
        }
        if (isEdit && lastEnd && lastEnd.root.rootName !== "$graveyard") {
            this.lastEditEnd?.detach();
            this.lastEditEnd = ModelLivePosition.fromPosition(lastEnd, "toPrevious");
        }
    }

    private startOperationRecord(): NonNullable<CM5EditorInterface["curOp"]> {
        this.curOp ??= { $d: 0 };
        return this.curOp;
    }

    /**
     * The visibility of the lines: the sections of collapsed headings, the nested items of
     * collapsed list items and the bodies of closed collapsible blocks do not show.
     */
    private getVisibility(): LineVisibility {
        const plugins = this.editor.plugins;
        const isHiddenBlock = this.getHiddenBlocks()?.getHiddenSnapshot() ?? (() => false);
        const isHiddenItem = plugins.has(CollapsibleListItems)
            ? plugins.get(CollapsibleListItems).getHiddenSnapshot()
            : () => false;
        const mapper = this.editor.editing.mapper;
        return {
            isHidden: (node) => isHiddenBlock(node) || isHiddenItem(node),
            isOpen: (details) => !!details.getAttribute(OPEN_ATTRIBUTE)
                || !!mapper.toViewElement(details)?.hasAttribute(OPEN_ATTRIBUTE)
        };
    }

    private getHiddenBlocks(): HiddenBlocks | null {
        return this.editor.plugins.has(HiddenBlocks) ? this.editor.plugins.get(HiddenBlocks) : null;
    }

    /**
     * The line after `line`, or before it. In a table, the line after the last line of a cell is
     * the first line of the cell below, and the line after the last row is the line after the
     * table, and the other way going up.
     */
    private getVerticalNeighbor(line: number, isForward: boolean): number {
        const step = isForward ? line + 1 : line - 1;
        const cell = findAncestor(this.index().getElement(line) as ModelElement, "tableCell");
        if (!cell) {
            return step;
        }
        const index = this.index();
        const model = this.editor.model;
        const cellFirst = index.locate(model.createPositionAt(cell, 0)).line;
        const cellLast = index.locate(model.createPositionAt(cell, "end")).line;
        if (isForward ? line < cellLast : line > cellFirst) {
            return step;
        }

        const table = findAncestor(cell, "table") as ModelElement;
        const tableUtils = this.editor.plugins.get(TableUtils);
        const { row, column } = tableUtils.getCellLocation(cell);
        const rowSpan = Number(cell.getAttribute("rowspan") ?? 1);
        const targetRow = isForward ? row + rowSpan : row - 1;
        if (targetRow < 0) {
            const firstCell = [ ...new TableWalker(table, { row: 0 }) ][0].cell;
            return index.locate(model.createPositionAt(firstCell, 0)).line - 1;
        }
        if (targetRow >= tableUtils.getRows(table)) {
            const lastRow = table.getChild(tableUtils.getRows(table) - 1) as ModelElement;
            return index.locate(model.createPositionAfter(lastRow)).line;
        }
        // The table post-fixer gives each row a slot in every column.
        const target = [ ...new TableWalker(table, { row: targetRow, includeAllSlots: true }) ]
            .find((slot) => slot.column === column)?.cell as ModelElement;
        return index.locate(model.createPositionAt(target, isForward ? 0 : "end")).line;
    }

    /**
     * Scrolls a window height or `amount` of them, and returns the position at the same height of
     * the window as `start` was.
     */
    private findPositionAPageAway(start: Pos, amount: number): Pos {
        const scroller = this.getScroller();
        const scrollerTop = scroller.getBoundingClientRect().top;
        const offset = Math.max(this.getCharacterRect(start).top - scrollerTop, 0);
        this.scrollTo(null, scroller.scrollTop + amount * scroller.clientHeight);
        return new VimPosition(this.getLineAt(scrollerTop + offset), start.ch);
    }

    /** The first line that reaches below the viewport coordinate `y`, or the last line. */
    private getLineAt(y: number): number {
        let low = 0;
        let high = this.lastLine();
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            const length = this.getLine(middle).length;
            const rect = this.getCharacterRect(new VimPosition(middle, Math.max(length - 1, 0)));
            if (rect.bottom <= y) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        return low;
    }

    /** Moves the cursor to the start or the end of the screen line that it is on. */
    private moveToDisplayLineEdge(isEnd: boolean) {
        const cursor = this.getCursor();
        const rect = this.getCharacterRect(cursor);
        const blockRect = this.getElementRect(this.index().getElement(cursor.line) as ModelElement);
        const x = isEnd ? blockRect.right - 1 : blockRect.left + 1;
        const target = this.toModelPositionAt(x, (rect.top + rect.bottom) / 2);
        /* v8 ignore else -- the edges of a block of the editing root are points in the root */
        if (target) {
            const located = this.locatePosition(target);
            this.setCursor(located.line, isEnd ? Math.max(located.ch - 1, 0) : located.ch);
        }
    }

    /** The model position at the viewport coordinates `x` and `y`, if it is in the editing root. */
    private toModelPositionAt(x: number, y: number): ModelPosition | null {
        const domPosition = getCaretAt(x, y);
        if (!domPosition || !this.root.contains(domPosition.node)) {
            return null;
        }
        const { domConverter } = this.editor.editing.view;
        const viewPosition = domConverter.domPositionToView(domPosition.node, domPosition.offset);
        /* v8 ignore next -- a caret position in the root maps to the view */
        return viewPosition ? this.editor.editing.mapper.toModelPosition(viewPosition) : null;
    }

    /** The box of the character at `position`, or of the line when it has no character. */
    private getCharacterRect(position: Pos): DOMRect {
        const index = this.index();
        const entry = index.lines[position.line];
        if (entry.kind === "object") {
            return this.getElementRect(entry.element);
        }
        const length = index.getText(position.line).length;
        if (!length) {
            return this.getElementRect(entry.block);
        }
        const ch = Math.min(position.ch, length - 1);
        const range = this.toModelRange(new VimPosition(position.line, ch),
            new VimPosition(position.line, ch + 1));
        const { mapper, view } = this.editor.editing;
        const rects = view.domConverter.viewRangeToDom(mapper.toViewRange(range)).getClientRects();
        const box = [ ...rects ].find((each) => each.width || each.height);
        /* v8 ignore next -- a character that shows has a box */
        const rect = box ?? this.getElementRect(entry.block);
        return position.ch >= length ? new DOMRect(rect.right, rect.top, 0, rect.height) : rect;
    }

    private getElementRect(element: ModelElement): DOMRect {
        const { mapper, view } = this.editor.editing;
        const domElement = view.domConverter.mapViewToDom(
            mapper.toViewElement(element) as ViewElement) as HTMLElement;
        return domElement.getBoundingClientRect();
    }

    /**
     * Runs `scroll`, which scrolls the ancestors of the editing root, with their `scroll-behavior`
     * set to `auto` for the moment, so that a jump lands at once.
     */
    private scrollWithoutAnimation(scroll: () => void) {
        const smooth: [ HTMLElement, string ][] = [];
        for (let element = this.root.parentElement; element; element = element.parentElement) {
            if (getComputedStyle(element).scrollBehavior === "smooth") {
                smooth.push([ element, element.style.scrollBehavior ]);
                element.style.scrollBehavior = "auto";
            }
        }
        try {
            scroll();
        } finally {
            for (const [ element, value ] of smooth) {
                element.style.scrollBehavior = value;
            }
        }
    }

    /** The element that scrolls the note, the closest scrolling ancestor of the editing root. */
    private getScroller(): HTMLElement {
        for (let element = this.root.parentElement; element; element = element.parentElement) {
            const overflow = getComputedStyle(element).overflowY;
            if (overflow === "auto" || overflow === "scroll") {
                return element;
            }
        }
        return document.scrollingElement as HTMLElement;
    }
}

/** A mark of the engine, as a live position of the model. */
class Bookmark {

    private isCleared = false;

    constructor(
        private readonly cm: VimAdapter, private position: ModelLivePosition,
        private readonly bookmarks: Set<Bookmark>
    ) {
        bookmarks.add(this);
    }

    clear() {
        this.isCleared = true;
        this.position.detach();
        this.bookmarks.delete(this);
    }

    /** The place of the bookmark, or `null` once it is cleared or its text is deleted. */
    find(): Pos | null {
        if (this.isCleared || this.isDeleted()) {
            return null;
        }
        return this.cm.locatePosition(this.position.toPosition());
    }

    /** Whether the text that the bookmark was in is deleted. */
    isDeleted(): boolean {
        return this.position.root.rootName === "$graveyard";
    }

    /** Puts the bookmark at `position`. */
    moveTo(position: ModelPosition) {
        const stickiness = this.position.stickiness;
        this.position.detach();
        this.position = ModelLivePosition.fromPosition(position, stickiness);
    }
}

/** The bracket that closes each opening bracket, and that opens each closing one. */
const MATCHING_BRACKETS: Record<string, string> = {
    "(": ")", "[": "]", "{": "}", "<": ">", ")": "(", "]": "[", "}": "{", ">": "<"
};

/** `from` and `to` in document order. */
function order(from: Pos, to: Pos): [ Pos, Pos ] {
    const isReversed = to.line < from.line || (to.line === from.line && to.ch < from.ch);
    return isReversed ? [ to, from ] : [ from, to ];
}

/** The closest ancestor of `element` named `name`, or `element` itself. */
function findAncestor(element: ModelElement, name: string): ModelElement | null {
    let current: ModelElement | null = element;
    while (current) {
        if (current.is("element", name)) {
            return current;
        }
        current = current.parent as ModelElement | null;
    }
    return null;
}

/** The viewport coordinates of the top left corner of the scrolled content of `scroller`. */
function getOrigin(scroller: HTMLElement) {
    const rect = scroller.getBoundingClientRect();
    return { left: rect.left - scroller.scrollLeft, top: rect.top - scroller.scrollTop };
}

/** The DOM position of the caret at the viewport coordinates `x` and `y`. */
function getCaretAt(x: number, y: number): { node: Node; offset: number } | null {
    const doc = document as Document & {
        caretPositionFromPoint?: (x: number, y: number) => CaretPosition | null;
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    if (doc.caretPositionFromPoint) {
        const position = doc.caretPositionFromPoint(x, y);
        return position ? { node: position.offsetNode, offset: position.offset } : null;
    }
    const range = doc.caretRangeFromPoint?.(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
}
