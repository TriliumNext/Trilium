// ck-find-result and ck-find-result_selected are the styles ck-editor
// uses for highlighting matches, use the same one on CodeMirror
// for consistency
import type VanillaCodeMirror from "@triliumnext/codemirror";

import type FindWidget from "./find.js";
import type { CloseGuard, FindChecks, NavigationOptions, WriteOutcome } from "./find.js";
import type { FindCheck, FindOptions, FindTarget } from "./merged_find";
import { SCROLL_RAIL_MEASURE_EVENT, type ScrollRailTarget } from "./scroll_rail_markers";

const FIND_RESULT_SELECTED_CSS_CLASSNAME = "ck-find-result_selected";
const FIND_RESULT_CSS_CLASSNAME = "ck-find-result";

// TODO: Deduplicate.
interface Match {
    className: string;
    clear(): void;
    find(): {
        from: number;
        to: number;
    };
}

interface SearchParameters {
    searchTerm: string;
    matchCase: boolean;
    wholeWord: boolean;
}

/** "Search in note" in a code editor: a code note, the source view or the backend log. */
export default class FindInCode {

    private parent: FindWidget;
    private searchParameters: SearchParameters | null = null;
    /** The editor that the session searched, and the removal of the listener on its document. */
    private searched: { editor: VanillaCodeMirror; stopListening: () => void } | null = null;

    constructor(parent: FindWidget) {
        this.parent = parent;
    }

    async getCodeEditor() {
        return this.parent.noteContext?.getCodeEditor();
    }

    /** Searches, or returns `null` without a change once `check` fails after an await. */
    async performFind(
        searchTerm: string, matchCase: boolean, wholeWord: boolean, check: FindCheck = always
    ) {
        const codeEditor = await this.getCodeEditor();
        if (!check()) return null;
        if (!codeEditor) {
            return { totalFound: 0, currentFound: 0 };
        }

        this.searchParameters = { searchTerm, matchCase, wholeWord };
        this.listenTo(codeEditor);
        const { totalFound, currentFound } = await codeEditor.performFind(
            searchTerm, matchCase, wholeWord, true, check);
        if (!check()) return null;
        return { totalFound, currentFound };
    }

    /** Selects match `nextFound` once the editor is there, if `check` still holds. */
    async findNext(
        direction: number, currentFound: number, nextFound: number, options?: NavigationOptions
    ) {
        const codeEditor = await this.getCodeEditor();
        if (!codeEditor || !(options?.check ?? always)()) {
            return false;
        }

        void codeEditor.findNext(direction, currentFound, nextFound);
        return true;
    }

    /** Removes the matches and the listener, then focuses the editor while `guard` holds. */
    async findBoxClosed(guard: CloseGuard = always) {
        const codeEditor = this.searched?.editor ?? await this.getCodeEditor();
        this.stopListening();
        codeEditor?.cleanSearch();
        if (guard()) {
            codeEditor?.focus();
        }
    }

    async replace(replaceText: string, checks: FindChecks = NO_CHECKS) {
        const codeEditor = await this.getCodeEditor();
        if (!checks.start()) return DROPPED;
        await codeEditor?.replace(replaceText);
        return { isDropped: false, result: await this.rerunSearch(checks.show) };
    }

    async replaceAll(replaceText: string, checks: FindChecks = NO_CHECKS) {
        const codeEditor = await this.getCodeEditor();
        if (!checks.start()) return DROPPED;
        await codeEditor?.replaceAll(replaceText);
        return { isDropped: false, result: await this.rerunSearch(checks.show) };
    }

    /** Searches again after a write, whose matches the editor does not follow. */
    private async rerunSearch(check: FindCheck) {
        if (!this.searchParameters) return null;
        const { searchTerm, matchCase, wholeWord } = this.searchParameters;
        return this.performFind(searchTerm, matchCase, wholeWord, check);
    }

    /** Reports every change of the document of `codeEditor`, which makes the results stale. */
    private listenTo(codeEditor: VanillaCodeMirror) {
        if (this.searched?.editor === codeEditor) return;
        this.stopListening();
        const stopListening = codeEditor.addUpdateListener((update) => {
            if (update.docChanged) {
                this.parent.invalidateResults("content");
            }
        });
        this.searched = { editor: codeEditor, stopListening };
    }

    private stopListening() {
        this.searched?.stopListening();
        this.searched = null;
    }

}

const always = () => true;
const NO_CHECKS: FindChecks = { start: always, show: always };
const DROPPED: WriteOutcome = { isDropped: true, result: null };

/** Searches a code editor, such as the editor of a code note in an embed. */
export class CodeMirrorFindTarget implements FindTarget {

    private search: { term: string; options: FindOptions } | null = null;
    /** Removes the listener that reports the editor's height changes to the scroll rail. */
    private stopReportingHeights: (() => void) | null = null;

    constructor(private readonly view: VanillaCodeMirror) {}

    async find(term: string, options: FindOptions, check?: FindCheck) {
        this.search = { term, options };
        if (!this.isAlive()) {
            return 0;
        }

        this.reportHeights();
        const { totalFound } = await this.view.performFind(
            term, options.matchCase, options.wholeWord, false, check
        );
        return totalFound;
    }

    highlight(index: number | null) {
        if (!this.isAlive()) {
            return;
        }

        if (index === null) {
            this.view.clearActiveMatch();
        } else {
            void this.view.findNext(0, 0, index);
        }
    }

    getFirstMatchBelow(top: number) {
        const { view } = this;
        const index = view.getSearchMatches()
            .findIndex((match) => view.lineBlockAt(match.from).top + view.documentTop >= top);
        return index >= 0 ? index : null;
    }

    /**
     * The text of each match that the editor draws, else the top of its line in the content of the
     * editor's scroller, from the height map. Reads no geometry. The height map estimates the lines
     * that the editor has not measured, which it measures once it is in view.
     */
    getMatchTargets(): ScrollRailTarget[] {
        if (!this.isAlive()) return [];
        const { view } = this;
        const within = view.scrollDOM;
        const top = view.documentPadding.top;
        return view.getSearchMatches().map((match) => getDrawnRange(view, match) ?? {
            within, offset: view.lineBlockAt(match.from).top + top
        });
    }

    /** The matches of the search follow the edits of the document. */
    countMatches() {
        return this.isAlive() ? this.view.getSearchMatches().length : 0;
    }

    // `readOnly` blocks typing only, not the changes that `replace()` dispatches.
    canReplace() {
        return !this.view.state.readOnly;
    }

    async replace(index: number, text: string, check?: FindCheck) {
        if (this.isAlive() && this.canReplace()) {
            await this.view.findNext(0, 0, index);
            await this.view.replace(text);
        }
        return this.searchAgain(check);
    }

    async replaceAll(text: string, check?: FindCheck) {
        if (this.isAlive() && this.canReplace()) {
            await this.view.replaceAll(text);
        }
        return this.searchAgain(check);
    }

    /** Removes the matches at once. The match to select is taken before the search goes. */
    close(index: number | null) {
        this.stopReportingHeights?.();
        this.stopReportingHeights = null;
        if (!this.isAlive()) {
            return null;
        }

        const match = index === null ? undefined : this.view.getSearchMatches()[index];
        this.view.cleanSearch();
        if (!match) {
            return null;
        }

        return () => {
            this.view.dispatch({ selection: { anchor: match.from, head: match.to } });
            this.view.focus();
        };
    }

    watchContent(callback: () => void) {
        return this.view.addUpdateListener((update) => {
            if (update.docChanged) {
                callback();
            }
        });
    }

    /** Searches again after a replace, whose matches the editor does not follow. */
    private async searchAgain(check?: FindCheck) {
        return this.search ? this.find(this.search.term, this.search.options, check) : 0;
    }

    /**
     * Dispatches {@link SCROLL_RAIL_MEASURE_EVENT} at each change of the editor's heights until
     * `close()`, as the matches move then without a change of the note's size.
     */
    private reportHeights() {
        this.stopReportingHeights ??= this.view.addUpdateListener((update) => {
            if (update.heightChanged) {
                const event = new Event(SCROLL_RAIL_MEASURE_EVENT, { bubbles: true });
                this.view.dom.dispatchEvent(event);
            }
        });
    }

    /** Whether the editor is still in the page, which a destroyed one leaves. */
    private isAlive() {
        return this.view.dom.isConnected;
    }

}

/** The range of the text of `match` while the editor draws it, else `null`. */
function getDrawnRange(view: VanillaCodeMirror, { from, to }: { from: number; to: number }) {
    if (!view.visibleRanges.some((drawn) => drawn.from <= from && to <= drawn.to)) return null;
    const start = view.domAtPos(from);
    const end = view.domAtPos(to);
    const range = view.dom.ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range.collapsed ? null : range;
}
