import { revealElement } from "../services/collapsible.js";
import {
    addHighlights, findRegExpRanges, findTermRanges, removeHighlights, scrollRangeIntoView
} from "../services/highlight_matches.js";
import utils from "../services/utils.js";
import type FindWidget from "./find.js";
import MergedFind, {
    type FindOptions, type FindTarget, getScrollingContainerTop, type HostFindTarget, toFindResult
} from "./merged_find";
import { watchEmbedFindTargets } from "./type_widgets/text/content_embed_tools";

// The content of an embed searches itself, and its title row is not searched.
const EMBED_EXCLUSION = [ ".include-note-wrapper", ".include-note-wrapper *" ];

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

    async performFind(searchTerm: string, matchCase: boolean, wholeWord: boolean) {
        const $content = await this.parent?.noteContext?.getContentElement();
        const content = $content?.[0];
        if (!content) {
            return toFindResult(0, null);
        }

        const find = this.getFind(content);
        const totalFound = await find.find(searchTerm, { matchCase, wholeWord });
        this.current = totalFound ? find.getStartMatch(getScrollingContainerTop(content)) : null;
        find.highlight(this.current);
        return toFindResult(totalFound, this.current);
    }

    async findNext(_direction: -1 | 1, _currentFound: number, nextFound: number) {
        this.current = nextFound;
        this.find?.highlight(nextFound);
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

    async findBoxClosed(_totalFound: number, _currentFound: number) {
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

        this.stopWatching ??= watchEmbedFindTargets(content, () => this.parent.invalidateResults());
        return this.find;
    }

}

/** Searches rendered content, which it cannot change, by highlighting the ranges of its matches. */
export class HtmlFindTarget implements FindTarget {

    protected matches: Range[] = [];
    /**
     * The ranges of the extra tokens. They are not matches, so Enter and F3 keep cycling only
     * {@link matches}.
     */
    private extraRanges: Range[] = [];
    private current: Range | null = null;

    /** Searches `root`, apart from the elements that the `exclude` selectors match. */
    constructor(readonly root: HTMLElement, private readonly exclude: string[] = []) {}

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
        addHighlights("find-result", this.matches);
        return this.matches.length;
    }

    highlight(index: number | null) {
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
        scrollRangeIntoView(this.current);
        addHighlights("find-result-selected", [ this.current ]);
    }

    getFirstMatchBelow(top: number) {
        const index = this.matches.findIndex((match) => match.getBoundingClientRect().top >= top);
        return index >= 0 ? index : null;
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
        return false;
    }

    /**
     * Highlights `tokens` with the muted secondary style, which the primary matches keep
     * cycling through. The tokens match literally, so a regex metacharacter cannot inject.
     */
    async highlightExtraTokens(tokens: string[]) {
        const ranges = findTermRanges(this.root, tokens, { exclude: this.exclude });
        this.extraRanges.push(...ranges);
        addHighlights("find-result-secondary", ranges);
    }

    /**
     * Removes the ranges of this target only, not those of the other targets in its root, such as
     * the embeds in a note.
     */
    private unmark() {
        removeHighlights("find-result", this.matches);
        removeHighlights("find-result-secondary", this.extraRanges);
        if (this.current) {
            removeHighlights("find-result-selected", [ this.current ]);
        }
        this.matches = [];
        this.extraRanges = [];
        this.current = null;
    }

}

/** Searches the rendered content of a note, whose embeds search their own content. */
export class HtmlNoteFindTarget extends HtmlFindTarget implements HostFindTarget {

    constructor(root: HTMLElement) {
        super(root, EMBED_EXCLUSION);
    }

    getEmbeds() {
        return [ ...this.root.querySelectorAll<HTMLElement>(".include-note") ]
            .filter((embed) => !embed.parentElement?.closest(".include-note"));
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
