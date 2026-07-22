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

    async findBoxClosed(totalFound: number, currentFound: number) {
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
