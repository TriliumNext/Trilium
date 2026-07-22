// ck-find-result and ck-find-result_selected are the styles ck-editor
// uses for highlighting matches, use the same one on CodeMirror
// for consistency
import type Mark from "mark.js";
import { expandCollapsedAncestors } from "../services/collapsibles.js";
import utils from "../services/utils.js";
import type FindWidget from "./find.js";
import type { FindResult } from "./find.js";

const FIND_RESULT_SELECTED_CSS_CLASSNAME = "ck-find-result_selected";
const FIND_RESULT_CSS_CLASSNAME = "ck-find-result";
// Muted highlight for the non-seed tokens of a multi-token search (jump-to-match). Styled in the
// FindWidget's style block. Deliberately distinct from FIND_RESULT_CSS_CLASSNAME so these marks are
// not counted as primary matches and Enter/F3 keeps cycling only the seed.
const FIND_RESULT_SECONDARY_CSS_CLASSNAME = "find-result-secondary";

export default class FindInHtml {

    private parent: FindWidget;
    private currentIndex: number;
    private $results: JQuery<HTMLElement> | null;
    private mark?: Mark;

    constructor(parent: FindWidget) {
        this.parent = parent;
        this.currentIndex = 0;
        this.$results = null;
    }

    async performFind(searchTerm: string, matchCase: boolean, wholeWord: boolean) {
        const $content = await this.parent?.noteContext?.getContentElement();
        if (!$content || !$content.length) {
            return Promise.resolve({ totalFound: 0, currentFound: 0 });
        }

        if (!this.mark) {
            this.mark = new (await import("mark.js")).default($content[0]);
        }

        const wholeWordChar = wholeWord ? "\\b" : "";
        const regExp = new RegExp(wholeWordChar + utils.escapeRegExp(searchTerm) + wholeWordChar, matchCase ? "g" : "gi");

        return new Promise<FindResult>((res) => {
            this.mark!.unmark({
                done: () => {
                    this.mark!.markRegExp(regExp, {
                        element: "span",
                        className: FIND_RESULT_CSS_CLASSNAME,
                        done: async () => {
                            this.$results = $content.find(`.${FIND_RESULT_CSS_CLASSNAME}`);
                            const scrollingContainer = $content[0].closest('.scrolling-container');
                            const containerTop = scrollingContainer?.getBoundingClientRect().top ?? 0;
                            const closestIndex = this.$results.toArray().findIndex(el => el.getBoundingClientRect().top >= containerTop);
                            this.currentIndex = closestIndex >= 0 ? closestIndex : 0;

                            await this.jumpTo();

                            res({
                                totalFound: this.$results.length,
                                currentFound: this.$results.length > 0 ? this.currentIndex + 1 : 0
                            });
                        }
                    });
                }
            });
        });
    }

    async findNext(direction: -1 | 1, currentFound: number, nextFound: number) {
        if (this.$results?.length) {
            this.currentIndex += direction;

            if (this.currentIndex < 0) {
                this.currentIndex = this.$results.length - 1;
            }

            if (this.currentIndex > this.$results.length - 1) {
                this.currentIndex = 0;
            }

            await this.jumpTo();
        }
    }

    /**
     * Highlights additional (non-seed) search tokens with a muted secondary style, so opening a
     * multi-token search result shows every matched term at a glance while Enter/F3 keep cycling
     * only the primary (seed) matches counted by {@link performFind}.
     *
     * Only this read-only HTML handler supports the multi-token pass; the editable CKEditor and
     * CodeMirror handlers stay seed-only (their find engines highlight a single term). These marks
     * reuse the same mark.js instance created by {@link performFind}, so {@link findBoxClosed}'s
     * `unmark()` — and any subsequent manual re-search's `unmark()` — clears them too. mark.js
     * escapes each keyword internally, so regex metacharacters in a token can't inject.
     */
    async highlightExtraTokens(tokens: string[]) {
        const mark = this.mark;
        const cleaned = tokens.filter((token) => token.length > 0);
        if (!mark || cleaned.length === 0) {
            return;
        }

        return new Promise<void>((res) => {
            mark.mark(cleaned, {
                element: "span",
                className: FIND_RESULT_SECONDARY_CSS_CLASSNAME,
                separateWordSearch: false,
                done: () => res()
            });
        });
    }

    async findBoxClosed(totalFound: number, currentFound: number) {
        // A single unmark() clears both the primary (seed) marks and any secondary marks from
        // highlightExtraTokens, since they share this mark.js instance.
        this.mark?.unmark();
    }

    async jumpTo() {
        if (this.$results?.length) {
            const $current = this.$results.eq(this.currentIndex);
            this.$results.removeClass(FIND_RESULT_SELECTED_CSS_CLASSNAME);
            // Reveal the match if it's hidden inside a closed <details> (e.g. a collapsed
            // CKEditor collapsible block) before scrolling to it, otherwise scrollIntoView is a
            // no-op for content that isn't actually visible (#10616).
            expandCollapsedAncestors($current[0]);
            $current[0].scrollIntoView({ block: 'center', inline: 'center'});
            $current.addClass(FIND_RESULT_SELECTED_CSS_CLASSNAME);
        }
    }
}
