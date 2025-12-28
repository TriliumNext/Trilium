/**
 * Table of contents widget
 * (c) Antonio Tejada 2022
 *
 * By design, there's no support for nonsensical or malformed constructs:
 * - headings inside elements (e.g. Trilium allows headings inside tables, but
 *   not inside lists)
 * - nested headings when using raw HTML <H2><H3></H3></H2>
 * - malformed headings when using raw HTML <H2></H3></H2><H3>
 * - etc.
 *
 * In those cases, the generated TOC may be incorrect, or the navigation may lead
 * to the wrong heading (although what "right" means in those cases is not
 * clear), but it won't crash.
 */
import { t } from "../services/i18n.js";
import attributeService from "../services/attributes.js";
import RightPanelWidget from "./right_panel_widget.js";
import options from "../services/options.js";
import OnClickButtonWidget from "./buttons/onclick_button.js";
import appContext, { type EventData } from "../components/app_context.js";
import katex from "../services/math.js";
import type FNote from "../entities/fnote.js";

const TPL = /*html*/`<div class="toc-widget">
    <style>
        .toc-widget {
            padding: 10px;
            contain: none;
            overflow: auto;
            position: relative;
            padding-inline-start:0px !important;
        }

        .toc ol {
            position: relative;
            overflow: hidden;
            padding-inline-start: 0px;
            transition: max-height 0.3s ease;
        }

        .toc li.collapsed + ol {
            display:none;
        }

        .toc li + ol:before {
            content: "";
            position: absolute;
            height: 100%;
            border-inline-start: 1px solid var(--main-border-color);
            z-index: 10;
        }

        .toc li {
            display: flex;
            position: relative;
            list-style: none;
            align-items: center;
            padding-inline-start: 7px;
            cursor: pointer;
            text-align: justify;
            word-wrap: break-word;
            hyphens: auto;
        }

        .toc > ol {
            --toc-depth-level: 1;
        }
        .toc > ol > ol {
            --toc-depth-level: 2;
        }
        .toc > ol > ol > ol {
            --toc-depth-level: 3;
        }
        .toc > ol > ol > ol > ol {
            --toc-depth-level: 4;
        }
        .toc > ol > ol > ol > ol > ol {
            --toc-depth-level: 5;
        }

        .toc > ol ol::before {
            inset-inline-start: calc((var(--toc-depth-level) - 2) * 20px + 14px);
        }

        .toc li {
            padding-inline-start: calc((var(--toc-depth-level) - 1) * 20px + 4px);
        }

        .toc li .collapse-button {
            display: flex;
            position: relative;
            width: 21px;
            height: 21px;
            flex-shrink: 0;
            align-items: center;
            justify-content: center;
            transition: transform 0.3s ease;
        }

        .toc li.collapsed .collapse-button {
            transform: rotate(-90deg);
        }

        .toc li .item-content {
            margin-inline-start: 25px;
            flex: 1;
        }

        .toc li .collapse-button + .item-content {
            margin-inline-start: 4px;
        }

        .toc li:hover {
            font-weight: bold;
        }
    </style>

    <span class="toc"></span>
</div>`;

interface Toc {
    $toc: JQuery<HTMLElement>;
    headingCount: number;
}

export default class TocWidget extends RightPanelWidget {

    private $toc!: JQuery<HTMLElement>;
    private tocLabelValue?: string | null;

    get widgetTitle() {
        return t("toc.table_of_contents");
    }

    get widgetButtons() {
        return [
            new OnClickButtonWidget()
                .icon("bx-cog")
                .title(t("toc.options"))
                .titlePlacement("left")
                .onClick(() => appContext.tabManager.openContextWithNote("_optionsTextNotes", { activate: true }))
                .class("icon-action"),
            new OnClickButtonWidget()
                .icon("bx-x")
                .titlePlacement("left")
                .onClick((widget) => widget.triggerCommand("closeToc"))
                .class("icon-action")
        ];
    }

    isEnabled() {
        if (!super.isEnabled() || !this.note) {
            return false;
        }

        const isHelpNote = this.note.type === "doc" && this.note.noteId.startsWith("_help");
        const isTextNote = this.note.type === "text";
        const isNoteSupported = isTextNote || isHelpNote;

        return isNoteSupported
            && !this.noteContext?.viewScope?.tocTemporarilyHidden
            && this.noteContext?.viewScope?.viewMode === "default";
    }

    async doRenderBody() {
        this.$body.empty().append($(TPL));
        this.$toc = this.$body.find(".toc");
    }

    async refreshWithNote(note: FNote) {

        this.toggleInt(!!this.noteContext?.viewScope?.tocPreviousVisible);

        this.tocLabelValue = note.getLabelValue("toc");

        if (this.tocLabelValue === "hide") {
            this.toggleInt(false);
            this.triggerCommand("reEvaluateRightPaneVisibility");
            return;
        }

        if (!this.note || !this.noteContext?.viewScope) {
            return;
        }

        // Check for type text unconditionally in case alwaysShowWidget is set
        if (this.note.type === "text") {
            const blob = await note.getBlob();
            if (blob) {
                const toc = await this.getToc(blob.content);
                this.#updateToc(toc);
            }
            return;
        }

        if (this.note.type === "doc") {
            /**
             * For document note types, we obtain the content directly from the DOM since it allows us to obtain processed data without
             * requesting data twice. However, when immediately navigating to a new note the new document is not yet attached to the hierarchy,
             * resulting in an empty TOC. The fix is to simply wait for it to pop up.
             * TODO: Use a better method that is not prone to unnecessary delays and race conditions.
             */
            setTimeout(async () => {
                const $contentEl = await this.noteContext?.getContentElement();
                if ($contentEl) {
                    const content = $contentEl.html();
                    const toc = await this.getToc(content);
                    this.#updateToc(toc);
                } else {
                    console.warn("Unable to get content element for doctype");
                }
            }, 250);
        }
    }

    #updateToc({ $toc, headingCount }: Toc) {
        this.$toc.empty();
        if ($toc) {
            this.$toc.append($toc);
        }

        const tocLabelValue = this.tocLabelValue;

        const visible = tocLabelValue === "" || tocLabelValue === "show" || headingCount >= (options.getInt("minTocHeadings") ?? 0);
        this.toggleInt(visible);
        if (this.noteContext?.viewScope) {
            this.noteContext.viewScope.tocPreviousVisible = visible;
        }

        this.triggerCommand("reEvaluateRightPaneVisibility");
    }

    /**
     * Rendering formulas in strings using katex
     *
     * @param html Note's html content
     * @returns The HTML content with mathematical formulas rendered by KaTeX.
     */
    async replaceMathTextWithKatax(html: string) {
        const mathTextRegex = /<span class="math-tex">\\\(([\s\S]*?)\\\)<\/span>/g;
        var matches = [...html.matchAll(mathTextRegex)];
        let modifiedText = html;

        if (matches.length > 0) {
            // Process all matches asynchronously
            for (const match of matches) {
                let latexCode = match[1];
                let rendered;

                try {
                    rendered = katex.renderToString(latexCode, {
                        throwOnError: false
                    });
                } catch (e) {
                    if (e instanceof ReferenceError && e.message.includes("katex is not defined")) {
                        // Load KaTeX if it is not already loaded
                        try {
                            rendered = katex.renderToString(latexCode, {
                                throwOnError: false
                            });
                        } catch (renderError) {
                            console.error("KaTeX rendering error after loading library:", renderError);
                            rendered = match[0]; // Fall back to original if error persists
                        }
                    } else {
                        console.error("KaTeX rendering error:", e);
                        rendered = match[0]; // Fall back to original on error
                    }
                }

                // Replace the matched formula in the modified text
                modifiedText = modifiedText.replace(match[0], rendered);
            }
        }
        return modifiedText;
    }

    /**
     * Builds a jquery table of contents.
     *
     * @param html Note's html content
     * @returns ordered list table of headings, nested by heading level
     *         with an onclick event that will cause the document to scroll to
     *         the desired position.
     */
    async getToc(html: string): Promise<Toc> {
        // Regular expression for headings <h1>...</h1> using non-greedy
        // matching and backreferences
        const headingTagsRegex = /<h(\d+)[^>]*>(.*?)<\/h\1>/gi;

        // Use jquery to build the table rather than html text, since it makes
        // it easier to set the onclick event that will be executed with the
        // right captured callback context
        let $toc = $("<ol>");
        // Note heading 2 is the first level Trilium makes available to the note
        let curLevel = 2;
        const $ols = [$toc];
        let $previousLi: JQuery<HTMLElement> | undefined;

        if (!(this.noteContext?.viewScope?.tocCollapsedHeadings instanceof Set)) {
            this.noteContext!.viewScope!.tocCollapsedHeadings = new Set<string>();
        }
        const tocCollapsedHeadings = this.noteContext!.viewScope!.tocCollapsedHeadings as Set<string>;
        const validHeadingKeys = new Set<string>(); // Used to clean up obsolete entries in tocCollapsedHeadings

        let headingCount = 0;
        for (let m: RegExpMatchArray | null = null, headingIndex = 0; (m = headingTagsRegex.exec(html)) !== null; headingIndex++) {
            //
            // Nest/unnest whatever necessary number of ordered lists
            //
            const newLevel = parseInt(m[1]);
            const levelDelta = newLevel - curLevel;
            if (levelDelta > 0) {
                // Open as many lists as newLevel - curLevel
                for (let i = 0; i < levelDelta; i++) {
                    const $ol = $("<ol>");
                    $ols[$ols.length - 1].append($ol);
                    $ols.push($ol);

                    if ($previousLi) {
                        const headingKey = `h${newLevel}_${headingIndex}_${$previousLi?.text().trim()}`;
                        this.setupCollapsibleHeading($ol, $previousLi, headingKey, tocCollapsedHeadings, validHeadingKeys);
                    }
                }
            } else if (levelDelta < 0) {
                // Close as many lists as curLevel - newLevel
                // be careful not to empty $ols completely, the root element should stay (could happen with a rogue h1 element)
                for (let i = 0; i < -levelDelta && $ols.length > 1; ++i) {
                    $ols.pop();
                }
            }
            curLevel = newLevel;

            //
            // Create the list item and set up the click callback
            //

            const headingText = await this.replaceMathTextWithKatax(m[2]);
            const $itemContent = $('<div class="item-content">').html(headingText);
            const $li = $("<li>").append($itemContent)
                .on("click", () => this.jumpToHeading(headingIndex));
            $ols[$ols.length - 1].append($li);
            headingCount = headingIndex;
            $previousLi = $li;
        }

        //  Clean up unused entries in tocCollapsedHeadings
        for (const key of tocCollapsedHeadings) {
            if (!validHeadingKeys.has(key)) {
                tocCollapsedHeadings.delete(key);
            }
        }

        $toc = this.pullLeft($toc);

        return {
            $toc,
            headingCount
        };
    }

    /**
     * Reduce indent if a larger headings are not being used: https://github.com/zadam/trilium/issues/4363
     */
    pullLeft($toc: JQuery<HTMLElement>) {
        while (true) {
            const $children = $toc.children();

            if ($children.length !== 1) {
                break;
            }

            const $first = $toc.children(":first");

            if ($first[0].tagName.toLowerCase() !== "ol") {
                break;
            }

            $toc = $first;
        }
        return $toc;
    }

    async jumpToHeading(headingIndex: number) {
        if (!this.note || !this.noteContext) {
            return;
        }

        // A readonly note can change state to "readonly disabled
        // temporarily" (ie "edit this note" button) without any
        // intervening events, do the readonly calculation at navigation
        // time and not at outline creation time
        // See https://github.com/zadam/trilium/issues/2828
        const isDocNote = this.note.type === "doc";
        const isReadOnly = await this.noteContext.isReadOnly();

        let $container: JQuery<HTMLElement> | null = null;
        if (isReadOnly || isDocNote) {
            $container = await this.noteContext.getContentElement();
        } else {
            const textEditor = await this.noteContext.getTextEditor();
            if (textEditor?.sourceElement) {
                $container = $(textEditor.sourceElement);
            }
        }

        const headingElement = $container?.find(":header:not(section.include-note :header)")?.[headingIndex];
        headingElement?.scrollIntoView({ behavior: "smooth" });
    }

    async setupCollapsibleHeading($ol: JQuery<HTMLElement>, $previousLi: JQuery<HTMLElement>, headingKey: string, tocCollapsedHeadings: Set<string>, validHeadingKeys: Set<string>) {
        if ($previousLi && $previousLi.find(".collapse-button").length === 0) {
            const $collapseButton = $('<div class="collapse-button bx bx-chevron-down"></div>');
            $previousLi.prepend($collapseButton);

            // Restore the previous collapsed state
            if (tocCollapsedHeadings?.has(headingKey)) {
                $previousLi.addClass("collapsed");
                validHeadingKeys.add(headingKey);
            } else {
                $previousLi.removeClass("collapsed");
            }

            $collapseButton.on("click", (event) => {
                event.stopPropagation();
                if ($previousLi.hasClass("animating")) return;
                const willCollapse  = !$previousLi.hasClass("collapsed");
                $previousLi.addClass("animating");

                if (willCollapse) { // Collapse
                    $ol.css("maxHeight", `${$ol.prop("scrollHeight")}px`);
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            $ol.css("maxHeight", "0px");
                            $collapseButton.css("transform", "rotate(-90deg)");
                        });
                    });
                    setTimeout(() => {
                        $ol.css("maxHeight", "");
                        $previousLi.addClass("collapsed");
                        $previousLi.removeClass("animating");
                    }, 300);
                } else { // Expand
                    $previousLi.removeClass("collapsed");
                    $ol.css("maxHeight", "0px");
                    requestAnimationFrame(() => {
                        $ol.css("maxHeight", `${$ol.prop("scrollHeight")}px`);
                        $collapseButton.css("transform", "");
                    });
                    setTimeout(() => {
                        $ol.css("maxHeight", "");
                        $previousLi.removeClass("animating");
                    }, 300);
                }

                if (willCollapse) { // Store collapsed headings
                    tocCollapsedHeadings!.add(headingKey);
                } else {
                    tocCollapsedHeadings!.delete(headingKey);
                }
            });
        }
    }

    async closeTocCommand() {
        if (this.noteContext?.viewScope) {
            this.noteContext.viewScope.tocTemporarilyHidden = true;
        }
        await this.refresh();
        this.triggerCommand("reEvaluateRightPaneVisibility");
        appContext.triggerEvent("reEvaluateTocWidgetVisibility", { noteId: this.noteId });
    }

    async showTocWidgetEvent({ noteId }: EventData<"showTocWidget">) {
        if (this.noteId === noteId) {
            await this.refresh();
            this.triggerCommand("reEvaluateRightPaneVisibility");
            appContext.triggerEvent("reEvaluateTocWidgetVisibility", { noteId: this.noteId });
        }
    }

    async entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        if (this.noteId && loadResults.isNoteContentReloaded(this.noteId)) {
            await this.refresh();
        } else if (
            loadResults
                .getAttributeRows()
                .find((attr) => attr.type === "label" && ((attr.name ?? "").toLowerCase().includes("readonly") || attr.name === "toc") && attributeService.isAffecting(attr, this.note))
        ) {
            await this.refresh();
        }
    }
}
