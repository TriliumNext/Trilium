import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
    ChangeSet, EditorState, type Extension, findClusterBreak, Prec, RangeSetBuilder, StateEffect,
    StateField, type Text, Transaction, type TransactionSpec
} from "@codemirror/state";
import {
    Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate, WidgetType
} from "@codemirror/view";
import {
    findBlockIdAttributes, findBlockMarkers, type FoundBlockId
} from "@triliumnext/commons/src/lib/block_reference.js";

/** A block marker of a document, and whether it gives its id to a rendered block. */
export interface MarkerState {
    from: number;
    to: number;
    isEffective: boolean;
}

export interface BlockMarkerOptions {
    /**
     * Reads which markers of `doc` give their id to a rendered block, as the renderer reads them.
     * Called a moment after the document changes, unless it holds no marker. Without it, no
     * marker shows as inert.
     */
    readMarkers?: (doc: string) => MarkerState[];
    /** The `title` of the chip of a marker. */
    getTitle?: (marker: FoundBlockId, isEffective: boolean) => string;
    /** Opens the menu of the chip of `marker`, which `element` draws. */
    openMenu?: (marker: FoundBlockId, element: HTMLElement) => void;
}

/**
 * The block markers of a Markdown note. Each is drawn as an atomic chip; Backspace, Delete and
 * Enter beside one act on the text around it; no edit leaves part of a marker; and a marker pasted
 * with an id that the note holds already is dropped.
 */
export function blockMarkers(options: BlockMarkerOptions = {}): Extension {
    return [
        createChipPlugin(options),
        Prec.high(keymap.of([
            { key: "Backspace", run: deleteBeforeMarker },
            { key: "Delete", run: deleteAfterMarker },
            { key: "Enter", run: openLineAboveMarkerLine }
        ])),
        EditorState.transactionFilter.of(keepMarkersWhole),
        EditorState.transactionFilter.of(keepMarkerOnSplitLine),
        EditorState.transactionFilter.of(dropDuplicateMarkers),
        changeRecord,
        trackedPositions,
        flashedLines,
        blockMarkerTheme
    ];
}

/** The block markers of `state` from `from` to `to`, outside code, where a marker is text. */
export function findMarkers(state: EditorState, from = 0, to = state.doc.length): FoundBlockId[] {
    return findBlockMarkers(state.sliceDoc(from, to))
        .map((marker) => ({ ...marker, from: from + marker.from, to: from + marker.to }))
        .filter((marker) => !isInCode(state, marker.from));
}

/** The changes of a document since its base, the content that its editor last loaded or saved. */
export interface ChangeRecord {
    /** The content that the changes start from. */
    base: Text;
    /** The changes from `base` to the document. */
    changes: ChangeSet;
}

/** A position of a document, and the side of it that text inserted there ends up on. */
export interface TrackedPosition {
    pos: number;
    assoc: -1 | 1;
}

/** The record of the changes of the document of `state`. A load starts it again. */
export function getChangeRecord(state: EditorState): ChangeRecord {
    return state.field(changeRecord);
}

/** Starts the record of the changes again: from `record`, which leads to the document, or empty. */
export function setChangeRecord(view: EditorView, record?: ChangeRecord) {
    const { doc } = view.state;
    view.dispatch({
        effects: setRecord.of(record ?? { base: doc, changes: ChangeSet.empty(doc.length) })
    });
}

/**
 * Moves `record`, which leads to the document of `view`, onto a new base: `record.base` with
 * `baseChanges` applied. The record then leads from that base to the document.
 */
export function rebaseChangeRecord(
    view: EditorView,
    record: ChangeRecord,
    baseChanges: readonly { from: number; to: number; insert: string }[]
) {
    const onBase = ChangeSet.of(baseChanges, record.base.length);
    setChangeRecord(view, {
        base: onBase.apply(record.base),
        changes: onBase.invert(record.base).compose(record.changes)
    });
}

/** Applies `changes`, all on the document of `view`, in one transaction outside the history. */
export function applyOutsideHistory(
    view: EditorView,
    changes: readonly { from: number; to: number; insert: string }[]
) {
    view.dispatch({ changes, annotations: Transaction.addToHistory.of(false) });
}

/**
 * Keeps `positions` of the document of `view` mapped through its changes until other positions
 * are tracked. Returns the reader of the mapped positions, which answers `null` once others are
 * tracked or the document was loaded again.
 */
export function trackPositions(view: EditorView, positions: TrackedPosition[]) {
    const owner = {};
    view.dispatch({ effects: setTrackedPositions.of({ owner, positions }) });
    return () => {
        const tracked = view.state.field(trackedPositions, false);
        return tracked?.owner === owner ? tracked.positions.map(({ pos }) => pos) : null;
    };
}

/** Highlights the lines from `fromLine` to `toLine`, 1-indexed, for `duration` milliseconds. */
export function flashLines(view: EditorView, fromLine: number, toLine: number, duration: number) {
    const flash = { from: fromLine, to: toLine };
    view.dispatch({ effects: setFlashedLines.of(flash) });
    setTimeout(() => {
        if (view.state.field(flashedLines).flash === flash) {
            view.dispatch({ effects: setFlashedLines.of(null) });
        }
    }, duration);
}

type FilterResult = Transaction | TransactionSpec | readonly (Transaction | TransactionSpec)[];

//#region Chips
/** Dispatched once the markers were read, to draw their chips again. */
const markersRead = StateEffect.define<void>();

function createChipPlugin(options: BlockMarkerOptions) {
    return ViewPlugin.define((view) => new MarkerChipsPlugin(view, options), {
        decorations: (value) => value.decorations,
        provide: (plugin) => EditorView.atomicRanges.of(
            /* v8 ignore next -- defensive: the plugin that provides the facet is in the view */
            (view) => view.plugin(plugin)?.decorations ?? Decoration.none
        ),
        eventHandlers: {
            mousedown(event, view) {
                const chip = (event.target as HTMLElement).closest<HTMLElement>(".cm-block-marker");
                const marker = chip ? findMarkerAt(view.state, view.posAtDOM(chip), "from") : null;
                if (!chip || !marker || !options.openMenu) {
                    return false;
                }
                event.preventDefault();
                options.openMenu(marker, chip);
                return true;
            }
        }
    });
}

class MarkerChipsPlugin {
    decorations: DecorationSet;
    /** The starts of the markers that the last read found, and of those that were effective. */
    private known = new Set<number>();
    private effective = new Set<number>();
    private timer: ReturnType<typeof setTimeout> | undefined;

    constructor(private readonly view: EditorView, private readonly options: BlockMarkerOptions) {
        this.decorations = this.build();
        this.scheduleRead();
    }

    update(update: ViewUpdate) {
        const isRead = update.transactions.some(
            (tr) => tr.effects.some((effect) => effect.is(markersRead)));
        const isParsed = syntaxTree(update.startState) !== syntaxTree(update.state);
        if (update.docChanged) {
            const map = (starts: Set<number>) =>
                new Set([ ...starts ].map((start) => update.changes.mapPos(start, 1)));
            this.known = map(this.known);
            this.effective = map(this.effective);
            this.scheduleRead();
        }
        if (update.docChanged || update.viewportChanged || isRead || isParsed) {
            this.decorations = this.build();
        }
    }

    destroy() {
        clearTimeout(this.timer);
    }

    private scheduleRead() {
        const { readMarkers } = this.options;
        if (!readMarkers) {
            return;
        }
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            const doc = this.view.state.doc.toString();
            const markers = findBlockMarkers(doc).length ? readMarkers(doc) : [];
            this.known = new Set(markers.map(({ from }) => from));
            this.effective = new Set(markers.filter((m) => m.isEffective).map(({ from }) => from));
            this.view.dispatch({ effects: markersRead.of() });
        }, READ_DELAY);
    }

    private build(): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        for (const visible of this.view.visibleRanges) {
            for (const marker of findMarkers(this.view.state, visible.from, visible.to)) {
                const isEffective = !this.known.has(marker.from) || this.effective.has(marker.from);
                const title = this.options.getTitle?.(marker, isEffective) ?? marker.id ?? "";
                const widget = new MarkerWidget(title, isEffective);
                builder.add(marker.from, marker.to, Decoration.replace({ widget }));
            }
        }
        return builder.finish();
    }
}

class MarkerWidget extends WidgetType {
    constructor(private readonly title: string, private readonly isEffective: boolean) {
        super();
    }

    override eq(other: MarkerWidget) {
        return other.title === this.title && other.isEffective === this.isEffective;
    }

    override toDOM() {
        const element = document.createElement("span");
        element.className = this.isEffective ? "cm-block-marker" : "cm-block-marker inert";
        element.title = this.title;
        const icon = document.createElement("span");
        icon.className = "bx bx-anchor";
        icon.setAttribute("aria-hidden", "true");
        element.append(icon);
        return element;
    }

    override ignoreEvent() {
        return false;
    }
}

/** How long the document stays unchanged before its markers are read again, in milliseconds. */
const READ_DELAY = 300;
//#endregion

//#region Keys
/** Backspace right after a marker deletes what is in front of it, past adjacent markers. */
function deleteBeforeMarker(view: EditorView) {
    const head = getEditableCaret(view.state);
    let marker = head === null ? null : findMarkerAt(view.state, head, "to");
    if (head === null || !marker) {
        return false;
    }
    let start = marker.from;
    while ((marker = findMarkerAt(view.state, start, "to"))) {
        start = marker.from;
    }
    if (start === 0) {
        return true;
    }

    const line = view.state.doc.lineAt(start);
    const from = start === line.from
        ? start - 1
        : line.from + findClusterBreak(line.text, start - line.from, false);
    view.dispatch({
        changes: { from, to: start },
        selection: { anchor: head - (start - from) },
        userEvent: "delete.backward"
    });
    return true;
}

/** Delete right before a marker deletes what is after it, past adjacent markers. */
function deleteAfterMarker(view: EditorView) {
    const head = getEditableCaret(view.state);
    let marker = head === null ? null : findMarkerAt(view.state, head, "from");
    if (head === null || !marker) {
        return false;
    }
    let end = marker.to;
    while ((marker = findMarkerAt(view.state, end, "from"))) {
        end = marker.to;
    }
    if (end === view.state.doc.length) {
        return true;
    }

    const line = view.state.doc.lineAt(end);
    const to = end === line.to
        ? end + 1
        : line.from + findClusterBreak(line.text, end - line.from, true);
    view.dispatch({
        changes: { from: end, to },
        selection: { anchor: head },
        userEvent: "delete.forward"
    });
    return true;
}

/** Enter at the end of a marker line opens the line above it: the marker stays with its block. */
function openLineAboveMarkerLine(view: EditorView) {
    const head = getEditableCaret(view.state);
    const line = head === null ? null : view.state.doc.lineAt(head);
    if (!line || head !== line.to || !isMarkerLine(view.state, line.from, line.to)) {
        return false;
    }
    view.dispatch({
        changes: { from: line.from, insert: "\n" },
        selection: { anchor: line.from },
        userEvent: "input"
    });
    return true;
}

/** The caret of `state`, or `null` when it is read-only or has a selection or several carets. */
function getEditableCaret(state: EditorState) {
    const { main } = state.selection;
    return !state.readOnly && state.selection.ranges.length === 1 && main.empty
        ? main.head
        : null;
}

/** The marker whose `edge` is at `position`, or `null`. */
function findMarkerAt(state: EditorState, position: number, edge: "from" | "to") {
    const line = state.doc.lineAt(position);
    return findMarkers(state, line.from, line.to).find((marker) => marker[edge] === position)
        ?? null;
}

/** Whether the line from `from` to `to` holds a marker alone. */
function isMarkerLine(state: EditorState, from: number, to: number) {
    const markers = findMarkers(state, from, to);
    const text = state.sliceDoc(from, to);
    return markers.length === 1 && !text.slice(0, markers[0].from - from).trim()
        && !text.slice(markers[0].to - from).trim();
}
//#endregion

//#region Filters
/**
 * Widens a change that covers part of a marker to the whole marker, and moves an insertion inside
 * a marker to its end, so that no input leaves half a tag. A complete marker passes as it is.
 */
function keepMarkersWhole(tr: Transaction): FilterResult {
    if (!tr.docChanged || isExempt(tr)) {
        return tr;
    }

    const markers = findMarkers(tr.startState);
    let isWidened = false;
    const changes: { from: number; to: number; insert: string }[] = [];
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        let from = fromA;
        let to = toA;
        for (const marker of markers) {
            if (from === to && marker.from < from && from < marker.to) {
                from = to = marker.to;
            } else if (from < marker.to && to > marker.from
                && (from > marker.from || to < marker.to)) {
                from = Math.min(from, marker.from);
                to = Math.max(to, marker.to);
            }
        }
        isWidened ||= from !== fromA || to !== toA;
        changes.push({ from, to, insert: inserted.toString() });
    });
    if (!isWidened) {
        return tr;
    }

    const widened = ChangeSet.of(mergeChanges(changes), tr.startState.doc.length);
    return {
        changes: widened,
        selection: tr.startState.selection.map(widened, 1),
        effects: tr.effects,
        userEvent: tr.annotation(Transaction.userEvent),
        scrollIntoView: tr.scrollIntoView
    };
}

/**
 * Keeps the marker at the end of a line on the first part when a line break splits the line
 * before the marker, as the text editor keeps the id of a split block on its first part.
 */
function keepMarkerOnSplitLine(tr: Transaction): FilterResult {
    if (!tr.isUserEvent("input") || isExempt(tr)) {
        return tr;
    }

    const doc = tr.startState.doc;
    let split: { position: number; lineFrom: number; marker: FoundBlockId } | undefined;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        const line = doc.lineAt(fromA);
        const markers = findMarkers(tr.startState, line.from, line.to);
        const marker = markers[markers.length - 1];
        const textStart = line.from + line.text.length - line.text.trimStart().length;
        if (marker && !doc.sliceString(marker.to, line.to).trim() && fromA === toA
            && inserted.toString().includes("\n") && fromA > textStart && fromA <= marker.from) {
            split = { position: fromA, lineFrom: line.from, marker };
        }
    });
    if (!split) {
        return tr;
    }

    const { position, lineFrom, marker } = split;
    // The white space in front of the marker goes with it.
    const between = doc.sliceString(position, marker.from);
    const removedFrom = marker.from - (between.length - between.replace(/[ \t]+$/, "").length);
    const markerText = doc.sliceString(marker.from, marker.to);
    const isSpaced = /[ \t]$/.test(doc.sliceString(lineFrom, position));
    return [ tr, {
        changes: [
            {
                from: tr.changes.mapPos(position, -1),
                insert: isSpaced ? markerText : ` ${markerText}`
            },
            { from: tr.changes.mapPos(removedFrom, 1), to: tr.changes.mapPos(marker.to, 1) }
        ],
        sequential: true
    } ];
}

/**
 * Drops a marker that a change inserts with an id that the note holds already, outside the
 * change, on a marker or on any other tag; of two inserted copies, the first stays. Decided on the
 * whole transaction, so a marker moved within it keeps its id.
 */
function dropDuplicateMarkers(tr: Transaction): FilterResult {
    if (!tr.docChanged || isExempt(tr)) {
        return tr;
    }

    const inserted: FoundBlockId[] = [];
    tr.changes.iterChanges((_fromA, _toA, fromB, toB) => {
        for (const marker of findBlockMarkers(tr.newDoc.sliceString(fromB, toB))) {
            inserted.push({ ...marker, from: fromB + marker.from, to: fromB + marker.to });
        }
    });
    if (!inserted.length) {
        return tr;
    }

    // A marker that lands in code, such as a pasted fence, is text.
    const { state } = tr;
    const tree = ensureSyntaxTree(state, inserted[inserted.length - 1].to, PARSE_TIMEOUT)
        ?? syntaxTree(state);
    const insertedMarkers = inserted.filter((marker) => !isInCode(state, marker.from, tree));
    if (!insertedMarkers.length) {
        return tr;
    }

    const reserved = new Set(findBlockIdAttributes(tr.startState.doc.toString())
        .filter((found) => !tr.changes.touchesRange(found.from, found.to)
            && !isInCode(tr.startState, found.from))
        .flatMap((found) => found.id ?? []));
    const removed: { from: number; to: number }[] = [];
    for (const marker of insertedMarkers) {
        if (marker.id && reserved.has(marker.id)) {
            removed.push({ from: marker.from, to: marker.to });
        } else if (marker.id) {
            reserved.add(marker.id);
        }
    }
    return removed.length ? [ tr, { changes: removed, sequential: true } ] : tr;
}

/** Whether `tr` replaces the whole document or replays the history, which the filters leave. */
function isExempt(tr: Transaction) {
    return replacesWholeDocument(tr) || tr.isUserEvent("undo") || tr.isUserEvent("redo");
}

function replacesWholeDocument(tr: Transaction) {
    let isWholeDocument = false;
    tr.changes.iterChangedRanges((fromA, toA) => {
        isWholeDocument ||= fromA === 0 && toA === tr.startState.doc.length;
    });
    return isWholeDocument;
}

/** `changes`, sorted, with those that overlap once widened merged into one. */
function mergeChanges(changes: { from: number; to: number; insert: string }[]) {
    const merged: { from: number; to: number; insert: string }[] = [];
    for (const change of [ ...changes ].sort((a, b) => a.from - b.from)) {
        const last = merged[merged.length - 1];
        if (last && change.from < last.to) {
            last.to = Math.max(last.to, change.to);
            last.insert += change.insert;
        } else {
            merged.push({ ...change });
        }
    }
    return merged;
}

/** How long the parse of a pasted text can take before markers in it are read, in milliseconds. */
const PARSE_TIMEOUT = 50;

/** Whether `position` of `state` is inside code, where a marker is text, as `tree` parses it. */
export function isInCode(state: EditorState, position: number, tree = syntaxTree(state)) {
    const innermost = tree.resolveInner(position, 1);
    for (let node: typeof innermost | null = innermost; node; node = node.parent) {
        if (node.name.includes("Code")) {
            return true;
        }
    }
    return false;
}
//#endregion

//#region Change record, tracked positions and flashes
const setRecord = StateEffect.define<ChangeRecord>();

const changeRecord = StateField.define<ChangeRecord>({
    create: (state) => ({ base: state.doc, changes: ChangeSet.empty(state.doc.length) }),
    update(record, tr) {
        for (const effect of tr.effects) {
            if (effect.is(setRecord)) {
                return effect.value;
            }
        }
        if (!tr.docChanged) {
            return record;
        }
        return isLoad(tr)
            ? { base: tr.newDoc, changes: ChangeSet.empty(tr.newDoc.length) }
            : { base: record.base, changes: record.changes.compose(tr.changes) };
    }
});

type Tracked = { owner: object; positions: readonly TrackedPosition[] };

const setTrackedPositions = StateEffect.define<Tracked>();

const trackedPositions = StateField.define<Tracked | null>({
    create: () => null,
    update(tracked, tr) {
        for (const effect of tr.effects) {
            if (effect.is(setTrackedPositions)) {
                return effect.value;
            }
        }
        if (!tracked || !tr.docChanged) {
            return tracked;
        }
        if (isLoad(tr)) {
            return null;
        }
        return {
            owner: tracked.owner,
            positions: tracked.positions.map(({ pos, assoc }) =>
                ({ pos: tr.changes.mapPos(pos, assoc), assoc }))
        };
    }
});

/** Whether `tr` loads a document: it replaces the whole document, and no user did. */
function isLoad(tr: Transaction) {
    return replacesWholeDocument(tr) && tr.annotation(Transaction.userEvent) === undefined;
}

type LineRange = { from: number; to: number };

const setFlashedLines = StateEffect.define<LineRange | null>();

/** The lines that a revealed link target highlights, and their decorations. */
const flashedLines = StateField.define<{ flash: LineRange | null; decorations: DecorationSet }>({
    create: () => ({ flash: null, decorations: Decoration.none }),
    update(value, tr) {
        for (const effect of tr.effects) {
            if (effect.is(setFlashedLines)) {
                return { flash: effect.value, decorations: buildFlash(tr.state, effect.value) };
            }
        }
        return { ...value, decorations: value.decorations.map(tr.changes) };
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations)
});

function buildFlash(state: EditorState, flash: LineRange | null) {
    const builder = new RangeSetBuilder<Decoration>();
    const last = flash ? Math.min(flash.to, state.doc.lines) : 0;
    for (let line = flash?.from ?? 1; line <= last; line++) {
        builder.add(state.doc.line(line).from, state.doc.line(line).from, FLASHED_LINE);
    }
    return builder.finish();
}

const FLASHED_LINE = Decoration.line({ class: "cm-block-flash" });
//#endregion

const blockMarkerTheme = EditorView.baseTheme({
    ".cm-block-marker": {
        display: "inline-flex",
        alignItems: "center",
        padding: "0 0.25em",
        borderRadius: "0.5em",
        background: "var(--block-marker-background-color, "
            + "color-mix(in srgb, currentColor 10%, transparent))",
        color: "var(--block-marker-color, inherit)",
        verticalAlign: "baseline",
        cursor: "pointer"
    },
    ".cm-block-marker.inert": {
        opacity: "0.4"
    },
    ".cm-block-flash": {
        backgroundColor: "var(--block-flash-background-color, "
            + "color-mix(in srgb, var(--main-selection-color, #4e8ef7) 25%, transparent))"
    }
});
