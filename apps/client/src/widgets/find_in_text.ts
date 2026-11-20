import type { CKTextEditor, FindResultType, ModelElement } from "@triliumnext/ckeditor5";

import { scrollRangeIntoView } from "../services/highlight_matches";
import type FindWidget from "./find.js";
import type { CloseGuard, FindChecks, WriteOutcome } from "./find.js";
import MergedFind, {
    type FindCheck, type FindOptions, getScrollingContainerTop, type HighlightOptions,
    type HostFindTarget, toFindResult
} from "./merged_find";
import type { ScrollRailTarget } from "./scroll_rail_markers";
import { watchEmbedFindTargets } from "./type_widgets/text/content_embed_tools";
import { EDITOR_ROOT_SELECTOR } from "./type_widgets/text/nested_editor";

/** "Search in note" in an editable text note, with the content of its embeds. */
export default class FindInText {

    private parent: FindWidget;
    private target: TextEditorFindTarget | null = null;
    private find: MergedFind | null = null;
    private current: number | null = null;
    private stopWatching: (() => void) | null = null;

    constructor(parent: FindWidget) {
        this.parent = parent;
    }

    async getTextEditor() {
        return this.parent?.noteContext?.getTextEditor();
    }

    /** Searches, or returns `null` without a change once `check` fails after an await. */
    async performFind(
        searchTerm: string, matchCase: boolean, wholeWord: boolean, check: FindCheck = always
    ) {
        const textEditor = await this.getTextEditor();
        if (!check()) return null;
        if (!textEditor) {
            return toFindResult(0, null);
        }

        const find = this.getFind(textEditor);
        const totalFound = await find.find(searchTerm, { matchCase, wholeWord }, check);
        if (!check()) return null;
        this.current = totalFound
            ? find.getStartMatch(getScrollingContainerTop(textEditor.sourceElement))
            : null;
        find.highlight(this.current);
        return toFindResult(totalFound, this.current);
    }

    /** Makes match `nextFound` the current one. Returns whether it did. */
    async findNext(
        _direction: number, _currentFound: number, nextFound: number, options?: HighlightOptions
    ) {
        this.current = nextFound;
        this.find?.highlight(nextFound, options);
        return true;
    }

    /** Whether "Replace" replaces the current match, which a match in read-only content is not. */
    canReplace() {
        return this.current !== null && !!this.find?.canReplace(this.current);
    }

    /** The targets of the matches, for the scroll rail. */
    getMatchTargets(options: { isStale: boolean }) {
        return this.find?.getMatchTargets(options) ?? [];
    }

    async replace(replaceText: string, checks: FindChecks = NO_CHECKS): Promise<WriteOutcome> {
        const { find, current } = this;
        if (!find || current === null) {
            return { isDropped: false, result: null };
        }
        if (!checks.start()) return DROPPED;

        const totalFound = await find.replace(current, replaceText, checks.show);
        // The match after the replaced one takes its number.
        this.current = totalFound ? current % totalFound : null;
        if (!checks.show()) return { isDropped: false, result: null };
        find.highlight(this.current);
        return { isDropped: false, result: toFindResult(totalFound, this.current) };
    }

    async replaceAll(replaceText: string, checks: FindChecks = NO_CHECKS): Promise<WriteOutcome> {
        const { find } = this;
        if (!find) {
            return { isDropped: false, result: null };
        }
        if (!checks.start()) return DROPPED;

        const totalFound = await find.replaceAll(replaceText, checks.show);
        this.current = totalFound ? Math.min(this.current ?? 0, totalFound - 1) : null;
        if (!checks.show()) return { isDropped: false, result: null };
        find.highlight(this.current);
        return { isDropped: false, result: toFindResult(totalFound, this.current) };
    }

    /**
     * Removes the matches and the watchers at once. While `guard` holds, selects the current match
     * and focuses it, else focuses the editor.
     */
    async findBoxClosed(guard: CloseGuard = always) {
        this.stopWatching?.();
        this.stopWatching = null;
        const select = this.find?.close(this.current) ?? null;
        this.current = null;
        const textEditor = await this.getTextEditor();
        if (!guard()) return;
        if (select) {
            select();
        } else {
            textEditor?.focus();
        }
    }

    /** The search of `textEditor`, which follows the embeds that it holds. */
    private getFind(textEditor: CKTextEditor) {
        if (!this.find || this.target?.editor !== textEditor) {
            this.find?.close(null);
            this.stopWatching?.();
            this.stopWatching = null;
            this.target = new TextEditorFindTarget(textEditor);
            this.find = new MergedFind(this.target);
        }

        const root = textEditor.editing.view.getDomRoot();
        if (!this.stopWatching && root) {
            const stopWatchingEmbeds = watchEmbedFindTargets(root,
                (reason) => this.parent.invalidateResults(reason));
            const stopWatchingText = this.find.watchContent(
                () => this.parent.invalidateResults("content")
            );
            this.stopWatching = () => {
                stopWatchingEmbeds();
                stopWatchingText();
            };
        }
        return this.find;
    }

}

/** Searches a text editor with its find and replace commands. */
export class TextEditorFindTarget implements HostFindTarget {

    /** The matches, sorted by position: the find commands keep them in no particular order. */
    private results: FindResultType[] = [];
    private embeds = new Map<HTMLElement, ModelElement>();
    /** The match that this target made the current one. */
    private highlighted: FindResultType | null = null;
    /** Puts back the current match when the find plugin moves it on an edit. */
    private readonly keepHighlight = () => {
        const state = this.getFinder()?.state;
        if (!state || state.highlightedResult === this.highlighted) return;
        state.highlightedResult = this.highlighted && this.isInDocument(this.highlighted)
            ? this.highlighted
            : null;
    };

    constructor(readonly editor: CKTextEditor) {}

    /** Searches with the find plugin, whose results then follow the edits of the note. */
    async find(term: string, { matchCase, wholeWord }: FindOptions) {
        const finder = this.getFinder();
        this.stopFinder();
        if (!finder || !term) {
            return 0;
        }

        const results = finder.find(term, { matchCase, wholeWords: wholeWord });
        // `find` highlights its first match, and `MergedFind` picks the current one instead.
        if (finder.state) {
            finder.state.highlightedResult = null;
            finder.state.on("change:highlightedResult", this.keepHighlight);
        }
        this.results = sortByPosition([ ...results ]);
        return this.results.length;
    }

    highlight(index: number | null, options?: HighlightOptions) {
        const state = this.getFinder()?.state;
        if (!state) return;
        const result = index === null ? null : this.results[index] ?? null;
        this.highlighted = result;
        state.highlightedResult = result;
        // Setting the result reveals its block at once, so its range can be scrolled to.
        const range = result && options?.isInstant ? this.getDomRange(result) : null;
        if (range) {
            scrollRangeIntoView(range, "instant");
        }
    }

    getFirstMatchBelow(top: number) {
        const { mapper, view } = this.editor.editing;
        const index = this.results.findIndex((result) => {
            const range = result.marker?.getRange();
            const domRange = range && view.domConverter.viewRangeToDom(mapper.toViewRange(range));
            return !!domRange && domRange.getBoundingClientRect().top >= top;
        });
        return index >= 0 ? index : null;
    }

    /**
     * The first highlight span of each match, from one query of the editor's root. While the
     * results are stale, the spans that the editor shows now, as an edit gives its paragraph new
     * matches.
     */
    getMatchTargets({ isStale }: { isStale: boolean }): ScrollRailTarget[] {
        const root = this.isAlive() ? this.editor.editing.view.getDomRoot() : null;
        if (!root) return isStale ? [] : this.results.map(() => null);

        const spans = new Map<string, HTMLElement>();
        for (const span of root.querySelectorAll<HTMLElement>(
            "span.ck-find-result[data-find-result]"
        )) {
            // The spans of a nested editor belong to the target of its embed. Table cells and
            // captions are nested editables of this editor.
            const id = span.dataset.findResult;
            if (id && !spans.has(id) && span.closest(EDITOR_ROOT_SELECTOR) === root) {
                spans.set(id, span);
            }
        }
        if (isStale) {
            return [ ...spans.values() ];
        }
        // A span names its result by the part of the marker name after `findResult:`.
        return this.results.map(
            (result) => spans.get(result.marker?.name.split(":")[1] ?? "") ?? null
        );
    }

    /** Takes the live results of the find commands, which follow edits, sorted again. */
    countMatches() {
        const state = this.getFinder()?.state;
        this.results = state
            ? sortByPosition([ ...state.results ].filter((result) => this.isInDocument(result)))
            : [];
        return this.results.length;
    }

    getSelectedMatch() {
        const selection = this.editor.model.document.selection;
        const start = selection.getFirstPosition();
        if (selection.isCollapsed || !start) {
            return null;
        }

        const index = this.results.findIndex(
            (result) => !result.marker?.getStart().isBefore(start)
        );
        return index >= 0 ? index : null;
    }

    canReplace(index: number) {
        const result = this.results[index];
        const { plugins } = this.editor;
        return !!result && (
            !plugins.has("FindInLinkWidgets") || plugins.get("FindInLinkWidgets").canReplace(result)
        );
    }

    async replace(index: number, text: string) {
        const result = this.results[index];
        if (result) {
            this.editor.execute("replace", text, result);
        }
        return this.countMatches();
    }

    async replaceAll(text: string) {
        const state = this.getFinder()?.state;
        if (state) {
            this.editor.execute("replaceAll", text, state.results);
        }
        return this.countMatches();
    }

    /**
     * Stops the find at once. The range of match `index` is taken first, while its marker still
     * exists, since stopping the find removes every find marker.
     */
    close(index: number | null) {
        const result = index === null ? undefined : this.results[index];
        const range = result && this.isInDocument(result) ? result.marker?.getRange() : null;
        this.stopFinder();
        if (!range) {
            return null;
        }

        return () => {
            this.editor.model.change((writer) => writer.setSelection(range));
            this.editor.editing.view.scrollToTheSelection();
            this.editor.focus();
        };
    }

    getEmbeds() {
        this.embeds.clear();
        if (!this.isAlive()) {
            return [];
        }

        const { model, editing } = this.editor;
        for (const root of model.document.getRoots()) {
            for (const item of model.createRangeIn(root).getItems()) {
                if (!item.is("element", "contentEmbed")) continue;

                const viewElement = editing.mapper.toViewElement(item);
                const embed = viewElement && editing.view.domConverter.mapViewToDom(viewElement);
                if (embed instanceof HTMLElement) {
                    this.embeds.set(embed, item);
                }
            }
        }
        return [ ...this.embeds.keys() ];
    }

    countMatchesBefore(embed: HTMLElement) {
        const element = this.embeds.get(embed);
        if (!element) {
            return 0;
        }

        const contentStart = this.editor.model.createPositionAt(element, 0);
        const index = this.results.findIndex(
            (result) => !result.marker?.getStart().isBefore(contentStart)
        );
        return index >= 0 ? index : this.results.length;
    }

    revealEmbed(embed: HTMLElement | null) {
        const element = embed ? this.embeds.get(embed) : undefined;
        if (this.isAlive() && this.editor.plugins.has("FindReveal")) {
            this.editor.plugins.get("FindReveal")
                .show(element ? this.editor.model.createPositionAt(element, 0) : null);
        }
    }

    watchContent(callback: () => void) {
        const modelDocument = this.editor.model.document;
        modelDocument.on("change:data", callback);
        return () => modelDocument.off("change:data", callback);
    }

    /** The DOM range of `result` in the editing view, or `null` once its text is gone. */
    private getDomRange(result: FindResultType) {
        const { mapper, view } = this.editor.editing;
        const range = this.isInDocument(result) ? result.marker?.getRange() : null;
        return range ? view.domConverter.viewRangeToDom(mapper.toViewRange(range)) : null;
    }

    /**
     * Whether the marker of `result` still marks text of the note. Deleted text moves it to the
     * graveyard, and a marker removed from the model throws on `getRange()`.
     */
    private isInDocument(result: FindResultType) {
        const marker = result.marker;
        return this.isAlive() && !!marker && this.editor.model.markers.has(marker.name)
            && marker.getRange().root.rootName !== "$graveyard";
    }

    /** Stops the find plugin, which removes every find marker, and forgets the matches. */
    private stopFinder() {
        const finder = this.getFinder();
        finder?.state?.off("change:highlightedResult", this.keepHighlight);
        this.highlighted = null;
        this.results = [];
        finder?.stop();
    }

    /** The find plugin of the editor, or `null` once the editor is destroyed. */
    private getFinder() {
        return this.isAlive() ? this.editor.plugins.get("FindAndReplaceEditing") : null;
    }

    private isAlive() {
        return this.editor.state !== "destroyed";
    }

}

const always = () => true;
const NO_CHECKS: FindChecks = { start: always, show: always };
const DROPPED: WriteOutcome = { isDropped: true, result: null };

function sortByPosition(results: FindResultType[]) {
    return results.sort((first, second) => {
        const start = first.marker?.getStart();
        const otherStart = second.marker?.getStart();
        return start && otherStart ? POSITION_ORDER[start.compareWith(otherStart)] : 0;
    });
}

const POSITION_ORDER = { before: -1, same: 0, after: 1, different: 0 } as const;
