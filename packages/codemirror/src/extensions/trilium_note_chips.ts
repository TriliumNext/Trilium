import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, RangeSetBuilder, StateEffect } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";

/** What a note id is drawn as, once the consumer has looked the note up. */
export interface NoteChip {
    title: string;
    /** The icon's classes, such as `bx bx-file`. */
    icon: string;
}

/**
 * Answers what a note is called. Returning a value rather than a promise draws the chip in the
 * same pass, so a note already to hand never flickers through its id; `null` means no such note,
 * and leaves the id standing as text.
 */
export type NoteChipResolver = (noteId: string) => NoteChip | Promise<NoteChip | null> | null;

/** A note id found in the text, and the range its chip is drawn over. */
export interface NoteIdRange {
    from: number;
    to: number;
    noteId: string;
}

/** Finds the note ids in the document between `from` and `to`, left to right. */
export type NoteIdFinder = (state: EditorState, from: number, to: number) => NoteIdRange[];

export interface NoteChipOptions {
    /** Where the note ids stand. Defaults to the value of a search query's `noteId` comparison. */
    find?: NoteIdFinder;
    /**
     * Shows the text behind a chip while the selection touches it, so the caret goes into it as into
     * any text. Without it, each chip is atomic.
     */
    revealAtSelection?: boolean;
}

/**
 * Draws the note ids in a search query as chips carrying the note's icon and title.
 *
 * A query stores the id, so it goes on matching a note that has since been renamed — which leaves
 * the field showing a string that says nothing about which note it is. The chip is presentation
 * over that id and never changes it: the text behind a chip is what the query is run with.
 *
 * Each chip is atomic, so the caret steps over it and a backspace beside it takes the whole id
 * rather than a character of it. To point a clause at another note, delete the chip and mention
 * one again. With `revealAtSelection`, as for a Markdown note's `[[noteId]]` links found by
 * {@link findWikilinkNoteIds}, the text shows instead while the selection touches it.
 *
 * Only the visible part of the document is read, so a long one costs no more than a screenful.
 *
 * The decorations live in a view plugin rather than a {@link StateField}, unlike
 * `triliumSearchHighlighter`: a note that has to be fetched arrives after the update that asked
 * for it, and the plugin holds the view it dispatches the answer to.
 */
export function triliumNoteChips(resolve: NoteChipResolver, { find = findSearchNoteIds, revealAtSelection = false }: NoteChipOptions = {}): Extension {
    const plugin = ViewPlugin.define(
        (view) => new NoteChipsPlugin(view, resolve, find, revealAtSelection),
        {
            decorations: (value) => value.decorations,
            provide: revealAtSelection ? undefined : (plugin) => EditorView.atomicRanges.of(
                (view) => view.plugin(plugin)?.decorations ?? Decoration.none
            )
        }
    );

    return [ plugin, noteChipTheme ];
}

/** Dispatched once a note asked for asynchronously arrives, to draw the chip waiting on it. */
const noteChipResolved = StateEffect.define<void>();

class NoteChipsPlugin {
    decorations: DecorationSet;
    /** What each id resolved to, `null` for an id naming no note. Read on every rebuild. */
    private readonly resolved = new Map<string, NoteChip | null>();
    private readonly pending = new Set<string>();

    constructor(
        private readonly view: EditorView,
        private readonly resolve: NoteChipResolver,
        private readonly find: NoteIdFinder,
        private readonly revealAtSelection: boolean
    ) {
        this.decorations = this.build();
    }

    update(update: ViewUpdate) {
        const arrived = update.transactions.some(
            (tr) => tr.effects.some((effect) => effect.is(noteChipResolved))
        );
        // A finder that reads the syntax tree sees more of it as the parser catches up.
        const parsed = syntaxTree(update.startState) !== syntaxTree(update.state);
        const revealed = this.revealAtSelection && update.selectionSet;

        if (update.docChanged || update.viewportChanged || arrived || parsed || revealed) {
            this.decorations = this.build();
        }
    }

    private build(): DecorationSet {
        const { state } = this.view;
        const builder = new RangeSetBuilder<Decoration>();

        for (const visible of this.view.visibleRanges) {
            for (const { from, to, noteId } of this.find(state, visible.from, visible.to)) {
                if (this.revealAtSelection && state.selection.ranges.some((range) => range.from <= to && range.to >= from)) {
                    continue;
                }

                const chip = this.chipFor(noteId);
                if (chip) {
                    builder.add(from, to, Decoration.replace({ widget: new NoteChipWidget(noteId, chip) }));
                }
            }
        }

        return builder.finish();
    }

    /** The chip for an id, asking for one that has not been looked up yet. */
    private chipFor(noteId: string): NoteChip | null {
        const known = this.resolved.get(noteId);
        if (known !== undefined) {
            return known;
        }

        if (this.pending.has(noteId)) {
            return null;
        }

        const answer = this.resolve(noteId);
        if (!(answer instanceof Promise)) {
            this.resolved.set(noteId, answer ?? null);
            return answer;
        }

        this.pending.add(noteId);
        void answer
            .catch(() => null)
            .then((chip) => {
                this.pending.delete(noteId);
                // `undefined` would read as never asked, and the dispatch below would ask again.
                this.resolved.set(noteId, chip ?? null);
                // Outside the update that asked for it, so dispatching here is safe.
                this.view.dispatch({ effects: noteChipResolved.of() });
            });

        return null;
    }
}

class NoteChipWidget extends WidgetType {
    constructor(private readonly noteId: string, private readonly chip: NoteChip) {
        super();
    }

    override eq(other: NoteChipWidget) {
        return other.noteId === this.noteId
            && other.chip.title === this.chip.title
            && other.chip.icon === this.chip.icon;
    }

    override toDOM() {
        const element = document.createElement("span");
        element.className = "cm-note-chip";
        // Names the id the chip stands for, which is what the query is actually run with.
        element.title = this.noteId;

        const icon = document.createElement("span");
        icon.className = `cm-note-chip-icon ${this.chip.icon}`;
        icon.setAttribute("aria-hidden", "true");

        element.append(icon, this.chip.title);

        return element;
    }
}

/**
 * A note id standing as the value of a `noteId` comparison. Only that position is read, rather
 * than every word shaped like an id, so an ordinary word of the full-text query is never drawn as
 * a note. The leading group runs to the value so its length places the value in the query.
 */
const NOTE_ID_COMPARISON = /(\.noteId\s*(?:!?=|\*=\*|=\*|\*=)\s*["'`]?)([A-Za-z0-9_]+)/g;

/** The values of a search query's `noteId` comparisons, left to right, as `RangeSetBuilder` needs them. */
function findSearchNoteIds(state: EditorState, from: number, to: number) {
    const found: NoteIdRange[] = [];

    for (const match of state.sliceDoc(from, to).matchAll(NOTE_ID_COMPARISON)) {
        const start = from + match.index + match[1].length;

        found.push({ from: start, to: start + match[2].length, noteId: match[2] });
    }

    return found;
}

/** A Markdown note link, `[[noteId]]`, as Trilium writes one. */
const WIKILINK = /\[\[([A-Za-z0-9_]+)\]\]/g;

/**
 * The `[[noteId]]` links of a Markdown note, each drawn whole, brackets included. A link in a code
 * block or a code span is code, so it is left as text.
 */
export function findWikilinkNoteIds(state: EditorState, from: number, to: number) {
    const found: NoteIdRange[] = [];
    const tree = syntaxTree(state);

    for (const match of state.sliceDoc(from, to).matchAll(WIKILINK)) {
        const start = from + match.index;
        const innermost = tree.resolveInner(start, 1);
        let inCode = false;
        for (let node: typeof innermost | null = innermost; node && !inCode; node = node.parent) {
            inCode = node.name.includes("Code");
        }

        if (!inCode) {
            found.push({ from: start, to: start + match[0].length, noteId: match[1] });
        }
    }

    return found;
}

/**
 * Named beside the `--search-*` palette the Next themes define. The fallback mixes the chip out of
 * the text colour, so it holds up on a light and a dark background alike where nothing defines it.
 */
const noteChipTheme = EditorView.baseTheme({
    ".cm-note-chip": {
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25em",
        padding: "0 0.4em",
        borderRadius: "0.75em",
        background: "var(--search-chip-background-color, color-mix(in srgb, currentColor 12%, transparent))",
        color: "var(--search-chip-color, inherit)",
        whiteSpace: "nowrap",
        verticalAlign: "baseline"
    },
    ".cm-note-chip-icon": {
        opacity: "0.7"
    }
});
