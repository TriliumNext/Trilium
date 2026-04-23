import type { FindAndReplaceState, FindCommandResult } from "@triliumnext/ckeditor5";
import type { FindResult } from "./find.js";
import type FindWidget from "./find.js";

export default class FindInText {

    private parent: FindWidget;
    private findResult?: FindCommandResult | null;
    private editingState?: FindAndReplaceState;

    constructor(parent: FindWidget) {
        this.parent = parent;
    }

    async getTextEditor() {
        return this.parent?.noteContext?.getTextEditor();
    }

    async performFind(searchTerm: string, matchCase: boolean, wholeWord: boolean): Promise<FindResult> {
        // Do this even if the searchTerm is empty so the markers are cleared and
        // the counters updated
        const textEditor = await this.getTextEditor();
        if (!textEditor) {
            return { currentFound: 0, totalFound: 0 };
        }

        const model = textEditor.model;
        let findResult: FindCommandResult | null = null;
        let totalFound = 0;
        let currentFound = -1;

        // Clear
        const findAndReplaceEditing = textEditor.plugins.get("FindAndReplaceEditing");
        findAndReplaceEditing.state?.clear(model);
        findAndReplaceEditing.stop();
        this.editingState = findAndReplaceEditing.state;
        if (searchTerm !== "") {
            // Parameters are callback/text, options.matchCase=false, options.wholeWords=false
            // See https://github.com/ckeditor/ckeditor5/blob/b95e2faf817262ac0e1e21993d9c0bde3f1be594/packages/ckeditor5-find-and-replace/src/findcommand.js#L44
            // XXX Need to use the callback version for regexp
            // searchTerm = escapeRegExp(searchTerm);
            // let re = new RegExp(searchTerm, 'gi');
            // let m = text.match(re);
            // totalFound = m ? m.length : 0;
            const options = { matchCase: matchCase, wholeWords: wholeWord };
            findResult = textEditor.execute("find", searchTerm, options);
            totalFound = findResult.results.length;
            const selection = model.document.selection;
            // If text is selected, highlight the corresponding result;
            // otherwise, highlight the first visible result in the scrolling container.
            if (!selection.isCollapsed) {
                const cursorPos = selection.getFirstPosition();
                for (let i = 0; i < findResult.results.length; ++i) {
                    const marker = findResult.results.get(i)?.marker;
                    const fromPos = marker?.getStart();
                    if (cursorPos && fromPos?.compareWith(cursorPos) !== "before") {
                        currentFound = i;
                        break;
                    }
                }
            } else {
                const editorEl = textEditor?.sourceElement;
                const findResultElement = editorEl?.querySelectorAll(".ck-find-result");
                const scrollingContainer = editorEl?.closest('.scrolling-container');
                const containerTop = scrollingContainer?.getBoundingClientRect().top ?? 0;
                const closestIndex = Array.from(findResultElement ?? []).findIndex((el: Element) => el.getBoundingClientRect().top >= containerTop);
                currentFound = closestIndex >= 0 ? closestIndex : 0;
            }
        }

        this.findResult = findResult;

        // Calculate curfound if not already, highlight it as
        // selected
        if (totalFound > 0) {
            currentFound = Math.max(0, currentFound);
            // XXX Do this accessing the private data?
            // See https://github.com/ckeditor/ckeditor5/blob/b95e2faf817262ac0e1e21993d9c0bde3f1be594/packages/ckeditor5-find-and-replace/src/findnextcommand.js
            for (let i = 0; i < currentFound; ++i) {
                textEditor?.execute("findNext");
            }
        }

        return {
            totalFound,
            currentFound: Math.min(currentFound + 1, totalFound)
        };
    }

    async findNext(direction: number, currentFound: number, nextFound: number) {
        const textEditor = await this.getTextEditor();

        // There are no parameters for findNext/findPrev
        // See https://github.com/ckeditor/ckeditor5/blob/b95e2faf817262ac0e1e21993d9c0bde3f1be594/packages/ckeditor5-find-and-replace/src/findnextcommand.js#L57
        // curFound wrap around above assumes findNext and
        // findPrevious wraparound, which is what they do
        if (direction > 0) {
            textEditor?.execute("findNext");
        } else {
            textEditor?.execute("findPrevious");
        }
    }

    async findBoxClosed(totalFound: number, currentFound: number) {
        const textEditor = await this.getTextEditor();
        if (!textEditor) {
            return;
        }

        if (totalFound > 0) {
            // Clear the markers and set the caret to the
            // current occurrence
            const model = textEditor.model;
            const range = this.findResult?.results?.get(currentFound)?.marker?.getRange();
            // From
            // https://github.com/ckeditor/ckeditor5/blob/b95e2faf817262ac0e1e21993d9c0bde3f1be594/packages/ckeditor5-find-and-replace/src/findandreplace.js#L92
            // XXX Roll our own since already done for codeEditor and
            //     will probably allow more refactoring?
            let findAndReplaceEditing = textEditor.plugins.get("FindAndReplaceEditing");
            findAndReplaceEditing.state?.clear(model);
            findAndReplaceEditing.stop();
            if (range) {
                model.change((writer) => {
                    writer.setSelection(range);
                });
            }
            textEditor.editing.view.scrollToTheSelection();
        }

        this.findResult = null;

        textEditor.focus();
    }

    async replace(replaceText: string) {
        if (this.editingState !== undefined && this.editingState.highlightedResult !== null) {
            const textEditor = await this.getTextEditor();
            textEditor?.execute("replace", replaceText, this.editingState.highlightedResult);
        }
    }

    async replaceAll(replaceText: string) {
        if (this.editingState !== undefined && this.editingState.results.length > 0) {
            const textEditor = await this.getTextEditor();
            textEditor?.execute("replaceAll", replaceText, this.editingState.results);
        }
    }
}
