// ck-find-result and ck-find-result_selected are the styles ck-editor
// uses for highlighting matches, use the same one on CodeMirror
// for consistency
import type VanillaCodeMirror from "@triliumnext/codemirror";

import utils from "../services/utils.js";
import type FindWidget from "./find.js";
import type { FindOptions, FindTarget } from "./merged_find";

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

export default class FindInCode {

    private parent: FindWidget;
    private searchParameters: SearchParameters | null = null;

    constructor(parent: FindWidget) {
        this.parent = parent;
    }

    async getCodeEditor() {
        return this.parent.noteContext?.getCodeEditor();
    }

    async performFind(searchTerm: string, matchCase: boolean, wholeWord: boolean) {
        const codeEditor = await this.getCodeEditor();
        if (!codeEditor) {
            return { totalFound: 0, currentFound: 0 };
        }

        this.searchParameters = {
            searchTerm,
            matchCase,
            wholeWord,
        };
        const { totalFound, currentFound } = await codeEditor.performFind(searchTerm, matchCase, wholeWord);
        return { totalFound, currentFound };
    }

    async findNext(direction: number, currentFound: number, nextFound: number) {
        const codeEditor = await this.getCodeEditor();
        if (!codeEditor) {
            return;
        }

        codeEditor.findNext(direction, currentFound, nextFound);
    }

    async findBoxClosed(totalFound: number, currentFound: number) {
        const codeEditor = await this.getCodeEditor();
        codeEditor?.cleanSearch();
        codeEditor?.focus();
    }

    async replace(replaceText: string) {
        const codeEditor = await this.getCodeEditor();
        await codeEditor?.replace(replaceText);
        this.rerunSearch();
    }

    async replaceAll(replaceText: string) {
        const codeEditor = await this.getCodeEditor();
        await codeEditor?.replaceAll(replaceText);
        this.rerunSearch();
    }

    private rerunSearch() {
        if (this.searchParameters) {
            this.performFind(
                this.searchParameters.searchTerm,
                this.searchParameters.matchCase,
                this.searchParameters.wholeWord);
        }
    }

}

/** Searches a code editor, such as the editor of a code note in an embed. */
export class CodeMirrorFindTarget implements FindTarget {

    private search: { term: string; options: FindOptions } | null = null;

    constructor(private readonly view: VanillaCodeMirror) {}

    async find(term: string, options: FindOptions) {
        this.search = { term, options };
        if (!this.isAlive()) {
            return 0;
        }

        const { totalFound } = await this.view.performFind(
            term, options.matchCase, options.wholeWord, false
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

    // `readOnly` blocks typing only, not the changes that `replace()` dispatches.
    canReplace() {
        return !this.view.state.readOnly;
    }

    async replace(index: number, text: string) {
        if (this.isAlive() && this.canReplace()) {
            await this.view.findNext(0, 0, index);
            await this.view.replace(text);
        }
        return this.searchAgain();
    }

    async replaceAll(text: string) {
        if (this.isAlive() && this.canReplace()) {
            await this.view.replaceAll(text);
        }
        return this.searchAgain();
    }

    close(index: number | null) {
        if (!this.isAlive()) {
            return false;
        }

        const match = index === null ? undefined : this.view.getSearchMatches()[index];
        this.view.cleanSearch();
        if (!match) {
            return false;
        }

        this.view.dispatch({ selection: { anchor: match.from, head: match.to } });
        this.view.focus();
        return true;
    }

    watchContent(callback: () => void) {
        return this.view.addUpdateListener((update) => {
            if (update.docChanged) {
                callback();
            }
        });
    }

    /** Searches again after a replace, whose matches the editor does not follow. */
    private async searchAgain() {
        return this.search ? this.find(this.search.term, this.search.options) : 0;
    }

    /** Whether the editor is still in the page, which a destroyed one leaves. */
    private isAlive() {
        return this.view.dom.isConnected;
    }

}
