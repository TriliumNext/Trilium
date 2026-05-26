import { EditorView, Decoration, MatchDecorator, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { foldState, unfoldEffect } from "@codemirror/language";
import { Range, RangeSet, StateEffect } from "@codemirror/state";

const searchMatchDecoration = Decoration.mark({ class: "cm-searchMatch" });
const activeMatchDecoration = Decoration.mark({ class: "cm-activeMatch" });

interface Match {
    from: number;
    to: number;
}

export class SearchHighlighter {
    matches: RangeSet<Decoration>;
    activeMatch?: Range<Decoration>;

    currentFound: number;
    totalFound: number;
    matcher?: MatchDecorator;
    searchRegexp?: RegExp;
    private parsedMatches: Match[];

    constructor(public view: EditorView) {
        this.parsedMatches = [];
        this.currentFound = 0;
        this.totalFound = 0;

        this.matches = RangeSet.empty;
    }

    searchFor(searchTerm: string, matchCase: boolean, wholeWord: boolean) {
        if (!searchTerm) {
            this.matches = RangeSet.empty;
            return;
        }

        // Escape the search term for use in RegExp
        const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wordBoundary = wholeWord ? "\\b" : "";
        const flags = matchCase ? "g" : "gi";
        const regex = new RegExp(`${wordBoundary}${escapedTerm}${wordBoundary}`, flags);

        this.matcher = new MatchDecorator({
            regexp: regex,
            decoration: searchMatchDecoration,
        });
        this.searchRegexp = regex;
        this.#updateSearchData(this.view);
        this.#scrollToMatchNearestSelection();
    }

    replaceActiveMatch(replacementText: string) {
        if (!this.parsedMatches.length || this.currentFound === 0) return;

        const matchIndex = this.currentFound - 1;
        const match = this.parsedMatches[matchIndex];

        this.view.dispatch({
            changes: { from: match.from, to: match.to, insert: replacementText }
        });
    }

    replaceAll(replacementText: string) {
        if (!this.parsedMatches.length) return;

        this.view.dispatch({
            changes: this.parsedMatches.map(change => ({
                from: change.from,
                to: change.to,
                insert: replacementText
            }))
        });
    }

    scrollToMatch(matchIndex: number) {
        if (this.parsedMatches.length <= matchIndex) {
            return;
        }

        const match = this.parsedMatches[matchIndex];
        this.currentFound = matchIndex + 1;
        this.activeMatch = activeMatchDecoration.range(match.from, match.to);

        // Check if the match is inside a folded region.
        const unfoldEffects: StateEffect<unknown>[] = [];
        if (this.view.state.field(foldState, false)) {
            const folded = this.view.state.field(foldState);
            const iter = folded.iter();
            while (iter.value) {
                if (match.from >= iter.from && match.to <= iter.to) {
                    unfoldEffects.push(unfoldEffect.of({ from: iter.from, to: iter.to }));
                }
                iter.next();
            }
        }

        this.view.dispatch({
            effects: [
                ...unfoldEffects,
                EditorView.scrollIntoView(match.from, { y: "center" })
            ],
            scrollIntoView: true
        });
    }

    update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
            this.#updateSearchData(update.view);
        }
    }

    destroy() {
        // Do nothing.
    }

    #updateSearchData(view: EditorView) {
        if (!this.matcher) {
            return;
        }

        // Create the match decorator which will automatically highlight matches in the document.
        this.matches = this.matcher.createDeco(view);

        // Manually search for matches in the current document in order to get the total number of matches.
        const parsedMatches: Match[] = [];
        const text = view.state.doc.toString();
        let match: RegExpExecArray | null | undefined;
        while ((match = this.searchRegexp?.exec(text))) {
            const from = match.index ?? 0;
            const to = from + match[0].length;

            parsedMatches.push({ from, to });
        }

        this.parsedMatches = parsedMatches;
        this.totalFound = this.parsedMatches.length;
    }

    #scrollToMatchNearestSelection() {
        const cursorPos = this.view.state.selection.main.head;
        let index = 0;
        for (const match of this.parsedMatches) {
            if (match.from >= cursorPos) {
                this.scrollToMatch(index);
                return;
            }

            index++;
        }
    }

    static deco = (v: SearchHighlighter) => v.matches;
}

export function createSearchHighlighter() {
    return ViewPlugin.fromClass(SearchHighlighter, {
        decorations: v => {
            if (v.activeMatch) {
                return v.matches.update({ add: [v.activeMatch] });
            } else {
                return v.matches;
            }
        }
    });
}

export const searchMatchHighlightTheme = EditorView.baseTheme({
    ".cm-searchMatch": {
        backgroundColor: "rgba(255, 255, 0, 0.4)",
        borderRadius: "2px"
    },
    ".cm-activeMatch": {
        backgroundColor: "rgba(255, 165, 0, 0.6)",
        borderRadius: "2px",
        outline: "2px solid orange"
    }
});
