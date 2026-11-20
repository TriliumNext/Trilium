import { revealElement } from "../services/bookmark_jump.js";
import {
    addHighlights, findRegExpRanges, findTermRanges, removeHighlights, scrollRangeIntoView,
    WindowedHighlight
} from "../services/highlight_matches.js";
import utils from "../services/utils.js";
import type FindWidget from "./find.js";
import type { CloseGuard } from "./find.js";
import MergedFind, {
    type FindCheck, type FindOptions, type FindTarget, getScrollingContainerTop,
    type HighlightOptions, type HostFindTarget, toFindResult
} from "./merged_find";
import { watchEmbedFindTargets } from "./type_widgets/text/content_embed_tools";

// The content of an embed searches itself, and its title row is not searched.
const EMBED_EXCLUSION = [ ".include-note-wrapper" ];

/** "Search in note" in the rendered content of a note, such as a read-only text note. */
export default class FindInHtml {

    private parent: FindWidget;
    private target: HtmlNoteFindTarget | null = null;
    private find: MergedFind | null = null;
    private current: number | null = null;
    private stopWatching: (() => void) | null = null;

    constructor(parent: FindWidget) {
        this.parent = parent;
    }

    /** Searches, or returns `null` without a change once `check` fails after an await. */
    async performFind(
        searchTerm: string, matchCase: boolean, wholeWord: boolean, check: FindCheck = () => true
    ) {
        const $content = await this.parent?.noteContext?.getContentElement();
        if (!check()) return null;
        const content = $content?.[0];
        if (!content) {
            return toFindResult(0, null);
        }

        const find = this.getFind(content);
        const totalFound = await find.find(searchTerm, { matchCase, wholeWord }, check);
        if (!check()) return null;
        this.current = totalFound ? find.getStartMatch(getScrollingContainerTop(content)) : null;
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

    /** The targets of the matches, for the scroll rail. */
    getMatchTargets(options: { isStale: boolean }) {
        return this.find?.getMatchTargets(options) ?? [];
    }

    /**
     * Highlights additional (non-seed) search tokens with a muted secondary style, so opening a
     * multi-token search result shows every matched term at a glance while Enter/F3 keep cycling
     * only the primary (seed) matches counted by {@link performFind}.
     *
     * Only this read-only HTML handler supports the multi-token pass; the editable CKEditor and
     * CodeMirror handlers stay seed-only, because their find engines highlight a single term.
     */
    async highlightExtraTokens(tokens: string[]) {
        await this.target?.highlightExtraTokens(tokens);
    }

    /** Removes the matches and the watchers. Rendered content takes no selection and no focus. */
    async findBoxClosed(_guard?: CloseGuard) {
        this.stopWatching?.();
        this.stopWatching = null;
        this.find?.close(null);
        this.current = null;
    }

    /** The search of `content`, which follows the embeds that it holds. */
    private getFind(content: HTMLElement) {
        if (!this.find || this.target?.root !== content) {
            this.find?.close(null);
            this.stopWatching?.();
            this.stopWatching = null;
            this.target = new HtmlNoteFindTarget(content);
            this.find = new MergedFind(this.target);
        }

        this.stopWatching ??= watchEmbedFindTargets(content,
            (reason) => this.parent.invalidateResults(reason));
        return this.find;
    }

}

/** Searches rendered content, which it cannot change, by highlighting the ranges of its matches. */
export class HtmlFindTarget implements FindTarget {

    protected matches: Range[] = [];
    private current: Range | null = null;
    private readonly drawnMatches: WindowedHighlight;
    /**
     * The extra tokens, in the muted style. They are not matches, so Enter and F3 keep cycling
     * only {@link matches}.
     */
    private readonly drawnExtraTokens: WindowedHighlight;

    /** Searches `root`, apart from the elements that the `exclude` selectors match. */
    constructor(readonly root: HTMLElement, private readonly exclude: string[] = []) {
        this.drawnMatches = new WindowedHighlight("find-result", root);
        this.drawnExtraTokens = new WindowedHighlight("find-result-secondary", root);
    }

    async find(term: string, { matchCase, wholeWord }: FindOptions) {
        this.unmark();
        if (!term) {
            return 0;
        }

        const wholeWordChar = wholeWord ? "\\b" : "";
        const regExp = new RegExp(
            wholeWordChar + utils.escapeRegExp(term) + wholeWordChar,
            matchCase ? "g" : "gi"
        );
        this.matches = findRegExpRanges(this.root, regExp, { exclude: this.exclude });
        this.drawnMatches.add(this.matches);
        return this.matches.length;
    }

    highlight(index: number | null, options?: HighlightOptions) {
        if (this.current) {
            removeHighlights("find-result-selected", [ this.current ]);
        }
        this.current = index === null ? null : this.matches[index] ?? null;
        if (!this.current) {
            return;
        }

        // Reveal matches inside collapsed <details> and inactive tabs, like native find-in-page.
        // Must precede scrolling so the target is laid out first (#10616).
        const parent = this.current.startContainer.parentElement;
        if (parent) {
            revealElement(parent, this.root);
        }
        scrollRangeIntoView(this.current, options?.isInstant ? "instant" : undefined);
        addHighlights("find-result-selected", [ this.current ]);
    }

    getFirstMatchBelow(top: number) {
        const index = this.matches.findIndex((match) => match.getBoundingClientRect().top >= top);
        return index >= 0 ? index : null;
    }

    /** The ranges of the matches. One whose content was written again names nothing. */
    getMatchTargets() {
        return [ ...this.matches ];
    }

    countMatches() {
        return this.matches.length;
    }

    canReplace() {
        return false;
    }

    async replace() {
        return this.matches.length;
    }

    async replaceAll() {
        return this.matches.length;
    }

    close() {
        this.unmark();
        return null;
    }

    /**
     * Highlights `tokens` with the muted secondary style, which the primary matches keep
     * cycling through. The tokens match literally, so a regex metacharacter cannot inject.
     */
    async highlightExtraTokens(tokens: string[]) {
        this.drawnExtraTokens.add(findTermRanges(this.root, tokens, { exclude: this.exclude }));
    }

    /**
     * Removes the ranges of this target only, not those of the other targets in its root, such as
     * the embeds in a note.
     */
    private unmark() {
        this.drawnMatches.clear();
        this.drawnExtraTokens.clear();
        if (this.current) {
            removeHighlights("find-result-selected", [ this.current ]);
        }
        this.matches = [];
        this.current = null;
    }

}

/**
 * Searches the rendered content of a note, or of an embed box, whose embeds search their own
 * content.
 */
export class HtmlNoteFindTarget extends HtmlFindTarget implements HostFindTarget {

    constructor(root: HTMLElement) {
        super(root, EMBED_EXCLUSION);
    }

    /** The embeds in the content that no other embed in it holds. */
    getEmbeds() {
        return [ ...this.root.querySelectorAll<HTMLElement>(".include-note") ].filter((embed) => {
            const outer = embed.parentElement?.closest(".include-note");
            return !outer || !this.root.contains(outer);
        });
    }

    countMatchesBefore(embed: HTMLElement) {
        return this.matches.filter(
            (match) => embed.compareDocumentPosition(match.startContainer) & Node.DOCUMENT_POSITION_PRECEDING
        ).length;
    }

    revealEmbed(embed: HTMLElement | null) {
        if (embed) {
            revealElement(embed, this.root);
        }
    }
}
