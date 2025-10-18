import AbstractTextTypeWidget from "./abstract_text_type_widget.js";
import { formatCodeBlocks } from "../../services/syntax_highlight.js";
import type FNote from "../../entities/fnote.js";
import type { CommandListenerData, EventData } from "../../components/app_context.js";
import { getLocaleById } from "../../services/i18n.js";
import appContext from "../../components/app_context.js";
import { getMermaidConfig } from "../../services/mermaid.js";
import { renderMathInElement } from "../../services/math.js";

const TPL = /*html*/`
<div class="note-detail-readonly-text note-detail-printable" tabindex="100">
    <style>
    /* h1 should not be used at all since semantically that's a note title */
    .note-detail-readonly-text h1 { font-size: 1.8em; }
    .note-detail-readonly-text h2 { font-size: 1.6em; }
    .note-detail-readonly-text h3 { font-size: 1.4em; }
    .note-detail-readonly-text h4 { font-size: 1.2em; }
    .note-detail-readonly-text h5 { font-size: 1.1em; }
    .note-detail-readonly-text h6 { font-size: 1.0em; }

    body.heading-style-markdown .note-detail-readonly-text h1::before { content: "#\\2004"; color: var(--muted-text-color); }
    body.heading-style-markdown .note-detail-readonly-text h2::before { content: "##\\2004"; color: var(--muted-text-color); }
    body.heading-style-markdown .note-detail-readonly-text h3::before { content: "###\\2004"; color: var(--muted-text-color); }
    body.heading-style-markdown .note-detail-readonly-text h4:not(.include-note-title)::before { content: "####\\2004"; color: var(--muted-text-color); }
    body.heading-style-markdown .note-detail-readonly-text h5::before { content: "#####\\2004"; color: var(--muted-text-color); }
    body.heading-style-markdown .note-detail-readonly-text h6::before { content: "######\\2004"; color: var(--muted-text-color); }

    body.heading-style-underline .note-detail-readonly-text h1 { border-bottom: 1px solid var(--main-border-color); }
    body.heading-style-underline .note-detail-readonly-text h2 { border-bottom: 1px solid var(--main-border-color); }
    body.heading-style-underline .note-detail-readonly-text h3 { border-bottom: 1px solid var(--main-border-color); }
    body.heading-style-underline .note-detail-readonly-text h4:not(.include-note-title) { border-bottom: 1px solid var(--main-border-color); }
    body.heading-style-underline .note-detail-readonly-text h5 { border-bottom: 1px solid var(--main-border-color); }
    body.heading-style-underline .note-detail-readonly-text h6 { border-bottom: 1px solid var(--main-border-color); }

    .note-detail-readonly-text {
        padding-inline-start: 24px;
        padding-top: 10px;
        font-family: var(--detail-font-family);
        min-height: 50px;
        position: relative;
    }

    body.mobile .note-detail-readonly-text {
        padding-inline-start: 10px;
    }

    .note-detail-readonly-text p:first-child, .note-detail-readonly-text::before {
        margin-top: 0;
    }

    .note-detail-readonly-text img {
        max-width: 100%;
        cursor: pointer;
    }

    .edit-text-note-button {
        position: absolute;
        top: 5px;
        inset-inline-end: 10px;
        font-size: 150%;
        padding: 5px;
        cursor: pointer;
        border: 1px solid transparent;
        border-radius: var(--button-border-radius);
        color: var(--button-text-color);
    }

    .edit-text-note-button:hover {
        border-color: var(--button-border-color);
    }
    </style>

    <div class="note-detail-readonly-text-content ck-content use-tn-links"></div>
</div>
`;

export default class ReadOnlyTextTypeWidget extends AbstractTextTypeWidget {

    private $content!: JQuery<HTMLElement>;

    static getType() {
        return "readOnlyText";
    }

    doRender() {
        this.$widget = $(TPL);

        this.$content = this.$widget.find(".note-detail-readonly-text-content");

        this.setupImageOpening(true);

        super.doRender();
    }

    cleanup() {
        this.$content.html("");
    }

    async doRefresh(note: FNote) {
        // we load CKEditor also for read only notes because they contain content styles required for correct rendering of even read only notes
        // we could load just ckeditor-content.css but that causes CSS conflicts when both build CSS and this content CSS is loaded at the same time
        // (see https://github.com/zadam/trilium/issues/1590 for example of such conflict)
        await import("@triliumnext/ckeditor5");

        this.onLanguageChanged();

        const blob = await note.getBlob();

        this.$content.html(blob?.content ?? "");

        this.$content.find("a.reference-link").each((_, el) => {
            this.loadReferenceLinkTitle($(el));
        });

        this.$content.find("section").each((_, el) => {
            const noteId = $(el).attr("data-note-id");

            if (noteId) {
                this.loadIncludedNote(noteId, $(el));
            }
        });

        if (this.$content.find("span.math-tex").length > 0) {
            renderMathInElement(this.$content[0], { trust: true });
        }

        await this.#applyInlineMermaid();
        await formatCodeBlocks(this.$content);
    }

    async #applyInlineMermaid() {
        const $el = this.$content.find('code[class="language-mermaid"]').closest("pre");
        if (!$el.length) {
            return;
        }

        // Rewrite the code block from <pre><code> to <div> in order not to apply a codeblock style to it.
        $el.replaceWith((i, content) => {
            return $('<div class="mermaid-diagram">').text($(content).text());
        });

        // Initialize mermaid
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize(getMermaidConfig());
        mermaid.run({
            nodes: this.$content.find(".mermaid-diagram")
        });
    }

    async refreshIncludedNoteEvent({ noteId }: EventData<"refreshIncludedNote">) {
        this.refreshIncludedNote(this.$content, noteId);
    }

    async executeWithContentElementEvent({ resolve, ntxId }: EventData<"executeWithContentElement">) {
        if (!this.isNoteContext(ntxId)) {
            return;
        }

        await this.initialized;

        resolve(this.$content);
    }

    async onLanguageChanged(): Promise<void> {
        const languageCode = this.note?.getLabelValue("language");
        const correspondingLocale = getLocaleById(languageCode);
        const isRtl = correspondingLocale?.rtl;
        this.$widget.attr("dir", isRtl ? "rtl" : "ltr");
    }

    buildTouchBarCommand({ TouchBar, buildIcon }: CommandListenerData<"buildTouchBar">) {
        return [
            new TouchBar.TouchBarSpacer({ size: "flexible" }),
            new TouchBar.TouchBarButton({
                icon: buildIcon("NSLockUnlockedTemplate"),
                click: () => {
                    if (this.noteContext?.viewScope) {
                        this.noteContext.viewScope.readOnlyTemporarilyDisabled = true;
                        appContext.triggerEvent("readOnlyTemporarilyDisabled", { noteContext: this.noteContext });
                    }
                    this.refresh();
                }
            })
        ];
    }

}
