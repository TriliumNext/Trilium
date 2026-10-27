// ck-find-result and ck-find-result_selected are the styles ck-editor
// uses for highlighting matches, use the same one on CodeMirror
// for consistency
import type Mark from "mark.js";

import { revealElement } from "../services/collapsible.js";
import utils from "../services/utils.js";
import type FindWidget from "./find.js";
import MergedFind, {
    type FindOptions, type FindTarget, getScrollingContainerTop, type HostFindTarget, toFindResult
} from "./merged_find";
import { watchEmbedFindTargets } from "./type_widgets/text/content_embed_tools";

const FIND_RESULT_SELECTED_CSS_CLASSNAME = "ck-find-result_selected";
const FIND_RESULT_CSS_CLASSNAME = "ck-find-result";
// Muted highlight for the non-seed tokens of a multi-token search (jump-to-match). Styled in the
// FindWidget's style block. Deliberately distinct from FIND_RESULT_CSS_CLASSNAME so these marks are
// not counted as primary matches and Enter/F3 keeps cycling only the seed.
const FIND_RESULT_SECONDARY_CSS_CLASSNAME = "find-result-secondary";
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

/** Searches rendered content, which it cannot change, by marking up its matches. */
export class HtmlFindTarget implements FindTarget {

    private mark: Mark | null = null;
    protected matches: HTMLElement[] = [];
    /** The elements that wrap the matches and the extra tokens, which `unmark()` removes. */
    private markElements: HTMLElement[] = [];
    private current: HTMLElement | null = null;

    /** Searches `root`, apart from the elements that the `exclude` selectors match. */
    constructor(readonly root: HTMLElement, private readonly exclude: string[] = []) {}

    async find(term: string, { matchCase, wholeWord }: FindOptions) {
        const mark = await this.getMark();
        this.unmark();
        if (!term) {
            return 0;
        }

        const wholeWordChar = wholeWord ? "\\b" : "";
        const regExp = new RegExp(
            wholeWordChar + utils.escapeRegExp(term) + wholeWordChar,
            matchCase ? "g" : "gi"
        );
        await new Promise<void>((done) => mark.markRegExp(regExp, {
            element: "span",
            className: FIND_RESULT_CSS_CLASSNAME,
            exclude: this.exclude,
            each: (element) => this.addMarkElement(element, this.matches),
            done: () => done()
        }));
        return this.matches.length;
    }

    highlight(index: number | null) {
        this.current?.classList.remove(FIND_RESULT_SELECTED_CSS_CLASSNAME);
        this.current = index === null ? null : this.matches[index] ?? null;
        if (!this.current) {
            return;
        }

        // Reveal matches inside collapsed <details> and inactive tabs, like native find-in-page.
        // Must precede scrollIntoView so the target is laid out first (#10616).
        revealElement(this.current, this.root);
        this.current.scrollIntoView({ block: "center", inline: "center" });
        this.current.classList.add(FIND_RESULT_SELECTED_CSS_CLASSNAME);
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
     * cycling through. mark.js escapes each keyword, so a regex metacharacter cannot inject.
     */
    async highlightExtraTokens(tokens: string[]) {
        const cleaned = tokens.filter((token) => token.length > 0);
        if (!this.mark || cleaned.length === 0) {
            return;
        }

        const { mark } = this;
        await new Promise<void>((done) => mark.mark(cleaned, {
            element: "span",
            className: FIND_RESULT_SECONDARY_CSS_CLASSNAME,
            separateWordSearch: false,
            exclude: this.exclude,
            each: (element) => this.addMarkElement(element),
            done: () => done()
        }));
    }

    private async getMark() {
        this.mark ??= new (await import("mark.js")).default(this.root);
        return this.mark;
    }

    private addMarkElement(element: Element, list?: HTMLElement[]) {
        if (element instanceof HTMLElement) {
            this.markElements.push(element);
            list?.push(element);
        }
    }

    /**
     * Unwraps the elements of this target only. `Mark.unmark()` would remove the marks of every
     * target in its root, such as those of the embeds in a note.
     */
    private unmark() {
        for (const element of this.markElements) {
            const parent = element.parentNode;
            if (!parent) continue;

            element.replaceWith(...element.childNodes);
            parent.normalize();
        }
        this.markElements = [];
        this.matches = [];
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
            (match) => embed.compareDocumentPosition(match) & Node.DOCUMENT_POSITION_PRECEDING
        ).length;
    }

    revealEmbed(embed: HTMLElement | null) {
        if (embed) {
            revealElement(embed, this.root);
        }
    }
}
