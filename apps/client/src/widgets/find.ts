/**
 * (c) Antonio Tejada 2022
 * https://github.com/antoniotejada/Trilium-FindWidget
 */

import { t } from "../services/i18n.js";
import NoteContextAwareWidget from "./note_context_aware_widget.js";
import attributeService from "../services/attributes.js";
import FindInText from "./find_in_text.js";
import FindInCode from "./find_in_code.js";
import { isIMEComposing } from "../services/shortcuts.js";
import FindInHtml from "./find_in_html.js";
import type { EventData } from "../components/app_context.js";

const findWidgetDelayMillis = 200;
const waitForEnter = findWidgetDelayMillis < 0;

export interface FindResult {
    totalFound: number;
    currentFound: number;
}

// tabIndex=-1 on the checkbox labels is necessary, so when clicking on the label,
// the focusout handler is called with relatedTarget equal to the label instead
// of undefined. It's -1 instead of > 0, so they don't tabstop
const TPL = /*html*/`
<div class='find-replace-widget' style="contain: none; border-top: 1px solid var(--main-border-color);">
    <style>
        .find-widget-box, .replace-widget-box {
            padding: 2px 10px 2px 10px;
            align-items: center;
        }

        .find-widget-box > *, .replace-widget-box > *{
            margin-right: 15px;
        }

        .find-widget-box, .replace-widget-box {
            display: flex;
        }

        .find-widget-found-wrapper {
            justify-content: center;
            min-width: 60px;
            padding: 0 4px;
            font-size: .85em;
            text-align: center;
        }

        .find-widget-search-term-input-group, .replace-widget-replacetext-input {
            max-width: 350px;
        }

        .find-widget-spacer {
            flex-grow: 1;
        }
    </style>

    <div class="find-widget-box">
        <div class="input-group find-widget-search-term-input-group">
            <input type="text" class="form-control find-widget-search-term-input" placeholder="${t("find.find_placeholder")}">
            <button class="btn btn-outline-secondary bx bxs-chevron-up find-widget-previous-button" type="button"></button>
            <div class="find-widget-found-wrapper input-group-text">
                <span>
                    <span class="find-widget-current-found">0</span>
                    /
                    <span class="find-widget-total-found">0</span>
                <span>
            </div>
            <button class="btn btn-outline-secondary bx bxs-chevron-down find-widget-next-button" type="button"></button>
        </div>

        <div class="form-check">
            <label tabIndex="-1" class="form-check-label tn-checkbox">
                <input type="checkbox" class="form-check-input find-widget-case-sensitive-checkbox">
                ${t("find.case_sensitive")}
            </label>
        </div>

        <div class="form-check">
            <label tabIndex="-1" class="form-check-label tn-checkbox">
                <input type="checkbox" class="form-check-input find-widget-match-words-checkbox">
                ${t("find.match_words")}
            </label>
        </div>



        <div class="find-widget-spacer"></div>

        <div class="find-widget-close-button"><button class="icon-action bx bx-x"></button></div>
    </div>

    <div class="replace-widget-box" style='display: none'>
        <input type="text" class="form-control replace-widget-replacetext-input" placeholder="${t("find.replace_placeholder")}">
        <button class="btn btn-sm replace-widget-replaceall-button" type="button">${t("find.replace_all")}</button>
        <button class="btn btn-sm  replace-widget-replace-button" type="button">${t("find.replace")}</button>
    </div>
</div>`;

const SUPPORTED_NOTE_TYPES = ["text", "code", "render", "mindMap", "doc"];
export default class FindWidget extends NoteContextAwareWidget {

    private searchTerm: string | null;

    private textHandler: FindInText;
    private codeHandler: FindInCode;
    private htmlHandler: FindInHtml;
    private handler?: FindInText | FindInCode | FindInHtml;
    private timeoutId?: number | null;

    private $input!: JQuery<HTMLElement>;
    private $currentFound!: JQuery<HTMLElement>;
    private $totalFound!: JQuery<HTMLElement>;
    private $caseSensitiveCheckbox!: JQuery<HTMLElement>;
    private $matchWordsCheckbox!: JQuery<HTMLElement>;
    private $previousButton!: JQuery<HTMLElement>;
    private $nextButton!: JQuery<HTMLElement>;
    private $closeButton!: JQuery<HTMLElement>;
    private $replaceWidgetBox!: JQuery<HTMLElement>;
    private $replaceTextInput!: JQuery<HTMLElement>;
    private $replaceAllButton!: JQuery<HTMLElement>;
    private $replaceButton!: JQuery<HTMLElement>;

    constructor() {
        super();

        this.searchTerm = null;

        this.textHandler = new FindInText(this);
        this.codeHandler = new FindInCode(this);
        this.htmlHandler = new FindInHtml(this);
    }

    async noteSwitched() {
        await super.noteSwitched();

        await this.closeSearch();
    }

    doRender() {
        this.$widget = $(TPL);
        this.$widget.hide();
        this.$input = this.$widget.find(".find-widget-search-term-input");
        this.$currentFound = this.$widget.find(".find-widget-current-found");
        this.$totalFound = this.$widget.find(".find-widget-total-found");
        this.$caseSensitiveCheckbox = this.$widget.find(".find-widget-case-sensitive-checkbox");
        this.$caseSensitiveCheckbox.on("change", () => this.performFind());
        this.$matchWordsCheckbox = this.$widget.find(".find-widget-match-words-checkbox");
        this.$matchWordsCheckbox.on("change", () => this.performFind());
        this.$previousButton = this.$widget.find(".find-widget-previous-button");
        this.$previousButton.on("click", () => this.findNext(-1));
        this.$nextButton = this.$widget.find(".find-widget-next-button");
        this.$nextButton.on("click", () => this.findNext(1));
        this.$closeButton = this.$widget.find(".find-widget-close-button");
        this.$closeButton.on("click", () => this.closeSearch());

        this.$replaceWidgetBox = this.$widget.find(".replace-widget-box");
        this.$replaceTextInput = this.$widget.find(".replace-widget-replacetext-input");
        this.$replaceAllButton = this.$widget.find(".replace-widget-replaceall-button");
        this.$replaceAllButton.on("click", () => this.replaceAll());
        this.$replaceButton = this.$widget.find(".replace-widget-replace-button");
        this.$replaceButton.on("click", () => this.replace());

        this.$input.on("keydown", async (e) => {
            // Skip processing during IME composition
            if (isIMEComposing(e.originalEvent as KeyboardEvent)) {
                return;
            }
            
            if ((e.metaKey || e.ctrlKey) && (e.key === "F" || e.key === "f")) {
                // If ctrl+f is pressed when the findbox is shown, select the
                // whole input to find
                this.$input.select();
            } else if (e.key === "Enter" || e.key === "F3") {
                await this.findNext(e?.shiftKey ? -1 : 1);
                e.preventDefault();
                return false;
            }
        });

        this.$widget.on("keydown", async (e) => {
            if (e.key === "Escape") {
                await this.closeSearch();
            }
        });

        this.$input.on("input", () => this.startSearch());

        return this.$widget;
    }

    async findInTextEvent() {
        if (!this.isActiveNoteContext()) {
            return;
        }

        if (!SUPPORTED_NOTE_TYPES.includes(this.note?.type ?? "")) {
            return;
        }

        this.handler = await this.getHandler();

        const isReadOnly = await this.noteContext?.isReadOnly();

        let selectedText = "";
        if (this.note?.type === "code" && this.noteContext) {
            const codeEditor = await this.noteContext.getCodeEditor();
            selectedText = codeEditor.getSelectedText();
        } else {
            selectedText = window.getSelection()?.toString() || "";
        }
        this.$widget.show();
        this.$input.focus();
        if (["text", "code"].includes(this.note?.type ?? "") && !isReadOnly) {
            this.$replaceWidgetBox.show();
        } else {
            this.$replaceWidgetBox.hide();
        }

        const isAlreadyVisible = this.$widget.is(":visible");

        if (isAlreadyVisible) {
            if (selectedText) {
                this.$input.val(selectedText);
            }

            if (this.$input.val()) {
                await this.performFind();
            }

            this.$input.select();
        } else {
            this.$totalFound.text(0);
            this.$currentFound.text(0);
            this.$input.val(selectedText);

            if (selectedText) {
                this.$input.select();
                await this.performFind();
            }
        }
    }

    async readOnlyTemporarilyDisabledEvent({ noteContext }: EventData<"readOnlyTemporarilyDisabled">) {
        if (this.isNoteContext(noteContext.ntxId)) {
            await this.closeSearch();
        }
    }

    async getHandler() {
        switch (this.note?.type) {
            case "render":
                return this.htmlHandler;
            case "code":
                return this.codeHandler;
            case "text":
                const readOnly = await this.noteContext?.isReadOnly();
                return readOnly ? this.htmlHandler : this.textHandler;
            case "mindMap":
            case "doc":
                return this.htmlHandler;
            default:
                console.warn("FindWidget: Unsupported note type for find widget", this.note?.type);
        }
    }

    startSearch() {
        // XXX This should clear the previous search immediately in all cases
        //     (the search is stale when waitforenter but also while the
        //     delay is running for the non waitforenter case)
        if (!waitForEnter) {
            // Clear the previous timeout if any, it's ok if timeoutId is
            // null or undefined
            clearTimeout(this.timeoutId as unknown as NodeJS.Timeout); // TODO: Fix once client is separated from Node.js types.

            // Defer the search a few millis so the search doesn't start
            // immediately, as this can cause search word typing lag with
            // one or two-char searchwords and long notes
            // See https://github.com/antoniotejada/Trilium-FindWidget/issues/1
            this.timeoutId = setTimeout(async () => {
                this.timeoutId = null;
                await this.performFind();
            }, findWidgetDelayMillis) as unknown as number; // TODO: Fix once client is separated from Node.js types.
        }
    }

    /**
     * @param direction +1 for next, -1 for previous
     */
    async findNext(direction: 1 | -1) {
        if (this.$totalFound.text() == "?") {
            await this.performFind();
            return;
        }
        const searchTerm = this.$input.val();
        if (waitForEnter && this.searchTerm !== searchTerm) {
            await this.performFind();
        }
        const totalFound = parseInt(this.$totalFound.text());
        const currentFound = parseInt(this.$currentFound.text()) - 1;

        if (totalFound > 0) {
            let nextFound = currentFound + direction;
            // Wrap around
            if (nextFound > totalFound - 1) {
                nextFound = 0;
            } else if (nextFound < 0) {
                nextFound = totalFound - 1;
            }

            this.$currentFound.text(nextFound + 1);

            await this.handler?.findNext(direction, currentFound, nextFound);
        }
    }

    /** Perform the find and highlight the find results. */
    async performFind() {
        const searchTerm = String(this.$input.val());
        const matchCase = this.$caseSensitiveCheckbox.prop("checked");
        const wholeWord = this.$matchWordsCheckbox.prop("checked");

        if (!this.handler) {
            return;
        }
        const { totalFound, currentFound } = await this.handler.performFind(searchTerm, matchCase, wholeWord);

        this.$totalFound.text(totalFound);
        this.$currentFound.text(currentFound);

        this.searchTerm = searchTerm;
    }

    async closeSearch() {
        if (this.$widget.is(":visible")) {
            this.$widget.hide();

            // Restore any state, if there's a current occurrence clear markers
            // and scroll to and select the last occurrence
            const totalFound = parseInt(this.$totalFound.text());
            const currentFound = parseInt(this.$currentFound.text()) - 1;

            this.searchTerm = null;

            await this.handler?.findBoxClosed(totalFound, currentFound);
        }
    }

    async replace() {
        const replaceText = String(this.$replaceTextInput.val());
        if (this.handler && "replace" in this.handler) {
            await this.handler.replace(replaceText);
        }
    }

    async replaceAll() {
        const replaceText = String(this.$replaceTextInput.val());
        if (this.handler && "replace" in this.handler) {
            await this.handler.replaceAll(replaceText);
        }
    }

    isEnabled() {
        return super.isEnabled() && SUPPORTED_NOTE_TYPES.includes(this.note?.type ?? "");
    }

    async entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        if (this.noteId && loadResults.isNoteContentReloaded(this.noteId)) {
            this.$totalFound.text("?");
        } else if (loadResults.getAttributeRows().find((attr) => attr.type === "label"
                && (attr.name?.toLowerCase() ?? "").includes("readonly")
                && attributeService.isAffecting(attr, this.note))) {
            this.closeSearch();
        }
    }
}
