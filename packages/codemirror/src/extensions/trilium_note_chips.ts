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

/**
 * Draws the note ids in a search query as chips carrying the note's icon and title.
 *
 * A query stores the id, so it goes on matching a note that has since been renamed — which leaves
 * the field showing a string that says nothing about which note it is. The chip is presentation
 * over that id and never changes it: the text behind a chip is what the query is run with.
 *
 * Each chip is atomic, so the caret steps over it and a backspace beside it takes the whole id
 * rather than a character of it. To point a clause at another note, delete the chip and mention
 * one again.
 *
 * The decorations live in a view plugin rather than a {@link StateField}, unlike
 * `triliumSearchHighlighter`: a note that has to be fetched arrives after the update that asked
 * for it, and the plugin holds the view it dispatches the answer to.
 */
export function triliumNoteChips(resolve: NoteChipResolver): Extension {
    const plugin = ViewPlugin.define(
        (view) => new NoteChipsPlugin(view, resolve),
        {
            decorations: (value) => value.decorations,
            provide: (plugin) => EditorView.atomicRanges.of(
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

    constructor(private readonly view: EditorView, private readonly resolve: NoteChipResolver) {
        this.decorations = this.build(view.state);
    }

    update(update: ViewUpdate) {
        const arrived = update.transactions.some(
            (tr) => tr.effects.some((effect) => effect.is(noteChipResolved))
        );

        if (update.docChanged || arrived) {
            this.decorations = this.build(update.state);
        }
    }

    private build(state: EditorState): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();

        for (const { from, to, noteId } of findNoteIds(state.doc.toString())) {
            const chip = this.chipFor(noteId);

            if (chip) {
                builder.add(from, to, Decoration.replace({ widget: new NoteChipWidget(noteId, chip) }));
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
            this.resolved.set(noteId, answer);
            return answer;
        }

        this.pending.add(noteId);
        void answer
            .catch(() => null)
            .then((chip) => {
                this.pending.delete(noteId);
                this.resolved.set(noteId, chip);
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

/** The ranges holding a note id, left to right, as `RangeSetBuilder` needs them. */
function findNoteIds(text: string) {
    const found: { from: number; to: number; noteId: string }[] = [];

    for (const match of text.matchAll(NOTE_ID_COMPARISON)) {
        const from = match.index + match[1].length;

        found.push({ from, to: from + match[2].length, noteId: match[2] });
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
