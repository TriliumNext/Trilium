import type { CKTextEditor, FindResultType, ModelElement } from "@triliumnext/ckeditor5";

import type FindWidget from "./find.js";
import MergedFind, {
    type FindOptions, getScrollingContainerTop, type HostFindTarget, toFindResult
} from "./merged_find";
import { watchEmbedFindTargets } from "./type_widgets/text/content_embed_tools";

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

    async performFind(searchTerm: string, matchCase: boolean, wholeWord: boolean) {
        const textEditor = await this.getTextEditor();
        if (!textEditor) {
            return toFindResult(0, null);
        }

        const find = this.getFind(textEditor);
        const totalFound = await find.find(searchTerm, { matchCase, wholeWord });
        this.current = totalFound
            ? find.getStartMatch(getScrollingContainerTop(textEditor.sourceElement))
            : null;
        find.highlight(this.current);
        return toFindResult(totalFound, this.current);
    }

    async findNext(_direction: number, _currentFound: number, nextFound: number) {
        this.current = nextFound;
        this.find?.highlight(nextFound);
    }

    /** Whether "Replace" replaces the current match, which a match in read-only content is not. */
    canReplace() {
        return this.current !== null && !!this.find?.canReplace(this.current);
    }

    async replace(replaceText: string) {
        const { find, current } = this;
        if (!find || current === null) {
            return;
        }

        const totalFound = await find.replace(current, replaceText);
        // The match after the replaced one takes its number.
        this.current = totalFound ? current % totalFound : null;
        find.highlight(this.current);
        return toFindResult(totalFound, this.current);
    }

    async replaceAll(replaceText: string) {
        const { find } = this;
        if (!find) {
            return;
        }

        const totalFound = await find.replaceAll(replaceText);
        this.current = totalFound ? Math.min(this.current ?? 0, totalFound - 1) : null;
        find.highlight(this.current);
        return toFindResult(totalFound, this.current);
    }

    async findBoxClosed(_totalFound: number, _currentFound: number) {
        this.stopWatching?.();
        this.stopWatching = null;
        const isFocused = this.find?.close(this.current) ?? false;
        this.current = null;
        if (!isFocused) {
            (await this.getTextEditor())?.focus();
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
            const invalidate = () => this.parent.invalidateResults();
            const stopWatchingEmbeds = watchEmbedFindTargets(root, invalidate);
            const stopWatchingText = this.find.watchContent(invalidate);
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

    constructor(readonly editor: CKTextEditor) {}

    async find(term: string, { matchCase, wholeWord }: FindOptions) {
        const finder = this.getFinder();
        this.results = [];
        finder?.stop();
        if (!finder || !term) {
            return 0;
        }

        const { results } = this.editor.execute("find", term, { matchCase, wholeWords: wholeWord });
        // `find` highlights its first match, and `MergedFind` picks the current one instead.
        if (finder.state) {
            finder.state.highlightedResult = null;
        }
        this.results = sortByPosition([ ...results ]);
        return this.results.length;
    }

    highlight(index: number | null) {
        const state = this.getFinder()?.state;
        if (state) {
            state.highlightedResult = index === null ? null : this.results[index] ?? null;
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
        return this.readResults();
    }

    async replaceAll(text: string) {
        const state = this.getFinder()?.state;
        if (state) {
            this.editor.execute("replaceAll", text, state.results);
        }
        return this.readResults();
    }

    close(index: number | null) {
        const range = index === null ? undefined : this.results[index]?.marker?.getRange();
        this.getFinder()?.stop();
        this.results = [];
        if (!range) {
            return false;
        }

        this.editor.model.change((writer) => writer.setSelection(range));
        this.editor.editing.view.scrollToTheSelection();
        this.editor.focus();
        return true;
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

    /** Takes the matches that the find commands left, as a replace removes the ones it replaced. */
    private readResults() {
        const state = this.getFinder()?.state;
        this.results = state ? sortByPosition([ ...state.results ]) : [];
        return this.results.length;
    }

    /** The find plugin of the editor, or `null` once the editor is destroyed. */
    private getFinder() {
        return this.isAlive() ? this.editor.plugins.get("FindAndReplaceEditing") : null;
    }

    private isAlive() {
        return this.editor.state !== "destroyed";
    }

}

function sortByPosition(results: FindResultType[]) {
    return results.sort((first, second) => {
        const start = first.marker?.getStart();
        const otherStart = second.marker?.getStart();
        return start && otherStart ? POSITION_ORDER[start.compareWith(otherStart)] : 0;
    });
}

const POSITION_ORDER = { before: -1, same: 0, after: 1, different: 0 } as const;
